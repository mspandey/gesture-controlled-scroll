/**
 * @file content-main.ts
 * @description Main content script — orchestrates the gesture pipeline on ANY page.
 *
 * ARCHITECTURE (v2 — universal):
 * ─────────────────────────────
 * The gesture engine (camera + MediaPipe + state machine) now runs on ALL
 * websites, not just YouTube Shorts / Instagram Reels. Navigation actions
 * (goToNext / goToPrevious) only fire when a platform adapter matches the
 * current page. On unsupported pages the engine still runs and reports
 * detected gestures to the popup for debugging / visibility.
 *
 * STEP 1–7 DIAGNOSTIC LOGS are baked into every stage. All are gated behind
 * the DEBUG flag in shared/constants.ts. Set DEBUG=false for production.
 *
 * BUILD FORMAT NOTE:
 * ─────────────────
 * This file MUST be built with format: 'iife' (see build.mjs).
 * ESM format is blocked by YouTube/Instagram CSP when injected into MAIN world.
 * IIFE produces a plain self-executing function with no bare module specifiers.
 */

// ── STEP 1: Confirm content script injection ──────────────────────────────
// This log appears at the bottom of the IIFE (after all class definitions,
// which esbuild hoists). If it does NOT appear in DevTools Console:
//   1. Verify dist/ folder is loaded (not project root or src/).
//   2. Check chrome://extensions for red "Errors" button — click it.
//   3. Check DevTools → Sources → "Content scripts" — is content-main.js listed?
//      If yes but log missing: CSP is still blocking (did you rebuild with IIFE?).
//      If no: manifest content_scripts declaration is wrong.
console.log('[GestureScroll] STEP 1 ✓ CONTENT SCRIPT INJECTED', window.location.href, Date.now());

import { CameraManager } from '../vision/camera-manager';
import { HandTracker } from '../vision/hand-tracker';
import { detectAdapter } from './adapters/adapter-registry';
import { loadSettings, onSettingsChanged } from '../shared/storage';
import type { ExtensionSettings, GestureDirection, RuntimeState } from '../shared/types';
import { GestureState } from '../shared/types';
import { DEFAULT_RUNTIME_STATE, DEBUG } from '../shared/constants';

// ── Debug logger (gated by DEBUG flag) ───────────────────────────────────
function dbg(...args: unknown[]): void {
  if (DEBUG) console.log('[GestureScroll]', ...args);
}

// ============================================================
// MODULE STATE
// ============================================================

let _settings: ExtensionSettings | null = null;
let _cameraManager: CameraManager | null = null;
let _handTracker: HandTracker | null = null;
let _currentState: RuntimeState = { ...DEFAULT_RUNTIME_STATE };
let _stateUpdateTimer: ReturnType<typeof setInterval> | null = null;
let _cleanupSettingsListener: (() => void) | null = null;
let _isInitialising = false;

// ============================================================
// INITIALISATION
// ============================================================

async function init(): Promise<void> {
  if (_isInitialising) return;
  _isInitialising = true;

  try {
    // Detect adapter (may be null on unsupported pages — that's fine now)
    const adapter = detectAdapter();
    if (adapter) {
      dbg(`STEP 1b ✓ Platform adapter matched: ${adapter.platformName}`);
      _currentState.platform = adapter.platformName;
    } else {
      dbg('STEP 1b — No platform adapter matched for', window.location.href,
          '— gesture engine will run but navigation actions are disabled.');
      _currentState.platform = 'UNSUPPORTED';
    }

    // Load persisted settings.
    _settings = await loadSettings();
    dbg('Settings loaded:', JSON.stringify(_settings));

    // Register incoming messages from popup / options.
    registerMessageListeners(adapter);

    // Listen for storage changes (options page updates settings).
    _cleanupSettingsListener = onSettingsChanged(async (newSettings) => {
      _settings = newSettings;
      _handTracker?.updateSettings(newSettings);
      _cameraManager?.updateConfig({
        width: newSettings.cameraWidth,
        height: newSettings.cameraHeight,
      });
      dbg('Settings updated from storage:', newSettings);
    });

    // Start the pipeline if enabled.
    if (_settings.enabled) {
      await startPipeline(adapter);
    } else {
      _currentState.cameraStatus = 'OFF';
      dbg('Extension is disabled in settings — pipeline not started.');
    }

    // Broadcast state to popup at a regular cadence (1 Hz background tick).
    _stateUpdateTimer = setInterval(() => broadcastState(), 1000);

  } catch (err) {
    console.error('[GestureScroll] Content script init error:', err);
    _currentState.errorMessage = String(err);
    _currentState.cameraStatus = 'ERROR';
  } finally {
    _isInitialising = false;
  }
}

// ============================================================
// PIPELINE START / STOP
// ============================================================

async function startPipeline(
  adapter: ReturnType<typeof detectAdapter>
): Promise<void> {
  if (!_settings) return;

  dbg('Starting gesture pipeline on', window.location.href);

  // Initialise CameraManager.
  _cameraManager = new CameraManager(
    { width: _settings.cameraWidth, height: _settings.cameraHeight },
    {
      onReady: async (video) => {
        // STEP 2 confirmation — logged inside CameraManager, echoed here.
        dbg('STEP 2 ✓ Camera ready. readyState=', video.readyState,
            'videoWidth=', video.videoWidth, 'videoHeight=', video.videoHeight);
        await initHandTracker(video, adapter);
      },
      onStatusChange: (status, message) => {
        dbg('Camera status →', status, message ?? '');
        _currentState.cameraStatus = status;
        _currentState.errorMessage = message;
        broadcastState();
      },
      onStreamLost: () => {
        dbg('Stream lost — stopping pipeline.');
        stopPipeline();
        _currentState.cameraStatus = 'STREAM_LOST';
        broadcastState();
      },
    }
  );

  const video = await _cameraManager.start();
  if (!video) {
    dbg('STEP 2 ✗ Camera start() returned null — camera failed. Check error above.');
    return;
  }
}

async function initHandTracker(
  video: HTMLVideoElement,
  adapter: ReturnType<typeof detectAdapter>
): Promise<void> {
  if (!_settings) return;

  _handTracker = new HandTracker(
    _settings,
    // ── STEP 7: Gesture-to-action dispatch ───────────────────────────────
    (direction: GestureDirection) => {
      dbg('STEP 6 ✓ Gesture confirmed by state machine:', direction);
      _currentState.lastGesture = direction;

      if (adapter) {
        dbg('STEP 7 — Dispatching navigation via', adapter.platformName,
            '— direction:', direction);
        try {
          if (direction === 'UP') {
            adapter.goToPrevious();
            dbg('STEP 7 ✓ goToPrevious() called');
          } else if (direction === 'DOWN') {
            adapter.goToNext();
            dbg('STEP 7 ✓ goToNext() called');
          }
        } catch (navErr) {
          console.error('[GestureScroll] Navigation error:', navErr);
        }
      } else {
        dbg('STEP 7 — No adapter matched — gesture detected but no navigation action (unsupported page).');
      }

      broadcastState();

      chrome.runtime.sendMessage({
        action: 'CS_GESTURE_DETECTED',
        payload: { direction },
      }).catch(() => { /* background may be inactive */ });
    },
    // Per-frame status callback.
    (frameStatus) => {
      _currentState.confidence = frameStatus.confidence;
      _currentState.fps = frameStatus.fps;
      _currentState.handDetectionStatus = frameStatus.handDetectionStatus;
      _currentState.gestureState = frameStatus.gestureState;
      _currentState.multipleHandsVisible = frameStatus.multipleHandsVisible;
      _currentState.errorMessage = null;
    }
  );

  try {
    dbg('STEP 3 — Calling HandTracker.loadModel()…');
    await _handTracker.loadModel();
    dbg('STEP 3 ✓ MediaPipe model loaded successfully.');

    _handTracker.start(video);
    dbg('STEP 4 — HandTracker inference loop started. Watching for frames…');
  } catch (err) {
    console.error('[GestureScroll] STEP 3 ✗ Failed to load MediaPipe model:', err);
    _currentState.cameraStatus = 'MODEL_LOAD_ERROR';
    _currentState.errorMessage = 'MediaPipe model failed to load. Check assets/mediapipe/ files and web_accessible_resources.';
    broadcastState();
  }
}

function stopPipeline(): void {
  dbg('Stopping gesture pipeline…');
  _handTracker?.stop();
  _handTracker = null;
  _cameraManager?.stop();
  _cameraManager = null;

  _currentState.gestureState = GestureState.IDLE;
  _currentState.lastGesture = 'NONE';
  _currentState.cameraStatus = 'OFF';
  _currentState.handDetectionStatus = 'PIPELINE_OFF';
  _currentState.confidence = 0;
  _currentState.fps = 0;
  broadcastState();
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

function registerMessageListeners(
  adapter: ReturnType<typeof detectAdapter>
): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse): boolean | undefined => {
      if (typeof message !== 'object' || message === null) return undefined;
      const msg = message as { action: string; payload?: unknown };

      switch (msg.action) {
        case 'PP_SET_ENABLED': {
          const { enabled } = msg.payload as { enabled: boolean };
          if (_settings) _settings.enabled = enabled;
          dbg('PP_SET_ENABLED →', enabled);
          if (enabled) {
            startPipeline(adapter).catch((e) =>
              console.error('[GestureScroll] startPipeline error:', e)
            );
          } else {
            stopPipeline();
          }
          sendResponse(undefined);
          return undefined;
        }

        case 'OPT_SETTINGS_CHANGED': {
          const patch = msg.payload as Partial<ExtensionSettings>;
          if (_settings) {
            _settings = { ..._settings, ...patch };
            _handTracker?.updateSettings(_settings);
          }
          sendResponse(undefined);
          return undefined;
        }

        case 'PP_PING': {
          sendResponse({ action: 'CS_PONG', payload: { ..._currentState } });
          return undefined;
        }
      }
      return undefined;
    }
  );
}

// ============================================================
// STATE BROADCAST
// ============================================================

function broadcastState(): void {
  const snapshot: RuntimeState = { ..._currentState };
  chrome.runtime.sendMessage({ action: 'CS_STATE_UPDATE', payload: snapshot })
    .catch(() => { /* popup/background may be closed */ });
}

// ============================================================
// CLEANUP ON NAVIGATION
// ============================================================

window.addEventListener('beforeunload', () => {
  stopPipeline();
  if (_stateUpdateTimer) clearInterval(_stateUpdateTimer);
  _cleanupSettingsListener?.();
});

// ============================================================
// BOOT
// ============================================================
// Guard: In MAIN world, chrome.runtime.id is undefined if the extension has
// been reloaded or invalidated (e.g., after an extension update while the tab
// is open). Calling any chrome.* API in that state throws:
//   "Extension context invalidated."
// We detect this early and bail with a clear log rather than crashing silently.
(function bootGestureScroll() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rtId = (chrome as unknown as { runtime?: { id?: string } }).runtime?.id;
    if (!rtId) {
      console.warn('[GestureScroll] Extension context not available (runtime.id is falsy). ' +
        'This can happen if the extension was reloaded while this tab was open. ' +
        'Reload the page to reinitialise GestureScroll.');
      return;
    }
  } catch (e) {
    console.warn('[GestureScroll] chrome.runtime access threw:', e, ' — page likely blocked extension APIs.');
    return;
  }

  init().catch((err) => console.error('[GestureScroll] Fatal init error:', err));
}());
