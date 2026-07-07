/**
 * GestureScroll Chrome Extension — esbuild Build Script
 *
 * Bundles all TypeScript entry points into the dist/ directory.
 * Copies static assets (HTML, CSS, manifest, icons, MediaPipe files).
 *
 * CRITICAL FORMAT NOTES:
 * ─────────────────────
 * Content script → format: 'iife'
 *   The content script runs in MAIN world (world: "MAIN" in manifest.json)
 *   so it can access window.Hands after injecting the MediaPipe <script> tag.
 *   ESM modules injected into MAIN world are BLOCKED by YouTube/Instagram's
 *   Content Security Policy — they appear in Sources but execute zero lines.
 *   IIFE format produces a plain self-executing function with no bare module
 *   specifiers, which bypasses the CSP restriction entirely.
 *
 * Background service worker → format: 'esm'
 *   MV3 service workers support ES modules natively via "type": "module" in
 *   manifest.json. ESM is fine here because service workers are not subject
 *   to page CSP.
 *
 * Popup / Options → format: 'esm'
 *   These run in extension pages (chrome-extension://) whose CSP is set by
 *   "content_security_policy.extension_pages" in manifest.json and always
 *   allows 'self', so ESM works fine.
 *
 * Usage:
 *   node build.mjs          — single build
 *   node build.mjs --watch  — watch mode (rebuild on file change)
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

// ---------------------------------------------------------------------------
// Helper: Recursively copy a directory
// ---------------------------------------------------------------------------
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: Copy a single file, creating destination directory as needed
// ---------------------------------------------------------------------------
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Static asset copy — runs after each build
// ---------------------------------------------------------------------------
function copyStaticAssets() {
  const dist = path.join(__dirname, 'dist');
  fs.mkdirSync(dist, { recursive: true });

  // manifest.json
  copyFile(
    path.join(__dirname, 'manifest.json'),
    path.join(dist, 'manifest.json')
  );

  // HTML files
  const htmlFiles = [
    ['src/popup/popup.html', 'popup/popup.html'],
    ['src/options/options.html', 'options/options.html'],
  ];
  for (const [src, dest] of htmlFiles) {
    const srcPath = path.join(__dirname, src);
    if (fs.existsSync(srcPath)) {
      copyFile(srcPath, path.join(dist, dest));
    }
  }

  // CSS files
  const cssFiles = [
    ['src/popup/popup.css', 'popup/popup.css'],
    ['src/options/options.css', 'options/options.css'],
  ];
  for (const [src, dest] of cssFiles) {
    const srcPath = path.join(__dirname, src);
    if (fs.existsSync(srcPath)) {
      copyFile(srcPath, path.join(dist, dest));
    }
  }

  // Icons
  const iconsDir = path.join(__dirname, 'assets/icons');
  if (fs.existsSync(iconsDir)) {
    copyDir(iconsDir, path.join(dist, 'assets/icons'));
  }

  // Vendored MediaPipe WASM/model files
  const mediapipeDir = path.join(__dirname, 'assets/mediapipe');
  if (fs.existsSync(mediapipeDir)) {
    copyDir(mediapipeDir, path.join(dist, 'assets/mediapipe'));
  }

  console.log('[build] Static assets copied.');
}

// ---------------------------------------------------------------------------
// Common esbuild options shared by all entry points
// ---------------------------------------------------------------------------
const commonConfig = {
  bundle: true,
  target: ['chrome120'],
  sourcemap: isWatch ? 'inline' : false,
  external: [],
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
  logLevel: 'info',
};

// ---------------------------------------------------------------------------
// Build / Watch
// ---------------------------------------------------------------------------
async function main() {
  // ── Context A: Content Script (IIFE — required for MAIN world on CSP pages) ──
  // IIFE produces a plain self-executing function. No bare import specifiers
  // remain in the output, so YouTube/Instagram CSP cannot block it.
  const contentCtx = await esbuild.context({
    ...commonConfig,
    format: 'iife',
    entryPoints: {
      'content-scripts/content-main': 'src/content-scripts/content-main.ts',
    },
    outdir: 'dist',
  });

  // ── Context B: Background + Popup + Options (ESM — fine in extension pages) ──
  const extensionCtx = await esbuild.context({
    ...commonConfig,
    format: 'esm',
    entryPoints: {
      'background/service-worker': 'src/background/service-worker.ts',
      'popup/popup': 'src/popup/popup.ts',
      'options/options': 'src/options/options.ts',
    },
    outdir: 'dist',
    plugins: [
      {
        name: 'copy-assets-plugin',
        setup(build) {
          build.onEnd(() => {
            copyStaticAssets();
          });
        },
      },
    ],
  });

  if (isWatch) {
    await contentCtx.watch();
    await extensionCtx.watch();
    console.log('[build] Watching for changes…');
  } else {
    await contentCtx.rebuild();
    await contentCtx.dispose();
    console.log('[build] Content script built (IIFE).');

    await extensionCtx.rebuild();
    await extensionCtx.dispose();
    console.log('[build] Extension scripts built (ESM).');
    console.log('[build] Build complete!');
  }
}

main().catch((err) => {
  console.error('[build] Error:', err);
  process.exit(1);
});
