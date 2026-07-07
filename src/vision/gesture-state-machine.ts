/**
 * @file gesture-state-machine.ts
 * @description Gesture recognition state machine for GestureScroll.
 *
 * The state machine takes smoothed Y-coordinate updates from the hand tracker
 * and produces gesture events (UP / DOWN) using a threshold + time-window
 * approach with debouncing and cooldown.
 *
 * ============================================================
 * STATE DIAGRAM
 * ============================================================
 *
 *           ┌──────────────────────────────────────────────────────┐
 *           │                                                      ▼
 *  IDLE ─handAppears─► TRACKING ─thresholdDown─► GESTURE_DOWN ─dispatch─► COOLDOWN
 *    ▲                    │  ▲                                              │
 *    │                    │  └──── returns to neutral zone ────────────────►│
 *    │                    │                                                  │
 *    │              thresholdUp                                              │
 *    │                    │                                                  │
 *    │                    ▼                                                  │
 *    │             GESTURE_UP ──dispatch──────────────────────────►COOLDOWN──┘
 *    │                                                                       │
 *    └─ handDisappears (from any state) ◄────── cooldownExpires ────────────┘
 *
 * ============================================================
 * KEY CONCEPTS
 * ============================================================
 *
 * 1. ANCHOR POSITION
 *    When tracking begins (hand first detected), the current smoothed Y
 *    is recorded as the "anchor". Subsequent displacement is measured
 *    relative to this anchor.
 *
 * 2. MOTION THRESHOLD
 *    A gesture fires only when |smoothedY - anchorY| ≥ motionThreshold
 *    AND the displacement occurred within motionWindowMs.
 *
 * 3. NEUTRAL ZONE DEBOUNCE
 *    After a gesture fires, the anchor updates so the hand must return
 *    to within ±NEUTRAL_ZONE_HALF_WIDTH of the new anchor before another
 *    gesture in the same direction can fire. This prevents a slow drift
 *    from triggering multiple gestures.
 *
 * 4. COOLDOWN
 *    After any gesture fires, the machine enters COOLDOWN state for
 *    cooldownMs. No gestures are processed during this period.
 *
 * 5. DIRECTION LOCKING
 *    Once a GESTURE_UP or GESTURE_DOWN is detected, the machine locks on
 *    that direction through the COOLDOWN, then resets to IDLE.
 */

import { GestureState, GestureDirection } from '../shared/types';
import {
  NEUTRAL_ZONE_HALF_WIDTH,
} from '../shared/constants';

/** Configuration consumed by the state machine. */
export interface GestureStateMachineConfig {
  /** Minimum normalised Y displacement to register a gesture. */
  motionThreshold: number;
  /** Time window in ms within which displacement must occur. */
  motionWindowMs: number;
  /** Cooldown period in ms after a gesture fires. */
  cooldownMs: number;
}

/** Callback invoked when a gesture is confirmed. */
export type GestureCallback = (direction: GestureDirection) => void;

/**
 * Gesture recognition state machine.
 *
 * Feed smoothed Y-coordinate updates via `update()` and subscribe to
 * confirmed gestures via the `onGesture` callback.
 */
export class GestureStateMachine {
  private _state: GestureState = GestureState.IDLE;
  private _config: GestureStateMachineConfig;
  private _onGesture: GestureCallback;

  /** Y position when tracking started (anchor for displacement). */
  private _anchorY: number = 0;
  /** Timestamp (ms) when the current tracking anchor was set. */
  private _anchorTime: number = 0;
  /** Direction of the last successfully fired gesture (for neutral-zone reset). */
  private _lastFiredDirection: GestureDirection = 'NONE';
  /** Whether the hand has re-entered the neutral zone since last gesture. */
  private _neutralZoneReset: boolean = true;
  /** Timestamp when COOLDOWN started. */
  private _cooldownStartTime: number = 0;

  /**
   * @param config  - State machine configuration (thresholds, timing).
   * @param onGesture - Callback invoked when a gesture is confirmed.
   */
  constructor(config: GestureStateMachineConfig, onGesture: GestureCallback) {
    this._config = config;
    this._onGesture = onGesture;
  }

  /** Current state of the machine. */
  get state(): GestureState {
    return this._state;
  }

  /**
   * Updates state machine configuration at runtime (e.g., when user changes
   * settings) without resetting the machine state.
   *
   * @param patch - Partial configuration override.
   */
  updateConfig(patch: Partial<GestureStateMachineConfig>): void {
    this._config = { ...this._config, ...patch };
  }

  /**
   * Main update method. Call once per frame with the latest smoothed Y
   * coordinate of the reference landmark.
   *
   * Y is in normalised MediaPipe space: 0 = top of frame, 1 = bottom.
   * Upward hand motion → DECREASING Y value.
   * Downward hand motion → INCREASING Y value.
   *
   * @param smoothedY - Normalised Y coordinate (0–1) after EMA filtering.
   * @param now       - Current timestamp in ms (default: performance.now()).
   */
  update(smoothedY: number, now: number = performance.now()): void {
    switch (this._state) {
      case GestureState.IDLE:
        // Hand has appeared; begin tracking.
        this._enterTracking(smoothedY, now);
        break;

      case GestureState.TRACKING:
        this._processTracking(smoothedY, now);
        break;

      case GestureState.GESTURE_UP_DETECTED:
      case GestureState.GESTURE_DOWN_DETECTED:
        // Dispatch is handled synchronously in processTracking;
        // these states transition to COOLDOWN immediately.
        // Nothing to do here — just wait.
        break;

      case GestureState.COOLDOWN:
        this._processCooldown(smoothedY, now);
        break;
    }
  }

  /**
   * Call when the hand disappears from the frame. Resets the machine to IDLE.
   */
  handLost(): void {
    this._reset();
  }

  /**
   * Hard reset — call this when the pipeline stops or settings change.
   */
  reset(): void {
    this._reset();
  }

  // ----------------------------------------------------------
  // Private state handlers
  // ----------------------------------------------------------

  private _enterTracking(smoothedY: number, now: number): void {
    this._state = GestureState.TRACKING;
    this._anchorY = smoothedY;
    this._anchorTime = now;
    this._neutralZoneReset = true;
  }

  private _processTracking(smoothedY: number, now: number): void {
    const displacement = smoothedY - this._anchorY; // + = downward, - = upward
    const elapsed = now - this._anchorTime;

    // Update anchor if the hand is "resting" (small movement over time)
    // to prevent stale anchors from accumulating drift.
    if (elapsed > this._config.motionWindowMs && Math.abs(displacement) < this._config.motionThreshold) {
      // Slowly drift anchor toward current position (track resting hand).
      this._anchorY = smoothedY;
      this._anchorTime = now;
      return;
    }

    // --- Check neutral-zone reset for debouncing ---
    // After a gesture, require the hand to return near the anchor before
    // another same-direction gesture can fire.
    if (!this._neutralZoneReset) {
      if (Math.abs(displacement) <= NEUTRAL_ZONE_HALF_WIDTH) {
        this._neutralZoneReset = true;
        // Reset anchor to current position once neutral zone is re-entered.
        this._anchorY = smoothedY;
        this._anchorTime = now;
      }
      return;
    }

    // --- Check if motion threshold exceeded within window ---
    if (elapsed > this._config.motionWindowMs) {
      // Window expired without crossing threshold — roll anchor forward.
      this._anchorY = smoothedY;
      this._anchorTime = now;
      return;
    }

    if (Math.abs(displacement) >= this._config.motionThreshold) {
      const direction: GestureDirection = displacement < 0 ? 'UP' : 'DOWN';
      this._fireGesture(direction, smoothedY, now);
    }
  }

  private _fireGesture(direction: GestureDirection, smoothedY: number, now: number): void {
    // Transition to detected state momentarily for UI feedback.
    this._state =
      direction === 'UP'
        ? GestureState.GESTURE_UP_DETECTED
        : GestureState.GESTURE_DOWN_DETECTED;

    this._lastFiredDirection = direction;
    this._neutralZoneReset = false; // require return to neutral before re-firing
    this._anchorY = smoothedY;      // anchor shifts to where gesture ended
    this._cooldownStartTime = now;

    // Notify the consumer synchronously.
    this._onGesture(direction);

    // Immediately transition to COOLDOWN.
    this._state = GestureState.COOLDOWN;
  }

  private _processCooldown(smoothedY: number, now: number): void {
    const elapsed = now - this._cooldownStartTime;
    if (elapsed >= this._config.cooldownMs) {
      // Cooldown expired — back to TRACKING (hand is still visible).
      this._state = GestureState.TRACKING;
      this._anchorY = smoothedY;
      this._anchorTime = now;
      this._neutralZoneReset = true;
    }
    // During cooldown, ignore all updates (do nothing).
    void this._lastFiredDirection; // suppress unused warning
  }

  private _reset(): void {
    this._state = GestureState.IDLE;
    this._anchorY = 0;
    this._anchorTime = 0;
    this._neutralZoneReset = true;
    this._lastFiredDirection = 'NONE';
    this._cooldownStartTime = 0;
  }
}
