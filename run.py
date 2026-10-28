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
import socket
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
PORT = 5180
URL = f"http://127.0.0.1:{PORT}"


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
        if not os.path.isfile(os.path.join(ROOT, "public", "tessdata", "eng.traineddata")):
            print("  warning: OCR model still missing; passport/SSN-card OCR will not work")


def port_in_use() -> bool:
    """True if something is already listening on the pinned port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def is_our_dev_server() -> bool:
    """Vite dev serves /@vite/client; another app on the port will not."""
    try:
        with urllib.request.urlopen(URL + "/@vite/client", timeout=2) as r:
            body = r.read(4096).decode("utf-8", "replace")
        with urllib.request.urlopen(URL + "/", timeout=2) as r:
            page = r.read(8192).decode("utf-8", "replace")
        return "vite" in body.lower() and "CDASS" in page
    except Exception:
        return False


def check_port_free() -> None:
    if not port_in_use():
        return
    if is_our_dev_server():
        print(f"CDASS Enroll is already running at {URL}; opening it.")
        webbrowser.open(URL)
        sys.exit(0)
    sys.exit(f"Port {PORT} is already in use by another program. Stop it and try again.")


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
        check_port_free()
        if run(["npm", "run", "build"]) != 0:
            sys.exit("build failed; not serving")
        sys.exit(run(["npx", "vite", "preview", "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"]))
    if mode == "dev":
        ensure_installed()
        check_port_free()
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
