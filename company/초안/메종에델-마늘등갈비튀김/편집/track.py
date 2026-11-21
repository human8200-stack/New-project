"""Hand speed by Lucas-Kanade tracking of features seeded inside a hand box.
Prints per-frame: time speed(px/s, 720x1280 scale) for the allowed range of each cut."""
import sys, json
import cv2
import numpy as np

V = '/home/user/New-project/company/초안/메종에델-마늘등갈비튀김/영상/'
cuts = json.load(open(sys.argv[1]))
res = {}
for c in cuts:
    cap = cv2.VideoCapture(V + c['clip'] + '.mp4')
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(c['a'] * fps)))
    x, y, w, h = c['box']
    ok, fr = cap.read()
    prev = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
    mask = np.zeros_like(prev); mask[y:y + h, x:x + w] = 255
    pts = cv2.goodFeaturesToTrack(prev, 60, 0.01, 6, mask=mask)
    n0 = int(round(c['a'] * fps))
    out = []
    f = n0
    while f / fps < c['b']:
        ok, fr = cap.read()
        if not ok:
            break
        f += 1
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        if pts is None or len(pts) < 6:
            out.append((f / fps, float('nan')))
            prev = g
            continue
        nxt, st, err = cv2.calcOpticalFlowPyrLK(prev, g, pts, None, winSize=(25, 25), maxLevel=3)
        good_old = pts[st == 1]; good_new = nxt[st == 1]
        if len(good_new) >= 4:
            d = np.linalg.norm(good_new - good_old, axis=1)
            out.append((f / fps, float(np.median(d) * fps)))
            # re-seed around the tracked hand when points get few
            pts = good_new.reshape(-1, 1, 2)
            if len(pts) < 20:
                cx, cy = np.median(good_new, axis=0)
                m = np.zeros_like(g)
                m[max(0, int(cy - h / 2)):int(cy + h / 2), max(0, int(cx - w / 2)):int(cx + w / 2)] = 255
                p2 = cv2.goodFeaturesToTrack(g, 60, 0.01, 6, mask=m)
                if p2 is not None:
                    pts = p2
        else:
            out.append((f / fps, float('nan')))
            pts = None
        prev = g
    res[c['name']] = out
json.dump(res, open(sys.argv[2], 'w'))
