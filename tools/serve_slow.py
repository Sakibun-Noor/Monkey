#!/usr/bin/env python3
"""serve.py, but with a shared bandwidth cap and per-request latency.

For checking how the player behaves on an average phone connection instead of
localhost:

    python tools/serve_slow.py 5179 600 80      # ~4.8 Mbps, 80 ms latency

Arguments: port, kilobytes/second shared across ALL connections (like a real
link -- the video and the audio compete), latency in ms added to each request,
and optionally a different site folder to serve (to compare two versions).
"""
import os
import sys
import threading
import time
from functools import partial
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from serve import RangeHandler  # noqa: E402

CHUNK = 8192


class Link:
    """One shared pipe: every write, from every connection, waits its turn."""

    def __init__(self, kb_per_s):
        self.bytes_per_s = kb_per_s * 1024
        self.lock = threading.Lock()
        self.free_at = time.monotonic()

    def send(self, n):
        with self.lock:
            now = time.monotonic()
            start = max(now, self.free_at)
            self.free_at = start + n / self.bytes_per_s
            wait = start - now
        if wait > 0:
            time.sleep(wait)


class SlowHandler(RangeHandler):
    link = None
    latency = 0.0

    def send_head(self):
        if self.latency:
            time.sleep(self.latency)
        return RangeHandler.send_head(self)

    def copyfile(self, source, outputfile):
        while True:
            chunk = source.read(CHUNK)
            if not chunk:
                break
            self.link.send(len(chunk))
            try:
                outputfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                break

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    kb = float(sys.argv[2]) if len(sys.argv) > 2 else 600
    latency_ms = float(sys.argv[3]) if len(sys.argv) > 3 else 80
    SlowHandler.link = Link(kb)
    SlowHandler.latency = latency_ms / 1000
    root = sys.argv[4] if len(sys.argv) > 4 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print(f"serving {root} on http://localhost:{port}  ({kb:.0f} KB/s shared, {latency_ms:.0f} ms latency)")
    ThreadingHTTPServer(("0.0.0.0", port), partial(SlowHandler, directory=root)).serve_forever()
