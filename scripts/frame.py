# dsh-wallpaper: extract one frame from a video wallpaper for use as a static
# background image. Used by lib/index.js via `python frame.py <video> <out.jpg>`.
#
# - grabs the middle frame (falls back to the first frame if seeking fails)
# - writes JPEG via cv2.imencode + np.tofile so non-ASCII paths work on Windows
import os
import sys

import cv2

src, dst = sys.argv[1], sys.argv[2]


def grab(cap, pos):
    cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
    ok, frame = cap.read()
    return (ok and frame is not None), frame


cap = cv2.VideoCapture(src)
if not cap.isOpened():
    sys.exit(1)

total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
target = max(0, total // 2) if total > 0 else 0
ok, frame = grab(cap, target)
if not ok:
    ok, frame = grab(cap, 0)
cap.release()
if not ok or frame is None:
    sys.exit(1)

os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
if not ok:
    sys.exit(1)
buf.tofile(dst)
print(dst)
