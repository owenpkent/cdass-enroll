"""
CDASS Enroll launcher.

Usage:
    python run.py            # start the app (dev server + open browser)
    python run.py install    # npm install (also vendors OCR/barcode assets)
    python run.py test       # run the smoke tests (node tests/smoke.mjs)
    python run.py build      # production build to dist/
    python run.py serve      # serve the production build (vite preview)

The app runs entirely on this computer at http://127.0.0.1:5180.
"""

import io
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

# Ensure stdout handles unicode on Windows (cp1252 terminals choke otherwise).
if sys.stdout.encoding and sys.stdout.encoding.lower().replace("-", "") != "utf8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )

ROOT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:5180"


def tool(name: str) -> str:
    """Resolve npm/npx/node to a full path (finds the .cmd shims on Windows)."""
    path = shutil.which(name)
    if not path:
        sys.exit(f"{name} not found on PATH. Install Node.js first (nodejs.org).")
    return path


def run(args: list[str]) -> int:
    print("  >", " ".join(args))
    return subprocess.run([tool(args[0]), *args[1:]], cwd=ROOT).returncode


def ensure_installed() -> None:
    if not os.path.isdir(os.path.join(ROOT, "node_modules")):
        print("First run: installing dependencies (also vendors OCR assets)...")
        if run(["npm", "install"]) != 0:
            sys.exit("npm install failed")
    if not os.path.isfile(os.path.join(ROOT, "public", "tessdata", "eng.traineddata")):
        print("OCR model missing, vendoring assets...")
        run(["npm", "run", "setup"])


def open_when_ready() -> None:
    """Open the browser once the dev server answers (max ~15s)."""
    for _ in range(60):
        try:
            urllib.request.urlopen(URL, timeout=1)
            webbrowser.open(URL)
            print(f"  opened {URL}")
            return
        except Exception:
            time.sleep(0.25)
    print(f"  server not up yet; open {URL} manually")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "dev"

    if mode == "install":
        sys.exit(run(["npm", "install"]))
    if mode == "test":
        ensure_installed()
        sys.exit(run(["node", "tests/smoke.mjs"]))
    if mode == "build":
        ensure_installed()
        sys.exit(run(["npm", "run", "build"]))
    if mode == "serve":
        ensure_installed()
        run(["npm", "run", "build"])
        sys.exit(run(["npx", "vite", "preview", "--host", "127.0.0.1", "--port", "5180"]))
    if mode == "dev":
        ensure_installed()
        print(f"Starting CDASS Enroll at {URL} (Ctrl+C to stop)")
        threading.Thread(target=open_when_ready, daemon=True).start()
        sys.exit(run(["npm", "run", "dev"]))

    print(__doc__)
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped")
