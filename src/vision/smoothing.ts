/**
 * @file smoothing.ts
 * @description Exponential Moving Average (EMA) filter for landmark coordinates.
 *
 * The EMA filter reduces jitter in the raw MediaPipe landmark Y-coordinates
 * without introducing complex multi-sample buffers. It is computationally
 * trivial and adds zero latency beyond one frame.
 *
 * Formula:
 *   smoothed_t = α × raw_t + (1 − α) × smoothed_{t-1}
 *
 * α (smoothingFactor) ∈ (0, 1]:
 *   α = 1.0 → no smoothing (raw value every frame)
 *   α = 0.1 → heavy smoothing (slow to respond, very jitter-free)
 *   α = 0.3 → recommended default (good balance of speed and stability)
 */

/**
 * Exponential Moving Average filter for a single scalar value.
 *
 * Usage:
 *   const filter = new EMAFilter(0.3);
 *   const smoothed = filter.update(rawValue);
 */
export class EMAFilter {
  private _alpha: number;
  private _value: number | null = null; // null until the first sample arrives

  /**
   * Creates a new EMAFilter.
   *
   * @param alpha - Smoothing factor ∈ (0, 1]. Default 0.3.
   */
  constructor(alpha: number = 0.3) {
    this._alpha = this._clampAlpha(alpha);
  }

  /** Returns the current smoothing factor. */
  get alpha(): number {
    return this._alpha;
  }

  /**
   * Updates the smoothing factor without resetting the filter state.
   * Useful when the user changes settings mid-session.
   *
   * @param alpha - New smoothing factor ∈ (0, 1].
   */
  set alpha(alpha: number) {
    this._alpha = this._clampAlpha(alpha);
  }

  /**
   * Feeds a new raw sample into the filter and returns the smoothed value.
   *
   * On the very first call the raw value is returned as-is and used to
   * initialise the filter state, avoiding a slow ramp-up from 0.
   *
   * @param rawValue - The raw (unsmoothed) scalar value from the current frame.
   * @returns The exponentially smoothed value.
   */
  update(rawValue: number): number {
    if (this._value === null) {
      // Bootstrap: first sample initialises the filter without smoothing.
      this._value = rawValue;
    } else {
      this._value = this._alpha * rawValue + (1 - this._alpha) * this._value;
    }
    return this._value;
  }

  /**
   * Resets the filter, discarding accumulated history.
   * Call this when the hand disappears and reappears to avoid a stale
   * "phantom" position from a previous tracking session.
   */
  reset(): void {
    this._value = null;
  }

  /** Returns the last smoothed value, or null if no samples have been seen. */
  get value(): number | null {
    return this._value;
  }

  private _clampAlpha(alpha: number): number {
    return Math.max(0.01, Math.min(1.0, alpha));
  }
}

// ============================================================
// FPS CALCULATOR
// ============================================================

/**
 * Rolling-window FPS calculator.
 *
 * Accumulates timestamps over a configurable window (default 30 frames)
 * and computes the mean frame rate. More accurate than simple delta-time.
 */
export class FPSCounter {
  private _timestamps: number[] = [];
  private readonly _windowSize: number;

  /**
   * @param windowSize - Number of recent frame timestamps to average over.
   */
  constructor(windowSize: number = 30) {
    this._windowSize = windowSize;
  }

  /**
   * Records a new frame timestamp and returns the current smoothed FPS.
   *
   * @param now - Current timestamp in milliseconds (e.g., performance.now()).
   * @returns Smoothed frames-per-second value.
   */
  tick(now: number = performance.now()): number {
    this._timestamps.push(now);
    if (this._timestamps.length > this._windowSize) {
      this._timestamps.shift();
    }
    if (this._timestamps.length < 2) return 0;
    const elapsed =
      this._timestamps[this._timestamps.length - 1] - this._timestamps[0];
    return Math.round(((this._timestamps.length - 1) / elapsed) * 1000);
  }

  /** Resets the FPS history. */
  reset(): void {
    this._timestamps = [];
  }
}
