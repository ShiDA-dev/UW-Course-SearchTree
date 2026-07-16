#!/usr/bin/env python3
"""
Minimal static file server for Render (and local smoke tests).

This site has no live Python API — the UI is HTML/JS + data/courses_data.json.
Render's old start command (`uvicorn backend.server:app`) no longer applies.
"""

from __future__ import annotations

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class QuietHandler(SimpleHTTPRequestHandler):
    # Avoid noisy logs for every asset on Render
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        if args and str(args[0]).startswith(("4", "5")):
            super().log_message(format, *args)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"Serving static site from {ROOT} on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
