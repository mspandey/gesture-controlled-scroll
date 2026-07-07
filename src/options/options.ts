/**
 * @file options.ts
 * @description Options page controller for GestureScroll.
 *
 * Handles:
 * - Loading saved settings and populating all form controls.
 * - Live-updating settings on any input change (debounced 300ms).
 * - Persisting to chrome.storage.sync and broadcasting via messaging.
 * - Live camera preview with MediaPipe Hands landmark overlay.
 * - Reset to defaults button.
 * - Version display in sidebar.
 */

import {
  loadSettings,
  patchSettings,
  resetSettings,
} from '../shared/storage';
import type { ExtensionSettings, HandednessPreference } from '../shared/types';
import { DEFAULT_SETTINGS, MEDIAPIPE_BASE_PATH, PALM_LANDMARKS } from '../shared/constants';

// ============================================================
// TYPE HELPERS
// ============================================================

type NormalizedLandmark = { x: number; y: number; z: number };
interface HandsResults {
  multiHandLandmarks?: NormalizedLandmark[][];
  image?: HTMLVideoElement;
}
interface MediaPipeHands {
  setOptions(o: object): void;
  onResults(cb: (r: HandsResults) => void): void;
  send(i: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const $inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement;

// Sliders
const motionThreshold = $inp('motion-threshold');
const motionThresholdVal = $('motion-threshold-value');
const motionWindow = $inp('motion-window');
const motionWindowVal = $('motion-window-value');
const cooldown = $inp('cooldown');
const cooldownVal = $('cooldown-value');
const smoothing = $inp('smoothing');
const smoothingVal = $('smoothing-value');
const minDetectionConf = $inp('min-detection-confidence');
const minDetectionConfVal = $('min-detection-confidence-value');
const minTrackingConf = $inp('min-tracking-confidence');
const minTrackingConfVal = $('min-tracking-confidence-value');
// Selects
const handedness = $sel('handedness');
const cameraResolution = $sel('camera-resolution');
// Checkboxes
const requireSingleHand = $inp('require-single-hand');
const debugMode = $inp('debug-mode');
// Buttons
const resetBtn = $('reset-btn');
const previewStartBtn = $('preview-start-btn') as HTMLButtonElement;
const previewStopBtn = $('preview-stop-btn') as HTMLButtonElement;
// Save status
const saveStatus = $('save-status');
// Preview
const previewVideo = $<HTMLVideoElement>('preview-video');
const previewCanvas = $<HTMLCanvasElement>('preview-canvas');
const previewStatusText = $('preview-status-text');
const previewFPS = $('preview-fps');
const previewConf = $('preview-confidence');
const previewHand = $('preview-hand');

// ============================================================
// PREVIEW STATE
// ============================================================

let _previewStream: MediaStream | null = null;
let _previewHands: MediaPipeHands | null = null;
let _previewRunning = false;
let _previewRafId: number | null = null;

// ============================================================
// INITIALISATION
// ============================================================

async function init(): Promise<void> {
  // Show extension version
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('ext-version');
  if (versionEl) versionEl.textContent = `v${manifest.version}`;

  // Load settings and populate controls
  const settings = await loadSettings();
  populateControls(settings);

  // Wire up all inputs
  wireInputs();

  // Reset button
  resetBtn.addEventListener('click', async () => {
    const defaults = await resetSettings();
    populateControls(defaults);
    showSaveStatus('Reset to defaults');
    broadcastSettings(defaults);
  });

  // Preview buttons
  previewStartBtn.addEventListener('click', startPreview);
  previewStopBtn.addEventListener('click', stopPreview);

  // Nav link smooth-scroll
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = (link as HTMLAnchorElement).getAttribute('href') ?? '';
      const section = document.querySelector(target);
      if (section) section.scrollIntoView({ behavior: 'smooth' });
      document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

// ============================================================
// POPULATE CONTROLS
// ============================================================

function populateControls(settings: ExtensionSettings): void {
  motionThreshold.value = String(settings.motionThreshold);
  motionThresholdVal.textContent = `${Math.round(settings.motionThreshold * 100)}%`;

  motionWindow.value = String(settings.motionWindowMs);
  motionWindowVal.textContent = `${settings.motionWindowMs}ms`;

  cooldown.value = String(settings.cooldownMs);
  cooldownVal.textContent = `${settings.cooldownMs}ms`;

  smoothing.value = String(settings.smoothingFactor);
  smoothingVal.textContent = settings.smoothingFactor.toFixed(2);

  minDetectionConf.value = String(settings.minDetectionConfidence);
  minDetectionConfVal.textContent = `${Math.round(settings.minDetectionConfidence * 100)}%`;

  minTrackingConf.value = String(settings.minTrackingConfidence);
  minTrackingConfVal.textContent = `${Math.round(settings.minTrackingConfidence * 100)}%`;

  handedness.value = settings.handedness;

  const resKey = `${settings.cameraWidth}x${settings.cameraHeight}`;
  cameraResolution.value = ['320x240', '640x480', '1280x720'].includes(resKey) ? resKey : '640x480';

  requireSingleHand.checked = settings.requireSingleHand;
  debugMode.checked = settings.debugMode;
}

// ============================================================
// WIRE INPUTS
// ============================================================

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function wireInputs(): void {
  const schedSave = () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveSettings, 300);
  };

  // Sliders with live value display
  motionThreshold.addEventListener('input', () => {
    motionThresholdVal.textContent = `${Math.round(parseFloat(motionThreshold.value) * 100)}%`;
    schedSave();
  });
  motionWindow.addEventListener('input', () => {
    motionWindowVal.textContent = `${motionWindow.value}ms`;
    schedSave();
  });
  cooldown.addEventListener('input', () => {
    cooldownVal.textContent = `${cooldown.value}ms`;
    schedSave();
  });
  smoothing.addEventListener('input', () => {
    smoothingVal.textContent = parseFloat(smoothing.value).toFixed(2);
    schedSave();
  });
  minDetectionConf.addEventListener('input', () => {
    minDetectionConfVal.textContent = `${Math.round(parseFloat(minDetectionConf.value) * 100)}%`;
    schedSave();
  });
  minTrackingConf.addEventListener('input', () => {
    minTrackingConfVal.textContent = `${Math.round(parseFloat(minTrackingConf.value) * 100)}%`;
    schedSave();
  });
  handedness.addEventListener('change', schedSave);
  cameraResolution.addEventListener('change', schedSave);
  requireSingleHand.addEventListener('change', schedSave);
  debugMode.addEventListener('change', schedSave);
}

// ============================================================
// READ FORM STATE
// ============================================================

function readFormSettings(): ExtensionSettings {
  const [camWidth, camHeight] = (cameraResolution.value ?? '640x480').split('x').map(Number);
  return {
    ...DEFAULT_SETTINGS,
    motionThreshold: parseFloat(motionThreshold.value),
    motionWindowMs: parseInt(motionWindow.value, 10),
    cooldownMs: parseInt(cooldown.value, 10),
    smoothingFactor: parseFloat(smoothing.value),
    minDetectionConfidence: parseFloat(minDetectionConf.value),
    minTrackingConfidence: parseFloat(minTrackingConf.value),
    handedness: handedness.value as HandednessPreference,
    cameraWidth: camWidth || 640,
    cameraHeight: camHeight || 480,
    requireSingleHand: requireSingleHand.checked,
    debugMode: debugMode.checked,
    // Preserve the enabled state from storage (don't override from the form)
    enabled: true,
  };
}

// ============================================================
// SAVE SETTINGS
// ============================================================

async function saveSettings(): Promise<void> {
  try {
    // Preserve the current enabled state from storage before overwriting
    const current = await loadSettings();
    const formSettings = readFormSettings();
    const merged: ExtensionSettings = { ...formSettings, enabled: current.enabled };

    await patchSettings(merged);
    broadcastSettings(merged);
    showSaveStatus('Saved ✓');
  } catch (err) {
    showSaveStatus('Save failed ✗');
    console.error('[GestureScroll Options] Save error:', err);
  }
}

function broadcastSettings(settings: ExtensionSettings): void {
  chrome.runtime.sendMessage({
    action: 'OPT_SETTINGS_CHANGED',
    payload: settings,
  }).catch(() => { /* background may be inactive */ });
}

function showSaveStatus(message: string): void {
  saveStatus.textContent = message;
  saveStatus.className = 'save-status visible';
  setTimeout(() => {
    saveStatus.className = 'save-status';
  }, 2000);
}

// ============================================================
// LIVE PREVIEW
// ============================================================

async function startPreview(): Promise<void> {
  if (_previewRunning) return;
  _previewRunning = true;
  previewStartBtn.disabled = true;
  previewStopBtn.disabled = false;
  previewStatusText.textContent = 'Starting camera…';
  previewStatusText.style.display = 'flex';

  try {
    const settings = await loadSettings();
    _previewStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: settings.cameraWidth }, height: { ideal: settings.cameraHeight }, facingMode: 'user' },
      audio: false,
    });
    previewVideo.srcObject = _previewStream;
    await previewVideo.play();

    // Set canvas size.
    previewCanvas.width = previewVideo.videoWidth || settings.cameraWidth;
    previewCanvas.height = previewVideo.videoHeight || settings.cameraHeight;

    previewStatusText.style.display = 'none';

    // Load MediaPipe Hands for the preview.
    await loadPreviewHands(settings);
    startPreviewLoop();
  } catch (err) {
    const msg = err instanceof DOMException && err.name === 'NotAllowedError'
      ? 'Camera permission denied.'
      : `Camera error: ${String(err)}`;
    previewStatusText.textContent = msg;
    previewStatusText.style.display = 'flex';
    previewStartBtn.disabled = false;
    previewStopBtn.disabled = true;
    _previewRunning = false;
  }
}

function stopPreview(): void {
  _previewRunning = false;
  if (_previewRafId !== null) {
    cancelAnimationFrame(_previewRafId);
    _previewRafId = null;
  }
  _previewHands?.close();
  _previewHands = null;
  _previewStream?.getTracks().forEach((t) => t.stop());
  _previewStream = null;
  previewVideo.srcObject = null;
  const ctx = previewCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewStatusText.textContent = 'Press "Start Preview" to begin';
  previewStatusText.style.display = 'flex';
  previewStartBtn.disabled = false;
  previewStopBtn.disabled = true;
  previewFPS.textContent = 'FPS: —';
  previewConf.textContent = 'Confidence: —';
  previewHand.textContent = 'Hand: —';
}

async function loadPreviewHands(settings: ExtensionSettings): Promise<void> {
  // Inject MediaPipe Hands script if not already present
  await injectScript(chrome.runtime.getURL(`${MEDIAPIPE_BASE_PATH}hands.js`));

  // hands.js is a loader that async-initialises window.Hands after fetching
  // the WASM bundle. Poll until ready (max 10 s).
  const HandsConstructor = await waitForGlobal<
    new (o: { locateFile: (f: string) => string }) => MediaPipeHands
  >('Hands', 10000);

  if (!HandsConstructor) throw new Error('MediaPipe Hands not available after 10 s');

  _previewHands = new HandsConstructor({
    locateFile: (file: string) => chrome.runtime.getURL(`${MEDIAPIPE_BASE_PATH}${file}`),
  });
  _previewHands.setOptions({
    selfieMode: true,
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: settings.minDetectionConfidence,
    minTrackingConfidence: settings.minTrackingConfidence,
  });

  let _lastFPSTime = performance.now();
  let _frameCount = 0;

  _previewHands.onResults((results: HandsResults) => {
    _frameCount++;
    const now = performance.now();
    if (now - _lastFPSTime >= 1000) {
      previewFPS.textContent = `FPS: ${_frameCount}`;
      _frameCount = 0;
      _lastFPSTime = now;
    }
    _lastResults = results;
  });
}

let _lastResults: HandsResults | null = null;
let _isProcessingFrame = false;

function startPreviewLoop(): void {
  console.log('[GestureScroll] startPreviewLoop started');
  const tick = async () => {
    if (!_previewRunning || !_previewHands) {
      console.log('[GestureScroll] tick aborted: running=', _previewRunning, 'hands=', !!_previewHands);
      return;
    }
    
    const ctx = previewCanvas.getContext('2d');
    
    // Debug ready state if it's not ready
    if (previewVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      console.log('[GestureScroll] video not ready. readyState=', previewVideo.readyState);
    }

    if (ctx && previewVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Clear the canvas. The video is rendered via CSS behind it.
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      
      // Draw landmarks if available
      if (_lastResults) {
        const landmarks = _lastResults.multiHandLandmarks ?? [];
        const handedness_ = (_lastResults as unknown as { multiHandedness?: Array<{ label: string; score: number }> }).multiHandedness ?? [];

        if (landmarks.length === 0) {
          previewConf.textContent = 'Confidence: —';
          previewHand.textContent = 'Hand: None';
        } else {
          landmarks.forEach((lms, i) => {
            const conf = handedness_[i]?.score ?? 0;
            const label = handedness_[i]?.label ?? '?';
            previewConf.textContent = `Confidence: ${Math.round(conf * 100)}%`;
            previewHand.textContent = `Hand: ${label}`;

            const w = previewCanvas.width;
            const h = previewCanvas.height;

            const connections: [number, number][] = [
              [0,1],[1,2],[2,3],[3,4],
              [0,5],[5,6],[6,7],[7,8],
              [0,9],[9,10],[10,11],[11,12],
              [0,13],[13,14],[14,15],[15,16],
              [0,17],[17,18],[18,19],[19,20],
              [5,9],[9,13],[13,17],
            ];
            ctx.strokeStyle = i === 0 ? 'rgba(74,222,128,0.85)' : 'rgba(251,191,36,0.85)';
            ctx.lineWidth = 2.5;
            for (const [a, b] of connections) {
              const la = lms[a]; const lb = lms[b];
              if (!la || !lb) continue;
              ctx.beginPath();
              ctx.moveTo(la.x * w, la.y * h);
              ctx.lineTo(lb.x * w, lb.y * h);
              ctx.stroke();
            }

            for (const lm of lms) {
              ctx.beginPath();
              ctx.arc(lm.x * w, lm.y * h, 5, 0, Math.PI * 2);
              ctx.fillStyle = PALM_LANDMARKS.includes(lms.indexOf(lm)) ? 'rgba(252,211,77,0.95)' : 'rgba(248,250,252,0.85)';
              ctx.fill();
            }
          });
        }
      }
    }

    if (previewVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (!_isProcessingFrame) {
        _isProcessingFrame = true;
        _previewHands.send({ image: previewVideo })
          .then(() => {
            _isProcessingFrame = false;
          })
          .catch((err) => {
            console.error('[GestureScroll Options] MediaPipe Hands error:', err);
            _isProcessingFrame = false;
          });
      }
    }
    
    _previewRafId = requestAnimationFrame(tick);
  };
  _previewRafId = requestAnimationFrame(tick);
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-gs-src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.setAttribute('data-gs-src', src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Polls window[key] until truthy or timeout. MediaPipe's hands.js sets
 * window.Hands async (after WASM fetch), so script.onload is not enough.
 */
function waitForGlobal<T>(key: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const val = (window as unknown as Record<string, unknown>)[key] as T | undefined;
      if (val) { resolve(val); return; }
      if (Date.now() - start > timeoutMs) { resolve(null); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error('[GestureScroll Options] Init error:', err));
});
