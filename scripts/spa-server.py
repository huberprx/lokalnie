#!/usr/bin/env python3
"""Lokalny serwer SPA: nieznane ścieżki (np. /grzesiu-barber) serwują index.html."""
from __future__ import annotations

import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        rel = unquote(parsed.path)
        if rel.startswith("/"):
            rel = rel[1:]
        abs_path = os.path.normpath(os.path.join(ROOT, rel or "."))
        if not abs_path.startswith(ROOT):
            self.send_error(403)
            return
        exists = os.path.exists(abs_path) and not os.path.isdir(abs_path)
        if not exists:
            base = os.path.basename(parsed.path.rstrip("/") or "")
            # Pliki z rozszerzeniem (js/css/png) — zostaw 404; ścieżki profilu → index.html.
            if "." not in base:
                self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def log_message(self, fmt, *args):
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), SpaHandler)
    print("Serving SPA on http://%s:%s/" % (args.bind, args.port))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
