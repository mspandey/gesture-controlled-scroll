/**
 * @file hand-tracker.ts
 * @description Orchestrates MediaPipe Hands inference on webcam frames.
 *
 * This module is the bridge between the CameraManager (which provides raw
 * video frames) and the GestureStateMachine (which interprets motion).
 *
 * Responsibilities:
 * - Loads and configures the MediaPipe Hands model from locally vendored files.
 * - Runs inference on each video frame using requestAnimationFrame.
 * - Filters results by handedness preference and confidence threshold.
 * - Computes the palm centroid Y-position and feeds it through the EMA filter.
 * - Detects low-confidence and poor-lighting conditions.
 * - Exposes landmark data and an optional canvas rendering API (for the options
 *   page live preview).
 * - Reports per-frame FPS via FPSCounter.
 *
 * MEDIAPIPE LOADING STRATEGY
 * ──────────────────────────
 * MediaPipe Hands uses WebAssembly and a binary model file. Loading these from
 * a live CDN would violate the privacy requirement. Instead, we vendor the
 * required files into assets/mediapipe/ and serve them as web-accessible
 * resources (declared in manifest.json). The Hands constructor accepts a
 * `locateFile` callback that maps file names to absolute URLs — we use
 * chrome.runtime.getURL() to construct those URLs.
 *
 * The vendored files required are:
 *   hands.js                     (MediaPipe Hands JS module)
 *   hands_solution_packed_assets.data
 *   hands_solution_packed_assets_loader.js
 *   hands_solution_simd_wasm_bin.wasm
 *   hands_solution_wasm_bin.wasm
 *
 * See README.md for instructions on downloading these files.
 */

import { EMAFilter, FPSCounter } from './smoothing';
import { GestureStateMachine, GestureStateMachineConfig } from './gesture-state-machine';
import type {
  ExtensionSettings,
  GestureDirection,
  HandDetectionStatus,
  MediaPipeHandedness,
} from '../shared/types';
import { LANDMARK, LOW_CONFIDENCE_WARNING_DELAY_MS, MEDIAPIPE_BASE_PATH, DEBUG } from '../shared/constants';

/** Gated debug logger. */
function dbg(...args: unknown[]): void {
  if (DEBUG) console.log('[GestureScroll][HandTracker]', ...args);
}

/** Minimal type stubs for MediaPipe Hands (loaded dynamically at runtime). */
interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

interface HandsResults {
  multiHandLandmarks?: NormalizedLandmark[][];
  multiHandedness?: Array<{
    label: MediaPipeHandedness;
    score: number;
    index: number;
  }>;
  image?: HTMLVideoElement | HTMLCanvasElement;
}

interface HandsOptions {
  maxNumHands: number;
  modelComplexity: 0 | 1;
  minDetectionConfidence: number;
  minTrackingConfidence: number;
}

interface MediaPipeHands {
  setOptions(options: HandsOptions): void;
  onResults(callback: (results: HandsResults) => void): void;
  send(inputs: { image: HTMLVideoElement | HTMLCanvasElement }): Promise<void>;
  close(): void;
}

/** Callback for gesture events produced by the hand tracker. */
export type HandTrackerGestureCallback = (direction: GestureDirection) => void;

/** Callback for per-frame status updates (sent to popup). */
export interface HandTrackerFrameStatus {
  confidence: number;
  fps: number;
  handDetectionStatus: HandDetectionStatus;
  gestureState: import('../shared/types').GestureState;
  multipleHandsVisible: boolean;
}

export type HandTrackerStatusCallback = (status: HandTrackerFrameStatus) => void;

/**
 * HandTracker orchestrates MediaPipe Hands inference.
 */
export class HandTracker {
  private _hands: MediaPipeHands | null = null;
  private _emaFilter: EMAFilter;
  private _fpsCounter: FPSCounter;
  private _stateMachine: GestureStateMachine;
  private _settings: ExtensionSettings;
  private _onGesture: HandTrackerGestureCallback;
  private _onStatus: HandTrackerStatusCallback;

  private _running: boolean = false;
  private _animFrameId: number | null = null;
  private _lastFrameTime: number = 0;
  private _targetIntervalMs: number = 1000 / 30; // 30 FPS cap
  private _frameCount: number = 0; // for periodic diagnostic logging

  /** Timestamp of the last frame with confidence below threshold. */
  private _lowConfidenceSince: number | null = null;

  /** The most recent landmark set, exposed for canvas overlay rendering. */
  private _lastLandmarks: NormalizedLandmark[] | null = null;
  private _lastHandedness: MediaPipeHandedness | null = null;

  /** Cached overlay canvas for options page preview. */
  private _overlayCanvas: HTMLCanvasElement | null = null;

  /**
   * @param settings  - Current extension settings.
   * @param onGesture - Called when a confirmed gesture is detected.
   * @param onStatus  - Called each frame with per-frame status information.
   */
  constructor(
    settings: ExtensionSettings,
    onGesture: HandTrackerGestureCallback,
    onStatus: HandTrackerStatusCallback
  ) {
    this._settings = settings;
    this._onGesture = onGesture;
    this._onStatus = onStatus;

    this._emaFilter = new EMAFilter(settings.smoothingFactor);
    this._fpsCounter = new FPSCounter(30);

    const machineConfig: GestureStateMachineConfig = {
      motionThreshold: settings.motionThreshold,
      motionWindowMs: settings.motionWindowMs,
      cooldownMs: settings.cooldownMs,
    };
    this._stateMachine = new GestureStateMachine(machineConfig, onGesture);
  }

  /** Whether the tracker is currently running. */
  get isRunning(): boolean {
    return this._running;
  }

  /** The last detected hand landmarks (for canvas overlay). */
  get lastLandmarks(): NormalizedLandmark[] | null {
    return this._lastLandmarks;
  }

  /**
   * Loads the MediaPipe Hands model from locally vendored assets.
   * Must be called before start().
   *
   * @returns Promise that resolves when the model is ready.
   * @throws Error if the model files cannot be found or loaded.
   */
  async loadModel(): Promise<void> {
    // ── STEP 3a: Log the script URL being injected ──────────────────────
    const handsJsUrl = chrome.runtime.getURL(`${MEDIAPIPE_BASE_PATH}hands.js`);
    dbg('STEP 3a — Injecting hands.js from:', handsJsUrl);

    // Dynamically load the vendored MediaPipe Hands script.
    // We inject it as a <script> tag so the Hands class becomes available
    // on the window object (the module uses a UMD-style export).
    // NOTE: content scripts run in MAIN world (world:MAIN in manifest), so
    // window.Hands set by the injected script IS accessible here.
    await this._injectScript(handsJsUrl);
    dbg('STEP 3a ✓ hands.js script tag loaded (onload fired).');

    // ── STEP 3b: Poll for window.Hands constructor ───────────────────────
    dbg('STEP 3b — Polling for window.Hands constructor (max 10 s)…');
    // hands.js is a loader — it sets window.Hands asynchronously after the
    // WASM is fetched. Poll until it's ready (max 10 seconds).
    const HandsConstructor = await this._waitForGlobal<
      new (options: { locateFile: (file: string) => string }) => MediaPipeHands
    >('Hands', 10000);

    if (!HandsConstructor) {
      dbg('STEP 3b ✗ window.Hands never became defined after 10 s. '
          + 'Check that assets/mediapipe/hands.js exists, is correct, '
          + 'and is declared in web_accessible_resources in manifest.json.');
      throw new Error('[HandTracker] MediaPipe Hands failed to load. Check vendored files.');
    }
    dbg('STEP 3b ✓ window.Hands constructor is available:', typeof HandsConstructor);

    // ── STEP 3c: Instantiate and configure the model ─────────────────────
    // Instantiate with locateFile pointing to our vendored WASM/data files.
    this._hands = new HandsConstructor({
      locateFile: (file: string) => {
        const resolvedUrl = chrome.runtime.getURL(`${MEDIAPIPE_BASE_PATH}${file}`);
        dbg('STEP 3c locateFile() →', file, '→', resolvedUrl);
        return resolvedUrl;
      },
    });

    this._hands.setOptions({
      selfieMode: true,
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: this._settings.minDetectionConfidence,
      minTrackingConfidence: this._settings.minTrackingConfidence,
    });
    dbg('STEP 3c ✓ Hands model instantiated and options set. '
        + `minDetectionConfidence=${this._settings.minDetectionConfidence} `
        + `minTrackingConfidence=${this._settings.minTrackingConfidence}`);

    this._hands.onResults(this._onResults.bind(this));
    dbg('STEP 3 ✓ loadModel() complete. onResults callback registered.');
  }

  /**
   * Starts the frame-by-frame inference loop.
   *
   * @param video - The HTMLVideoElement to read frames from.
   */
  start(video: HTMLVideoElement): void {
    if (this._running) return;
    this._running = true;
    this._lastFrameTime = 0;
    this._scheduleNextFrame(video);
  }

  /**
   * Stops the inference loop. Does not release the camera (CameraManager
   * handles that); only stops the rAF loop.
   */
  stop(): void {
    this._running = false;
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this._hands?.close();
    this._hands = null;
    this._stateMachine.reset();
    this._emaFilter.reset();
    this._fpsCounter.reset();
    this._lastLandmarks = null;
    this._lowConfidenceSince = null;
  }

  /**
   * Updates settings at runtime. Applies immediately to the next frame.
   *
   * @param settings - New settings to apply.
   */
  updateSettings(settings: ExtensionSettings): void {
    this._settings = settings;
    this._emaFilter.alpha = settings.smoothingFactor;
    this._stateMachine.updateConfig({
      motionThreshold: settings.motionThreshold,
      motionWindowMs: settings.motionWindowMs,
      cooldownMs: settings.cooldownMs,
    });
    // Re-apply model options if loaded.
    this._hands?.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: settings.minDetectionConfidence,
      minTrackingConfidence: settings.minTrackingConfidence,
    });
  }

  /**
   * Attaches an overlay canvas for rendering hand landmarks (used in options
   * page preview). Pass null to detach.
   *
   * @param canvas - HTMLCanvasElement to draw landmarks onto, or null.
   */
  setOverlayCanvas(canvas: HTMLCanvasElement | null): void {
    this._overlayCanvas = canvas;
  }

  // ----------------------------------------------------------
  // Private methods
  // ----------------------------------------------------------

  private _scheduleNextFrame(video: HTMLVideoElement): void {
    if (!this._running) return;
    this._animFrameId = requestAnimationFrame(async (now) => {
      // Throttle to target frame rate.
      if (now - this._lastFrameTime >= this._targetIntervalMs) {
        this._lastFrameTime = now;
        if (this._hands && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          // ── STEP 4: Log every 30th frame dispatched to the model ────────
          this._frameCount++;
          if (DEBUG && this._frameCount % 30 === 1) {
            dbg(`STEP 4 — Sending frame #${this._frameCount} to Hands.send(). `
                + `video.readyState=${video.readyState} `
                + `videoWidth=${video.videoWidth} videoHeight=${video.videoHeight}`);
          }
          try {
            await this._hands.send({ image: video });
          } catch (err) {
            console.error('[GestureScroll][HandTracker] Inference error:', err);
          }
        } else if (DEBUG && this._frameCount % 90 === 0) {
          dbg('STEP 4 — Frame skipped: hands=', !!this._hands,
              'video.readyState=', video.readyState);
        }
      }
      this._scheduleNextFrame(video);
    });
  }

  private _onResults(results: HandsResults): void {
    const now = performance.now();
    const fps = this._fpsCounter.tick(now);

    const landmarks = results.multiHandLandmarks ?? [];
    const handedness = results.multiHandedness ?? [];
    const multipleHandsVisible = landmarks.length > 1;

    // --- Filter by handedness preference ---
    let selectedIdx = this._selectHandIndex(handedness);

    // --- Confidence ---
    let confidence = 0;
    if (selectedIdx >= 0 && handedness[selectedIdx]) {
      confidence = handedness[selectedIdx].score;
    }

    // --- Hand not detected ---
    if (selectedIdx < 0 || landmarks[selectedIdx] === undefined) {
      this._handleNoHand(fps, multipleHandsVisible);
      return;
    }

    // --- Require single hand mode ---
    if (this._settings.requireSingleHand && multipleHandsVisible) {
      this._reportStatus({
        confidence,
        fps,
        handDetectionStatus: 'MULTIPLE_HANDS',
        gestureState: this._stateMachine.state,
        multipleHandsVisible: true,
      });
      this._stateMachine.handLost();
      this._emaFilter.reset();
      return;
    }

    // --- Low confidence check ---
    if (confidence < this._settings.minDetectionConfidence) {
      this._handleLowConfidence(fps, multipleHandsVisible, now);
      return;
    }

    // Reset low-confidence timer.
    this._lowConfidenceSince = null;

    // --- Compute tracked point Y ---
    const lm = landmarks[selectedIdx];
    this._lastLandmarks = lm;
    this._lastHandedness = handedness[selectedIdx]?.label ?? null;

    const trackedY = this._computeTrackedPointY(lm);
    const smoothedY = this._emaFilter.update(trackedY);

    // ── STEP 5: Log raw and smoothed Y every 30th result ────────────────
    if (DEBUG && this._frameCount % 30 === 1) {
      dbg(`STEP 5 — Hand detected. confidence=${confidence.toFixed(3)} `
          + `rawTrackedY=${trackedY.toFixed(4)} smoothedY=${smoothedY.toFixed(4)} `
          + `handedness=${handedness[selectedIdx]?.label} fps=${fps.toFixed(1)}`);
    }

    // --- Update state machine ---
    this._stateMachine.update(smoothedY, now);

    // --- Draw overlay if canvas is attached ---
    if (this._overlayCanvas) {
      this._drawLandmarks(this._overlayCanvas, lm, results.image);
    }

    // --- Report status ---
    this._reportStatus({
      confidence,
      fps,
      handDetectionStatus: multipleHandsVisible ? 'MULTIPLE_HANDS' : 'HAND_DETECTED',
      gestureState: this._stateMachine.state,
      multipleHandsVisible,
    });
  }

  private _handleNoHand(fps: number, multipleHandsVisible: boolean): void {
    this._stateMachine.handLost();
    this._emaFilter.reset();
    this._lastLandmarks = null;
    this._lowConfidenceSince = null;
    this._reportStatus({
      confidence: 0,
      fps,
      handDetectionStatus: 'NO_HAND',
      gestureState: this._stateMachine.state,
      multipleHandsVisible,
    });
    if (this._overlayCanvas) {
      this._clearCanvas(this._overlayCanvas);
    }
  }

  private _handleLowConfidence(fps: number, multipleHandsVisible: boolean, now: number): void {
    if (this._lowConfidenceSince === null) {
      this._lowConfidenceSince = now;
    }
    const duration = now - this._lowConfidenceSince;
    const status: HandDetectionStatus =
      duration >= LOW_CONFIDENCE_WARNING_DELAY_MS ? 'LOW_CONFIDENCE' : 'HAND_DETECTED';
    this._stateMachine.handLost();
    this._emaFilter.reset();
    this._reportStatus({
      confidence: 0,
      fps,
      handDetectionStatus: status,
      gestureState: this._stateMachine.state,
      multipleHandsVisible,
    });
  }

  /**
   * Selects the index of the best matching hand based on handedness preference.
   * Returns -1 if no suitable hand is found.
   */
  private _selectHandIndex(
    handedness: HandsResults['multiHandedness']
  ): number {
    if (!handedness || handedness.length === 0) return -1;

    if (this._settings.handedness === 'EITHER') {
      // Pick the hand with the highest confidence.
      let bestIdx = 0;
      let bestScore = handedness[0].score;
      for (let i = 1; i < handedness.length; i++) {
        if (handedness[i].score > bestScore) {
          bestScore = handedness[i].score;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    // MediaPipe reports "Left"/"Right" from the model's perspective.
    // Note: this may be mirrored relative to the user's view — users can
    // configure their preference in settings if detection seems swapped.
    const targetLabel =
      this._settings.handedness === 'LEFT' ? 'Left' : 'Right';
    const idx = handedness.findIndex((h) => h.label === targetLabel);
    return idx;
  }

  /**
   * Computes the Y coordinate of the tracked point (index finger tip).
   *
   * @param landmarks - Full 21-landmark array for one hand.
   * @returns Normalised Y coordinate of the index finger tip (0–1).
   */
  private _computeTrackedPointY(landmarks: NormalizedLandmark[]): number {
    return landmarks[LANDMARK.INDEX_TIP]?.y ?? 0;
  }

  /**
   * Draws hand landmarks and skeleton onto the overlay canvas.
   * This is a lightweight drawing implementation that does not depend on
   * @mediapipe/drawing_utils to keep the content script bundle lean.
   *
   * @param canvas    - Target canvas element.
   * @param landmarks - 21 landmarks from MediaPipe Hands.
   * @param sourceImage - The source image for sizing the canvas.
   */
  private _drawLandmarks(
    canvas: HTMLCanvasElement,
    landmarks: NormalizedLandmark[],
    sourceImage?: HTMLVideoElement | HTMLCanvasElement
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw source image behind landmarks if canvas is used as a mirror preview.
    if (sourceImage && 'videoWidth' in sourceImage) {
      ctx.save();
      ctx.scale(-1, 1); // mirror
      ctx.drawImage(sourceImage as HTMLVideoElement, -w, 0, w, h);
      ctx.restore();
    }

    // Skeleton connections (MediaPipe Hands connection list).
    const connections: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [0, 9], [9, 10], [10, 11], [11, 12],   // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17],            // Palm
    ];

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
    ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo((1 - la.x) * w, la.y * h); // mirror X
      ctx.lineTo((1 - lb.x) * w, lb.y * h);
      ctx.stroke();
    }

    // Draw landmark dots.
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc((1 - lm.x) * w, lm.y * h, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.fill();
    }
  }

  private _clearCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private _reportStatus(status: HandTrackerFrameStatus): void {
    this._onStatus(status);
  }

  /**
   * Injects a script tag into the current document and waits for it to load.
   * Used to load the vendored MediaPipe Hands UMD bundle.
   *
   * @param src - Absolute URL of the script to inject.
   */
  private _injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded.
      if (document.querySelector(`script[data-gesturescroll="${src}"]`)) {
        dbg('_injectScript: already present, skipping injection of', src);
        resolve();
        return;
      }
      // Prefer document.head; fall back to document.documentElement if head is null.
      const target = document.head ?? document.documentElement;
      if (!target) {
        reject(new Error(`[HandTracker] Cannot inject script — no document.head or document.documentElement. URL: ${window.location.href}`));
        return;
      }
      dbg('_injectScript: appending <script> to', target.tagName, 'for', src);
      const script = document.createElement('script');
      script.src = src;
      script.setAttribute('data-gesturescroll', src);
      script.onload = () => {
        dbg('_injectScript: onload fired for', src);
        resolve();
      };
      script.onerror = (e) => {
        dbg('_injectScript: onerror fired for', src, e);
        reject(new Error(`Failed to load script: ${src}. Check: (1) assets/mediapipe/hands.js exists in dist/, (2) web_accessible_resources in manifest.json includes assets/mediapipe/*, (3) no CSP on the page blocks chrome-extension:// script sources.`));
      };
      target.appendChild(script);
    });
  }

  /**
   * Polls `window[key]` until it is truthy or the timeout elapses.
   * MediaPipe's hands.js is a loader — window.Hands is set asynchronously
   * after the WASM binary is fetched, so we cannot rely on script.onload.
   */
  private _waitForGlobal<T>(key: string, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      let pollCount = 0;
      const check = () => {
        pollCount++;
        const val = (window as unknown as Record<string, unknown>)[key] as T | undefined;
        if (val) {
          dbg(`_waitForGlobal: window.${key} found after ${pollCount} polls (${Date.now() - start} ms)`);
          resolve(val);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          dbg(`_waitForGlobal: TIMEOUT — window.${key} still undefined after ${pollCount} polls (${timeoutMs} ms). `
              + 'Possible causes: (1) hands.js failed to load, (2) the script did not run in MAIN world, '
              + '(3) the WASM binary fetch failed silently.');
          resolve(null);
          return;
        }
        if (DEBUG && pollCount % 10 === 0) {
          dbg(`_waitForGlobal: still waiting for window.${key}… poll #${pollCount}`);
        }
        setTimeout(check, 100);
      };
      check();
    });
  }
}

// Re-export for use in the HandDetectionStatus type guard in reporting.
type HandDetectionStatus = import('../shared/types').HandDetectionStatus;
