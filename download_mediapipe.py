"""
download_mediapipe.py — Downloads MediaPipe Hands vendored files for GestureScroll.

This script downloads the required MediaPipe Hands WASM, model, and JS files
from the npm CDN (unpkg.com) and places them in assets/mediapipe/.

WHY WE VENDOR THESE FILES:
  GestureScroll has a strict privacy guarantee: 100% on-device processing,
  zero runtime network requests. Vendoring MediaPipe files into the extension
  package ensures the extension works offline and never makes CDN requests
  to load the AI model.

USAGE:
  python download_mediapipe.py

MEDIAPIPE VERSION:
  @mediapipe/hands 0.4.1675469240
"""

import urllib.request
import os
import sys

VERSION = "0.4.1675469240"

# Files needed from @mediapipe/hands package
FILES = [
    "hands.js",
    "hands_solution_packed_assets.data",
    "hands_solution_packed_assets_loader.js",
    "hands_solution_simd_wasm_bin.js",
    "hands_solution_simd_wasm_bin.wasm",
    "hands_solution_wasm_bin.js",
    "hands_solution_wasm_bin.wasm",
]

BASE_URL = f"https://cdn.jsdelivr.net/npm/@mediapipe/hands@{VERSION}/"

def download_file(url, dest_path):
    print(f"  Downloading {os.path.basename(dest_path)}...", end=" ", flush=True)
    try:
        urllib.request.urlretrieve(url, dest_path)
        size = os.path.getsize(dest_path)
        print(f"OK ({size // 1024} KB)")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False

def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "mediapipe")
    os.makedirs(out_dir, exist_ok=True)
    
    print(f"[mediapipe] Downloading @mediapipe/hands v{VERSION} to assets/mediapipe/")
    print(f"[mediapipe] Source: {BASE_URL}")
    print()
    
    success = 0
    failed = 0
    
    for filename in FILES:
        url = BASE_URL + filename
        dest = os.path.join(out_dir, filename)
        
        # Skip if already downloaded (for incremental runs)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"  {filename} — already exists, skipping.")
            success += 1
            continue
        
        if download_file(url, dest):
            success += 1
        else:
            failed += 1
    
    print()
    print(f"[mediapipe] Done. {success} files OK, {failed} failed.")
    
    if failed > 0:
        print()
        print("[mediapipe] WARNING: Some files failed to download.")
        print("  Please download them manually from:")
        print(f"  {BASE_URL}")
        print("  And place them in: assets/mediapipe/")
        sys.exit(1)
    else:
        print("[mediapipe] All files ready. Extension can now run 100% offline.")

if __name__ == "__main__":
    main()
