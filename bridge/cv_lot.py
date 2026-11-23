"""OpenCV parking detector. Replaces the browser detector.
Keys: c = calibrate EMPTY lot (hold still, ~2 s)   r = re-draw the 4 bay boxes   q = quit
Run:  python cv_lot.py --cam 1 [--port COM7] [--no-publish]
Method: empty-lot baseline (averaged), ECC translation alignment each frame (handles a shaking
camera), brightness matching from the area outside the bays, then the fraction of changed
pixels inside each bay. Debounced. Publishes the same JSON the dashboard already reads
(ntfy) and, with --port, sends the free count digit to the ESP32 over USB serial."""
import argparse, json, os, subprocess, sys, time, urllib.request
import cv2
import numpy as np

NTFY = "https://ntfy.sh/uowd-csit214-parking-parkar4308"
IDS = ["C1", "C2", "C3", "C4"]
ON_FRAC, OFF_FRAC, DIFF_T, FRAMES = 0.22, 0.10, 30, 4

ap = argparse.ArgumentParser()
ap.add_argument("--cam", type=int, default=1)
ap.add_argument("--port")
ap.add_argument("--no-publish", action="store_true")
ap.add_argument("--selftest", action="store_true")
args = ap.parse_args()

SMALL = (320, 180)


def prep(frame):
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(g, (7, 7), 0).astype(np.float32)


def align(base_s, cur_s):
    """Return 2x3 warp (small-frame coords) mapping cur onto base, or identity."""
    w = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(base_s, cur_s, w, cv2.MOTION_TRANSLATION,
                             (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 1e-3), None, 5)
    except cv2.error:
        w = np.eye(2, 3, dtype=np.float32)
    return w


class Lot:
    def __init__(self):
        self.rects = None            # (x, y, w, h) per bay in full-frame pixels
        self.base = None
        self.state = [False] * 4
        self.count = [0] * 4
        self.score = [0.0] * 4

    def calibrate(self, frames):
        self.base = np.mean([prep(f) for f in frames], axis=0).astype(np.float32)
        self.state = [False] * 4
        self.count = [0] * 4

    def update(self, frame):
        if self.base is None or self.rects is None:
            return
        h, w = frame.shape[:2]
        cur = prep(frame)
        sx, sy = w / SMALL[0], h / SMALL[1]
        w2 = align(cv2.resize(self.base, SMALL), cv2.resize(cur, SMALL))
        w2[0, 2] *= sx
        w2[1, 2] *= sy
        cur = cv2.warpAffine(cur, w2, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                             borderMode=cv2.BORDER_REPLICATE)
        mask = np.ones((h, w), bool)
        for (x, y, rw, rh) in self.rects:
            mask[y:y + rh, x:x + rw] = False
        if mask.sum() > 1000:                      # brightness/contrast match from outside the bays
            a, b = self.base[mask], cur[mask]
            gain = float(np.clip(a.std() / max(b.std(), 1e-3), 0.7, 1.4))
            cur = (cur - b.mean()) * gain + a.mean()
        diff = np.abs(cur - self.base)
        for i, (x, y, rw, rh) in enumerate(self.rects):
            mx, my = int(rw * 0.12), int(rh * 0.12)
            d = diff[y + my:y + rh - my, x + mx:x + rw - mx]
            s = float((d > DIFF_T).mean()) if d.size else 0.0
            self.score[i] = s
            want = s > (OFF_FRAC if self.state[i] else ON_FRAC)
            if want != self.state[i]:
                self.count[i] += 1
                if self.count[i] >= FRAMES:
                    self.state[i] = want
                    self.count[i] = 0
            else:
                self.count[i] = 0


def pick_rects(frame):
    rects = []
    for i in IDS:
        r = cv2.selectROI("Draw bay " + i + " (Enter to confirm)", frame, showCrosshair=False)
        cv2.destroyWindow("Draw bay " + i + " (Enter to confirm)")
        rects.append(tuple(int(v) for v in r))
    return rects


last_pub = {"sig": None, "t": 0}


def publish(state, port):
    free = state.count(False)
    sig = tuple(state)
    now = time.time()
    if sig == last_pub["sig"] and now - last_pub["t"] < 8:
        return
    last_pub.update(sig=sig, t=now)
    iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    snap = {"updatedAt": iso, "serverTime": iso,
            "lots": [{"id": "lotA", "name": "Lot A (camera prototype)", "capacity": 4, "free": free,
                      "bays": [{"id": IDS[i], "occupied": state[i], "source": "camera", "lastChange": iso,
                                "flagged": False} for i in range(4)]}],
            "devices": [{"id": "webcam-lotA", "lastSeen": iso, "online": True},
                        {"id": "esp32-lotB", "lastSeen": iso, "online": bool(port)}],
            "events": [{"ts": iso, "type": "online", "message": "OpenCV camera node (%d/4 free)" % free}]}
    if not args.no_publish:
        try:
            urllib.request.urlopen(urllib.request.Request(NTFY, json.dumps(snap).encode(), method="POST"), timeout=4)
        except Exception as e:
            print("publish failed:", e)
    if port:
        try:
            port.write(str(free).encode())
            port.flush()
        except Exception as e:
            print("serial failed:", e)
    print(time.strftime("%H:%M:%S"), "free", free, "/4", "".join("X" if s else "." for s in state))


def open_port(name):
    if not name:
        return None
    subprocess.run(["mode", name, "BAUD=115200", "PARITY=N", "DATA=8", "STOP=1", "dtr=off", "rts=off"],
                   shell=True, capture_output=True)
    return open("\\\\.\\" + name, "wb", buffering=0)


def selftest():
    rng = np.random.default_rng(1)
    base = np.full((360, 640, 3), 120, np.uint8)
    for i in range(4):
        cv2.rectangle(base, (30 + i * 150, 60), (150 + i * 150, 300), (200, 200, 200), 3)
        cv2.putText(base, "C%d" % (i + 1), (60 + i * 150, 190), 0, 1, (40, 40, 40), 3)
    L = Lot()
    L.rects = [(30 + i * 150, 60, 120, 240) for i in range(4)]
    noisy = lambda f, dx=0, dy=0, g=1.0: np.clip(np.roll(f, (dy, dx), (0, 1)).astype(np.float32) * g
                                               + rng.normal(0, 4, f.shape), 0, 255).astype(np.uint8)
    L.calibrate([noisy(base) for _ in range(10)])
    out = []
    for name, f in [("empty", noisy(base)), ("shift 3px+exposure 0.88", noisy(base, 3, 2, 0.88)),
                    ("exposure 1.12", noisy(base, 0, 0, 1.12))]:
        for _ in range(6):
            L.update(f)
        out.append((name, list(L.state), [round(s, 3) for s in L.score]))
    car = base.copy()
    cv2.rectangle(car, (190, 110), (270, 250), (30, 30, 200), -1)    # a toy car in bay C2
    for _ in range(6):
        L.update(noisy(car, 2, 1, 0.95))
    out.append(("car in C2 + 2px shift", list(L.state), [round(s, 3) for s in L.score]))
    for o in out:
        print(o)


def main():
    if args.selftest:
        return selftest()
    cap = cv2.VideoCapture(args.cam, cv2.CAP_DSHOW)
    cap.set(3, 1280); cap.set(4, 720)
    if not cap.isOpened():
        sys.exit("camera %d not available (close the browser camera page first)" % args.cam)
    port = open_port(args.port)
    L = Lot()
    for _ in range(15):
        cap.read()
    ok, frame = cap.read()
    L.rects = pick_rects(frame)
    print("Press c with the lot EMPTY to calibrate.")
    calib = None
    while True:
        ok, frame = cap.read()
        if not ok:
            continue
        if calib is not None:
            calib.append(frame.copy())
            if len(calib) >= 30:
                L.calibrate(calib); calib = None; print("calibrated")
        else:
            L.update(frame)
        vis = frame.copy()
        for i, (x, y, w, h) in enumerate(L.rects):
            col = (0, 0, 255) if L.state[i] else (0, 160, 0)
            cv2.rectangle(vis, (x, y), (x + w, y + h), col, 2)
            tag = IDS[i] + (" CAR" if L.state[i] else " FREE") if L.base is not None else IDS[i]
            cv2.putText(vis, "%s %.2f" % (tag, L.score[i]), (x + 4, y + 22), 0, 0.6, col, 2)
        cv2.putText(vis, "CALIBRATING - keep lot empty" if calib is not None else
                    ("press c to calibrate" if L.base is None else "free %d/4" % L.state.count(False)),
                    (10, 30), 0, 0.9, (255, 255, 0), 2)
        cv2.imshow("OpenCV lot", vis)
        if L.base is not None and calib is None:
            publish(L.state, port)
        k = cv2.waitKey(1) & 0xFF
        if k == ord("q"):
            break
        if k == ord("c"):
            calib = []
        if k == ord("r"):
            L.rects = pick_rects(frame); L.base = None
    cap.release(); cv2.destroyAllWindows()


main()
