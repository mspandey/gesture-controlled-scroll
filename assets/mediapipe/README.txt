This directory will contain vendored MediaPipe Hands files for offline use.

Run `python download_mediapipe.py` from the project root to populate this directory.

Required files:
  - hands.js
  - hands_solution_packed_assets.data
  - hands_solution_packed_assets_loader.js
  - hands_solution_simd_wasm_bin.js
  - hands_solution_simd_wasm_bin.wasm
  - hands_solution_wasm_bin.js
  - hands_solution_wasm_bin.wasm

These files are deliberately excluded from version control because they are:
  1. Large binary files (total ~15 MB)
  2. Available from the @mediapipe/hands npm package at a fixed version

After building, these files are copied to dist/assets/mediapipe/ automatically.
