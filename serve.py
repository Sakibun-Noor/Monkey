#!/usr/bin/env python3
"""Static dev server with HTTP Range support.

`python -m http.server` ignores Range requests, which leaves <video> unseekable
(`video.seekable` comes back empty). Media needs 206 responses, so serve with:

    python serve.py 5178
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)

    def send_head(self):
        header = self.headers.get("Range")
        if not header:
            return SimpleHTTPRequestHandler.send_head(self)

        m = RANGE_RE.match(header.strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return SimpleHTTPRequestHandler.send_head(self)

        size = os.path.getsize(path)
        start_s, end_s = m.group(1), m.group(2)
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:  # suffix range: bytes=-500
            start = max(0, size - int(end_s))
            end = size - 1
        end = min(end, size - 1)

        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Slice(f, end - start + 1)


class _Slice:
    """File-like wrapper that stops after `remaining` bytes."""

    def __init__(self, f, remaining):
        self.f, self.remaining = f, remaining

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n is None or n < 0:
            n = self.remaining
        chunk = self.f.read(min(n, self.remaining))
        self.remaining -= len(chunk)
        return chunk

    def close(self):
        self.f.close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(RangeHandler, directory=root)
    print(f"serving {root} on http://localhost:{port}")
    # Threaded: the page pulls video, two audio tracks and avatars concurrently.
    ThreadingHTTPServer(("0.0.0.0", port), handler).serve_forever()
