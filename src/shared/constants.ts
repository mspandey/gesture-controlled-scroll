/**
 * @file constants.ts
 * @description Application-wide constants for GestureScroll.
 *
 * All magic numbers, storage keys, and default settings live here.
 * Import this file instead of scattering literal values across the codebase.
 */

// ============================================================
// GLOBAL DEBUG FLAG
// ============================================================

/**
 * Master switch for all diagnostic console.log output across the pipeline.
 * Set to true to enable the Step 1–7 instrumentation logs.
 * Set to false for production to silence all debug output.
 */
export const DEBUG = true;

import type { ExtensionSettings, RuntimeState } from './types';
import { GestureState } from './types';

// ============================================================
// CHROME STORAGE KEY
// ============================================================

/** The single key under which all settings are stored in chrome.storage.sync. */
export const STORAGE_KEY_SETTINGS = 'gestureScroll_settings';

/** Key under which the last known runtime state is cached in chrome.storage.local. */
export const STORAGE_KEY_RUNTIME_STATE = 'gestureScroll_runtimeState';

// ============================================================
// DEFAULT SETTINGS
// ============================================================

/**
 * Factory-default settings applied on first install or after a reset.
 * All values are documented in ExtensionSettings (types.ts).
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  motionThreshold: 0.06,       // Normalised Y-displacement (0–1) required
  motionWindowMs: 600,          // Time window to achieve displacement
  cooldownMs: 1000,             // Post-gesture lockout
  smoothingFactor: 0.3,         // EMA alpha — lower is smoother/slower
  handedness: 'EITHER',
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.5,
  requireSingleHand: false,
  debugMode: false,
  cameraWidth: 640,
  cameraHeight: 480,
};

// ============================================================
// LANDMARK INDICES (MediaPipe Hands — 21 landmarks)
// ============================================================

/**
 * MediaPipe Hands landmark indices.
 * Index 0 = WRIST (our primary reference landmark).
 * Indices 5, 9, 13, 17 = MCP joints of each finger (used for palm centroid).
 */
export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Palm landmark indices used to compute palm centroid (more stable than wrist alone). */
export const PALM_LANDMARKS = [
  LANDMARK.WRIST,
  LANDMARK.INDEX_MCP,
  LANDMARK.MIDDLE_MCP,
  LANDMARK.RING_MCP,
  LANDMARK.PINKY_MCP,
];

// ============================================================
// TIMING & PERFORMANCE
// ============================================================

/** Target frame processing interval in ms (≈30 FPS cap for CV pipeline). */
export const TARGET_FRAME_INTERVAL_MS = 1000 / 30;

/**
 * After this many milliseconds with confidence below the minimum threshold,
 * surface a "poor lighting" warning in the popup.
 */
export const LOW_CONFIDENCE_WARNING_DELAY_MS = 3000;

/**
 * After this many milliseconds with no hand detected, surface a "no hand"
 * status in the popup.
 */
export const NO_HAND_WARNING_DELAY_MS = 5000;

// ============================================================
// DEFAULT RUNTIME STATE
// ============================================================

/**
 * The initial / reset runtime state broadcast to the popup when no
 * content script is active or the pipeline hasn't started.
 */
export const DEFAULT_RUNTIME_STATE: RuntimeState = {
  gestureState: GestureState.IDLE,
  lastGesture: 'NONE',
  cameraStatus: 'OFF',
  handDetectionStatus: 'PIPELINE_OFF',
  platform: 'UNKNOWN',
  confidence: 0,
  fps: 0,
  multipleHandsVisible: false,
  errorMessage: null,
};

// ============================================================
// NEUTRAL ZONE
// ============================================================

/**
 * The normalised Y-band (centred on the anchor position) within which the
 * hand must re-enter before another gesture in the same direction can fire.
 * This implements the "neutral zone reset" debounce.
 *
 * Value is ±NEUTRAL_ZONE_HALF_WIDTH around the anchor Y.
 */
export const NEUTRAL_ZONE_HALF_WIDTH = 0.03;

// ============================================================
// MEDIAPIPE LOCAL PATH (web-accessible resource)
// ============================================================

/**
 * Base path for vendored MediaPipe files, resolved relative to the extension
 * root at runtime via chrome.runtime.getURL().
 * The content script uses this to pass locateFile() to the Hands model.
 */
export const MEDIAPIPE_BASE_PATH = 'assets/mediapipe/';
