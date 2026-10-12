#!/usr/bin/env python3
"""Regenerate the README screenshots in docs/screenshots/.

Serves the app on a local port, captures every page with headless Chromium,
crops the laboratory area and writes compact WebP files.

Usage:  python3 scripts/screenshots.py [page ...]
Requires: chromium (or google-chrome) on PATH, Pillow.
"""
import functools
import http.server
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
PORT = 8799
WIDTH, HEIGHT = 1440, 1400

# page id → crop box (left, top, right, bottom) in CSS pixels at 1440 px width.
# The sidebar is 268 px wide; laboratories start below the page header (~290 px).
LAB = (296, 290, 1412, 1110)
PAGES = {
    "home": ("", (268, 0, 1440, 680)),
    "foundations": ("foundations", (296, 0, 1412, 760)),
    "catalogue": ("catalogue", (296, 250, 1412, 1070)),
    "raytracer": ("raytracer", LAB),
    "dof": ("dof", LAB),
    "sensor": ("sensor", LAB),
    "projection": ("projection", LAB),
    "perspective": ("perspective", LAB),
    "tiltshift": ("tiltshift", LAB),
    "vignetting": ("vignetting", LAB),
    "psf": ("psf", (296, 264, 1412, 1084)),
    "zernike": ("zernike", LAB),
    "mtf": ("mtf", (296, 264, 1412, 1084)),
    "chromatic": ("chromatic", (296, 300, 1412, 1120)),
    "bokeh": ("bokeh", LAB),
    "flare": ("flare", LAB),
    "sampling": ("sampling", LAB),
    "noise": ("noise", LAB),
    "motion": ("motion", LAB),
    "seeing": ("seeing", (296, 316, 1412, 1136)),
    "telescope": ("telescope", (296, 1220, 1412, 2040)),
    "lensing": ("lensing", LAB),
}


def browser():
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        if shutil.which(name):
            return name
    sys.exit("No Chromium/Chrome found on PATH")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def capture(exe, route, box, dest, tmp):
    height = max(HEIGHT, box[3] + 40)
    raw = Path(tmp) / "raw.png"
    subprocess.run(
        [exe, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
         f"--window-size={WIDTH},{height}", "--force-device-scale-factor=1",
         "--virtual-time-budget=15000", f"--screenshot={raw}",
         f"http://127.0.0.1:{PORT}/#/{route}"],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180,
    )
    Image.open(raw).convert("RGB").crop(box).save(dest, "WEBP", quality=86, method=6)


def main():
    wanted = sys.argv[1:] or list(PAGES)
    OUT.mkdir(parents=True, exist_ok=True)
    exe, httpd = browser(), serve()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for key in wanted:
                route, box = PAGES[key]
                dest = OUT / f"{key}.webp"
                capture(exe, route, box, dest, tmp)
                print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size // 1024} KB")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
