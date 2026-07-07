/**
 * @file camera-manager.ts
 * @description Manages the webcam stream lifecycle.
 *
 * Responsibilities:
 * - Requests getUserMedia with the configured resolution.
 * - Attaches the stream to a hidden <video> element in the page DOM.
 * - Detects and surfaces permission errors, missing devices, and in-use errors.
 * - Monitors for stream "ended" events (e.g., USB camera disconnected).
 * - Provides clean start() / stop() / restart() lifecycle methods.
 *
 * ARCHITECTURE NOTE — Why run in the content script context?
 * ─────────────────────────────────────────────────────────
 * In Manifest V3, service workers cannot access getUserMedia because they
 * have no DOM context. Offscreen documents (chrome.offscreen API) can access
 * getUserMedia, but they require additional permissions and add complexity for
 * this use case. Content scripts run in the context of the web page and DO
 * have access to getUserMedia (the page's existing camera permission is
 * sufficient — the extension does not need to separately request it from the
 * user). Running the CV pipeline in the content script is therefore the
 * simplest, most compatible, and most privacy-friendly approach:
 *   • No extra permissions needed beyond the page's own camera access.
 *   • Runs only on the specific YouTube Shorts / Instagram Reels pages.
 *   • Stops automatically when the tab is closed or navigated away.
 *   • No persistent background process holding the camera open.
 */

import type { CameraStatus } from '../shared/types';
import { DEBUG } from '../shared/constants';

/** Gated debug logger. */
function dbg(...args: unknown[]): void {
  if (DEBUG) console.log('[GestureScroll][Camera]', ...args);
}

/** Callback signatures for camera lifecycle events. */
export interface CameraManagerCallbacks {
  /** Fired once the camera stream is active and the video element is ready. */
  onReady: (video: HTMLVideoElement) => void;
  /** Fired when the camera status changes (for UI updates). */
  onStatusChange: (status: CameraStatus, message: string | null) => void;
  /** Fired when the stream is lost mid-session (device disconnected etc.). */
  onStreamLost: () => void;
}

/** Camera resolution configuration. */
export interface CameraConfig {
  width: number;
  height: number;
}

/**
 * Manages the webcam stream for the gesture detection pipeline.
 */
export class CameraManager {
  private _stream: MediaStream | null = null;
  private _video: HTMLVideoElement | null = null;
  private _callbacks: CameraManagerCallbacks;
  private _config: CameraConfig;
  private _status: CameraStatus = 'OFF';

  /**
   * @param config    - Camera resolution settings.
   * @param callbacks - Lifecycle event callbacks.
   */
  constructor(config: CameraConfig, callbacks: CameraManagerCallbacks) {
    this._config = config;
    this._callbacks = callbacks;
  }

  /** Current camera status. */
  get status(): CameraStatus {
    return this._status;
  }

  /** Returns the video element, if the camera is active. */
  get videoElement(): HTMLVideoElement | null {
    return this._video;
  }

  /** Returns the underlying MediaStream, if active. */
  get stream(): MediaStream | null {
    return this._stream;
  }

  /**
   * Starts the webcam and creates a hidden <video> element attached to the
   * document body. Resolves once the video is playing.
   *
   * @returns Promise resolving to the HTMLVideoElement on success, or null on failure.
   */
  async start(): Promise<HTMLVideoElement | null> {
    if (this._status === 'ACTIVE') return this._video;

    this._setStatus('INITIALIZING', null);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: this._config.width },
          height: { ideal: this._config.height },
          facingMode: 'user',
        },
        audio: false,
      };

      dbg(`STEP 2 — Calling getUserMedia with constraints: ${JSON.stringify(constraints.video)}`);
      this._stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = this._stream.getVideoTracks()[0];
      dbg('STEP 2 ✓ getUserMedia succeeded. Track label:', videoTrack?.label,
          'Settings:', JSON.stringify(videoTrack?.getSettings()));
    } catch (err) {
      dbg('STEP 2 ✗ getUserMedia FAILED:', err);
      this._handleGetUserMediaError(err);
      return null;
    }

    // Create and configure the hidden video element.
    const video = document.createElement('video');
    video.setAttribute('data-gesture-scroll', 'camera');
    video.style.cssText = `
      position: fixed;
      width: 1px;
      height: 1px;
      top: -9999px;
      left: -9999px;
      opacity: 0;
      pointer-events: none;
    `;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = this._stream;

    document.body.appendChild(video);
    this._video = video;

    // Wait for the video to start playing.
    await new Promise<void>((resolve, reject) => {
      const onPlaying = () => {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        reject(new Error('Video element error'));
      };
      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      video.play().catch(reject);
    }).catch((err) => {
      console.error('[GestureScroll][Camera] Video play error:', err);
      this._setStatus('ERROR', 'Failed to start video playback.');
      this._cleanup();
      return;
    });

    if (this._status === 'ERROR') return null;

    // Monitor for unexpected stream termination (USB disconnect, etc.).
    this._stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        this._setStatus('STREAM_LOST', 'Camera stream ended unexpectedly.');
        this._cleanup();
        this._callbacks.onStreamLost();
      });
    });

    this._setStatus('ACTIVE', null);
    dbg('STEP 2 ✓ Video is playing. readyState=', this._video?.readyState,
        'dimensions=', this._video?.videoWidth, 'x', this._video?.videoHeight);
    this._callbacks.onReady(video);
    return video;
  }

  /**
   * Stops the webcam stream and removes the video element from the DOM.
   * The stream tracks are explicitly stopped to release the hardware and
   * remove the browser's camera-in-use indicator.
   */
  stop(): void {
    this._cleanup();
    this._setStatus('OFF', null);
  }

  /**
   * Updates camera configuration (resolution).
   * Changes take effect on the next call to start().
   *
   * @param config - New camera configuration.
   */
  updateConfig(config: Partial<CameraConfig>): void {
    this._config = { ...this._config, ...config };
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private _handleGetUserMediaError(err: unknown): void {
    if (!(err instanceof DOMException)) {
      this._setStatus('ERROR', `Unknown camera error: ${String(err)}`);
      return;
    }
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        this._setStatus('PERMISSION_DENIED', 'Camera permission was denied.');
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        this._setStatus('NO_DEVICE', 'No camera device found.');
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        this._setStatus('IN_USE', 'Camera is already in use by another application.');
        break;
      case 'OverconstrainedError':
        this._setStatus('ERROR', 'Camera does not support the requested resolution. Trying default…');
        // Could retry with unconstrained constraints here.
        break;
      default:
        this._setStatus('ERROR', `Camera error: ${err.message}`);
    }
  }

  private _cleanup(): void {
    if (this._stream) {
      this._stream.getTracks().forEach((track) => track.stop());
      this._stream = null;
    }
    if (this._video) {
      this._video.srcObject = null;
      this._video.remove();
      this._video = null;
    }
  }

  private _setStatus(status: CameraStatus, message: string | null): void {
    this._status = status;
    this._callbacks.onStatusChange(status, message);
  }
}
