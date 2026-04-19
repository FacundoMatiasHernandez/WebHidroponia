#!/usr/bin/env python3
import argparse
import atexit
import threading
import time

import cv2
from flask import Flask, Response, jsonify


def build_parser():
  parser = argparse.ArgumentParser(description="MJPEG streamer with a simple OpenCV processing hook.")
  parser.add_argument("--device", default="/dev/video0", help="Camera device or index. Default: /dev/video0")
  parser.add_argument("--host", default="0.0.0.0", help="Bind host. Default: 0.0.0.0")
  parser.add_argument("--port", type=int, default=8081, help="HTTP port. Default: 8081")
  parser.add_argument("--width", type=int, default=640, help="Capture width. Default: 640")
  parser.add_argument("--height", type=int, default=360, help="Capture height. Default: 360")
  parser.add_argument("--fps", type=int, default=10, help="Target FPS. Default: 10")
  parser.add_argument("--jpeg-quality", type=int, default=75, help="JPEG quality 0-100. Default: 75")
  parser.add_argument("--label", default="Raspberry Pi 3 / Logitech USB", help="Overlay label.")
  return parser


def resolve_device(value):
  return int(value) if isinstance(value, str) and value.isdigit() else value


def process_frame(frame, label):
  output = frame.copy()
  height, width = output.shape[:2]
  timestamp = time.strftime("%Y-%m-%d %H:%M:%S")

  cv2.putText(output, label, (16, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (120, 255, 180), 2, cv2.LINE_AA)
  cv2.putText(output, timestamp, (16, height - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
  cv2.rectangle(output, (12, 12), (width - 12, height - 12), (120, 255, 180), 1)
  cv2.line(output, (width // 2, 0), (width // 2, height), (80, 120, 255), 1)
  cv2.line(output, (0, height // 2), (width, height // 2), (80, 120, 255), 1)
  return output


class CameraStream:
  def __init__(self, device, width, height, fps, jpeg_quality, label):
    self.device = resolve_device(device)
    self.width = width
    self.height = height
    self.fps = max(1, fps)
    self.jpeg_quality = max(30, min(95, jpeg_quality))
    self.label = label
    self.capture = self._open_capture()
    self.latest_frame = None
    self.running = True
    self.lock = threading.Lock()
    self.thread = threading.Thread(target=self._capture_loop, daemon=True)
    self.thread.start()

  def _open_capture(self):
    capture = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
    if not capture.isOpened():
      capture = cv2.VideoCapture(self.device)

    if not capture.isOpened():
      raise RuntimeError(f"No se pudo abrir la camara: {self.device}")

    capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
    capture.set(cv2.CAP_PROP_FPS, self.fps)
    return capture

  def _capture_loop(self):
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
    frame_delay = 1.0 / self.fps

    while self.running:
      ok, frame = self.capture.read()
      if not ok:
        time.sleep(0.1)
        continue

      processed = process_frame(frame, self.label)
      ok, buffer = cv2.imencode(".jpg", processed, encode_params)
      if not ok:
        time.sleep(0.05)
        continue

      with self.lock:
        self.latest_frame = buffer.tobytes()

      time.sleep(frame_delay)

  def get_frame(self):
    with self.lock:
      return self.latest_frame

  def generate_mjpeg(self):
    while self.running:
      frame = self.get_frame()
      if not frame:
        time.sleep(0.05)
        continue

      yield (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n"
        + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
        + frame
        + b"\r\n"
      )
      time.sleep(1.0 / self.fps)

  def shutdown(self):
    self.running = False
    if self.capture:
      self.capture.release()


def create_app(camera_stream):
  app = Flask(__name__)

  @app.get("/health")
  def health():
    return jsonify(
      ok=True,
      device=str(camera_stream.device),
      width=camera_stream.width,
      height=camera_stream.height,
      fps=camera_stream.fps
    )

  @app.get("/snapshot.jpg")
  def snapshot():
    frame = camera_stream.get_frame()
    if not frame:
      return ("Camera warming up", 503)

    return Response(frame, mimetype="image/jpeg")

  @app.get("/stream.mjpg")
  def stream():
    return Response(
      camera_stream.generate_mjpeg(),
      mimetype="multipart/x-mixed-replace; boundary=frame"
    )

  return app


def main():
  args = build_parser().parse_args()
  camera_stream = CameraStream(
    device=args.device,
    width=args.width,
    height=args.height,
    fps=args.fps,
    jpeg_quality=args.jpeg_quality,
    label=args.label
  )
  atexit.register(camera_stream.shutdown)

  app = create_app(camera_stream)
  app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
  main()
