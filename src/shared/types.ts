/**
 * @file types.ts
 * @description Shared TypeScript type definitions for the GestureScroll extension.
 *
 * All message schemas, gesture state enums, settings interfaces, and status
 * types are defined here and imported throughout the extension to ensure
 * type-safety across content scripts, popup, options page, and background worker.
 */

// ============================================================
// GESTURE STATE MACHINE
// ============================================================

/**
 * States of the gesture detection state machine.
 *
 * State transitions:
 *   IDLE → TRACKING (hand appears)
 *   TRACKING → GESTURE_UP_DETECTED (upward motion exceeds threshold)
 *   TRACKING → GESTURE_DOWN_DETECTED (downward motion exceeds threshold)
 *   GESTURE_UP_DETECTED → COOLDOWN (action dispatched)
 *   GESTURE_DOWN_DETECTED → COOLDOWN (action dispatched)
 *   COOLDOWN → IDLE (cooldown period expires)
 *   Any state → IDLE (hand disappears or error)
 */
export enum GestureState {
  IDLE = 'IDLE',
  TRACKING = 'TRACKING',
  GESTURE_UP_DETECTED = 'GESTURE_UP_DETECTED',
  GESTURE_DOWN_DETECTED = 'GESTURE_DOWN_DETECTED',
  COOLDOWN = 'COOLDOWN',
}

/** Detected gesture direction, if any. */
export type GestureDirection = 'UP' | 'DOWN' | 'NONE';

// ============================================================
// HANDEDNESS
// ============================================================

/** User-configurable handedness preference. */
export type HandednessPreference = 'EITHER' | 'LEFT' | 'RIGHT';

/** MediaPipe handedness label string. */
export type MediaPipeHandedness = 'Left' | 'Right';

// ============================================================
// CAMERA / VISION STATUS
// ============================================================

/**
 * All possible camera/vision pipeline statuses shown in the popup.
 */
export type CameraStatus =
  | 'OFF'
  | 'INITIALIZING'
  | 'ACTIVE'
  | 'PERMISSION_DENIED'
  | 'NO_DEVICE'
  | 'IN_USE'
  | 'STREAM_LOST'
  | 'MODEL_LOAD_ERROR'
  | 'ERROR';

/**
 * Human-readable labels for CameraStatus values.
 */
export const CAMERA_STATUS_LABELS: Record<CameraStatus, string> = {
  OFF: 'Camera Off',
  INITIALIZING: 'Initializing…',
  ACTIVE: 'Camera Active',
  PERMISSION_DENIED: 'Permission Denied',
  NO_DEVICE: 'No Camera Found',
  IN_USE: 'Camera In Use',
  STREAM_LOST: 'Stream Lost',
  MODEL_LOAD_ERROR: 'Model Load Error',
  ERROR: 'Error',
};

// ============================================================
// HAND DETECTION STATUS
// ============================================================

/**
 * Status of hand detection within the vision pipeline.
 */
export type HandDetectionStatus =
  | 'NO_HAND'
  | 'HAND_DETECTED'
  | 'MULTIPLE_HANDS'
  | 'LOW_CONFIDENCE'
  | 'PIPELINE_OFF';

// ============================================================
// PLATFORM / SITE STATUS
// ============================================================

/**
 * The current page/platform the content script is running on.
 */
export type PlatformStatus =
  | 'YOUTUBE_SHORTS'
  | 'INSTAGRAM_REELS'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

// ============================================================
// EXTENSION SETTINGS
// ============================================================

/**
 * All configurable settings persisted in chrome.storage.sync.
 *
 * These are the canonical defaults; use DEFAULT_SETTINGS from constants.ts
 * to initialise storage on first install.
 */
export interface ExtensionSettings {
  /** Whether the gesture pipeline is running. */
  enabled: boolean;

  /**
   * Dot product threshold for vertical pointing.
   */
  pointingThreshold: number;

  /**
   * Time window in milliseconds to hold the pointing gesture.
   */
  pointingHoldMs: number;

  /**
   * Continuous scroll speed.
   */
  scrollSpeed: number;

  /** Exponential smoothing factor α ∈ (0, 1]. Lower = smoother but laggier. */
  smoothingFactor: number;

  /** Preferred hand to track. */
  handedness: HandednessPreference;

  /**
   * MediaPipe minimum detection confidence (0.0 – 1.0).
   * Passed directly to the Hands model constructor.
   */
  minDetectionConfidence: number;

  /**
   * MediaPipe minimum tracking confidence (0.0 – 1.0).
   * Passed directly to the Hands model constructor.
   */
  minTrackingConfidence: number;

  /**
   * If true, gestures are only registered when exactly one hand is detected.
   * Useful to avoid ambiguous multi-hand detections.
   */
  requireSingleHand: boolean;

  /**
   * Debug mode: enables verbose console logging. Logs never leave the device.
   */
  debugMode: boolean;

  /**
   * Webcam width for getUserMedia constraint.
   */
  cameraWidth: number;

  /**
   * Webcam height for getUserMedia constraint.
   */
  cameraHeight: number;
}

// ============================================================
// RUNTIME STATE (not persisted — sent via messaging)
// ============================================================

/**
 * Snapshot of the current runtime state broadcast from the content script
 * to the popup via chrome.runtime messaging.
 */
export interface RuntimeState {
  gestureState: GestureState;
  lastGesture: GestureDirection;
  cameraStatus: CameraStatus;
  handDetectionStatus: HandDetectionStatus;
  platform: PlatformStatus;
  confidence: number;      // 0–1
  fps: number;
  multipleHandsVisible: boolean;
  errorMessage: string | null;
}

// ============================================================
// MESSAGE SCHEMAS (chrome.runtime messaging)
// ============================================================

/**
 * Discriminated union of all messages sent via chrome.runtime.sendMessage
 * or chrome.tabs.sendMessage.
 *
 * Naming convention:
 *   CS_ prefix = Content Script → Background/Popup
 *   BG_ prefix = Background → Content Script
 *   PP_ prefix = Popup → Content Script / Background
 *   OPT_ prefix = Options Page → Content Script
 */
export type ExtensionMessage =
  // ---- Popup ← Content Script: state updates ----
  | { action: 'CS_STATE_UPDATE'; payload: RuntimeState }

  // ---- Popup → Content Script: toggle on/off ----
  | { action: 'PP_SET_ENABLED'; payload: { enabled: boolean } }

  // ---- Popup → Background: request current state ----
  | { action: 'PP_REQUEST_STATE' }

  // ---- Background → Popup: relay of last known state ----
  | { action: 'BG_RELAY_STATE'; payload: RuntimeState | null }

  // ---- Options → Content Script: settings changed ----
  | { action: 'OPT_SETTINGS_CHANGED'; payload: Partial<ExtensionSettings> }

  // ---- Content Script → Background: gesture detected ----
  | { action: 'CS_GESTURE_DETECTED'; payload: { direction: GestureDirection } }

  // ---- Popup → Content Script: request immediate state ----
  | { action: 'PP_PING' }

  // ---- Content Script → Popup: response to ping ----
  | { action: 'CS_PONG'; payload: RuntimeState };

/** Type helper to extract payload from a specific message action. */
export type MessagePayload<A extends ExtensionMessage['action']> = Extract<
  ExtensionMessage,
  { action: A }
> extends { payload: infer P }
  ? P
  : never;
