/**
 * @file popup.ts
 * @description Popup UI controller for GestureScroll.
 *
 * Renders real-time extension state in the popup:
 * - Master on/off toggle (persists to storage and sends PP_SET_ENABLED to content script).
 * - Camera status with colour coding.
 * - Detected gesture with directional arrow animation.
 * - Live confidence score bar.
 * - Live FPS bar.
 * - Platform / page detection label.
 * - Error / warning message box.
 *
 * State is obtained by:
 * 1. Immediately pinging the active tab's content script (PP_PING → CS_PONG).
 * 2. Falling back to the background service worker's cached state (PP_REQUEST_STATE).
 * 3. Subscribing to CS_STATE_UPDATE messages pushed from the content script.
 */

import type {
  CameraStatus,
  ExtensionMessage,
  GestureDirection,
  PlatformStatus,
  RuntimeState,
} from '../shared/types';
import { CAMERA_STATUS_LABELS } from '../shared/types';
import { loadSettings, patchSettings } from '../shared/storage';
import { DEFAULT_RUNTIME_STATE } from '../shared/constants';

// ============================================================
// DOM REFERENCES
// ============================================================

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const masterToggle = $<HTMLInputElement>('master-toggle');
const platformDot = $('platform-dot');
const platformLabel = $('platform-label');
const cameraStatus = $('camera-status');
const cameraIndicator = $('camera-indicator');
const gestureStatus = $('gesture-status');
const gestureArrow = $('gesture-arrow');
const confidenceFill = $('confidence-fill');
const confidenceValue = $('confidence-value');
const fpsFill = $('fps-fill');
const fpsValue = $('fps-value');
const messageBox = $('message-box');
const messageText = $('message-text');
const openSettingsBtn = $('open-settings-btn');

// ============================================================
// STARTUP
// ============================================================

let _currentState: RuntimeState = { ...DEFAULT_RUNTIME_STATE };
let _enabled = true;

async function init(): Promise<void> {
  // Load persisted settings to initialise the toggle.
  const settings = await loadSettings();
  _enabled = settings.enabled;
  masterToggle.checked = _enabled;
  masterToggle.setAttribute('aria-checked', String(_enabled));

  // Register event listeners.
  masterToggle.addEventListener('change', onToggleChange);
  openSettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Subscribe to pushed state updates from the content script.
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as ExtensionMessage).action === 'CS_STATE_UPDATE'
    ) {
      const state = (message as Extract<ExtensionMessage, { action: 'CS_STATE_UPDATE' }>).payload;
      renderState(state);
    }
  });

  // Try to get immediate state from the active tab's content script.
  const immediateState = await pingContentScript();
  if (immediateState) {
    renderState(immediateState);
    return;
  }

  // Fall back to cached state from background service worker.
  const cachedState = await requestCachedState();
  renderState(cachedState ?? DEFAULT_RUNTIME_STATE);
}

// ============================================================
// TOGGLE HANDLER
// ============================================================

async function onToggleChange(): Promise<void> {
  _enabled = masterToggle.checked;
  masterToggle.setAttribute('aria-checked', String(_enabled));

  // Persist to storage.
  await patchSettings({ enabled: _enabled });

  // Notify active content script.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'PP_SET_ENABLED',
        payload: { enabled: _enabled },
      } satisfies ExtensionMessage).catch(() => { /* CS may not be injected */ });
    }
  } catch {
    // Not on a supported page.
  }

  // Update UI immediately.
  if (!_enabled) {
    renderState({
      ..._currentState,
      cameraStatus: 'OFF',
      handDetectionStatus: 'PIPELINE_OFF',
      gestureState: _currentState.gestureState,
      lastGesture: 'NONE',
      confidence: 0,
      fps: 0,
    });
  }
}

// ============================================================
// STATE RENDERING
// ============================================================

/**
 * Updates the popup UI to reflect the provided RuntimeState.
 *
 * @param state - The current runtime state snapshot.
 */
function renderState(state: RuntimeState): void {
  _currentState = state;

  renderPlatform(state.platform);
  renderCameraStatus(state.cameraStatus);
  renderGesture(state.lastGesture);
  renderConfidence(state.confidence);
  renderFPS(state.fps);
  renderMessage(state);
}

function renderPlatform(platform: PlatformStatus): void {
  const platformNames: Record<PlatformStatus, string> = {
    YOUTUBE_SHORTS: '▶ YouTube Shorts',
    INSTAGRAM_REELS: '📸 Instagram Reels',
    UNSUPPORTED: 'Not on a supported page',
    UNKNOWN: 'Detecting page…',
  };

  platformLabel.textContent = platformNames[platform];

  // Dot colour.
  platformDot.className = 'platform-dot';
  if (platform === 'YOUTUBE_SHORTS' || platform === 'INSTAGRAM_REELS') {
    platformDot.classList.add('platform-dot--active');
  } else if (platform === 'UNSUPPORTED') {
    platformDot.classList.add('platform-dot--inactive');
  } else {
    platformDot.classList.add('platform-dot--idle');
  }
}

function renderCameraStatus(status: CameraStatus): void {
  cameraStatus.textContent = CAMERA_STATUS_LABELS[status];

  cameraIndicator.className = 'status-indicator';
  cameraStatus.className = 'status-card-value';

  switch (status) {
    case 'ACTIVE':
      cameraIndicator.classList.add('indicator--green');
      cameraStatus.classList.add('value--green');
      break;
    case 'INITIALIZING':
      cameraIndicator.classList.add('indicator--yellow');
      cameraStatus.classList.add('value--yellow');
      break;
    case 'OFF':
      cameraIndicator.classList.add('indicator--gray');
      cameraStatus.classList.add('value--gray');
      break;
    case 'PERMISSION_DENIED':
    case 'NO_DEVICE':
    case 'IN_USE':
    case 'STREAM_LOST':
    case 'MODEL_LOAD_ERROR':
    case 'ERROR':
      cameraIndicator.classList.add('indicator--red');
      cameraStatus.classList.add('value--red');
      break;
  }
}

function renderGesture(direction: GestureDirection): void {
  const labels: Record<GestureDirection, string> = {
    UP: 'Hand Up ↑',
    DOWN: 'Hand Down ↓',
    NONE: 'None',
  };

  gestureStatus.textContent = labels[direction];
  gestureStatus.className = 'status-card-value';
  gestureArrow.className = 'gesture-arrow';

  if (direction === 'UP') {
    gestureStatus.classList.add('value--green');
    gestureArrow.classList.add('arrow--up');
    gestureArrow.textContent = '↑';
  } else if (direction === 'DOWN') {
    gestureStatus.classList.add('value--green');
    gestureArrow.classList.add('arrow--down');
    gestureArrow.textContent = '↓';
  } else {
    gestureArrow.textContent = '';
  }
}

function renderConfidence(confidence: number): void {
  const pct = Math.round(confidence * 100);
  confidenceValue.textContent = confidence > 0 ? `${pct}%` : '—';
  confidenceFill.style.width = `${pct}%`;

  confidenceFill.className = 'meter-fill';
  if (pct >= 70) {
    confidenceFill.classList.add('fill--green');
  } else if (pct >= 40) {
    confidenceFill.classList.add('fill--yellow');
  } else if (pct > 0) {
    confidenceFill.classList.add('fill--red');
  } else {
    confidenceFill.classList.add('fill--gray');
  }
}

function renderFPS(fps: number): void {
  fpsValue.textContent = fps > 0 ? `${fps}` : '—';
  // Map 0–60 FPS to 0–100%.
  const pct = Math.min(100, Math.round((fps / 60) * 100));
  fpsFill.style.width = `${pct}%`;

  fpsFill.className = 'meter-fill';
  if (fps >= 25) {
    fpsFill.classList.add('fill--green');
  } else if (fps >= 15) {
    fpsFill.classList.add('fill--yellow');
  } else if (fps > 0) {
    fpsFill.classList.add('fill--red');
  } else {
    fpsFill.classList.add('fill--gray');
  }
}

function renderMessage(state: RuntimeState): void {
  let msg: string | null = null;
  let type: 'error' | 'warning' | 'info' = 'info';

  if (state.errorMessage) {
    msg = state.errorMessage;
    type = 'error';
  } else if (state.cameraStatus === 'PERMISSION_DENIED') {
    msg = 'Camera permission denied. Click the camera icon in the address bar to allow access.';
    type = 'error';
  } else if (state.cameraStatus === 'NO_DEVICE') {
    msg = 'No camera found. Please connect a webcam and reload.';
    type = 'error';
  } else if (state.cameraStatus === 'IN_USE') {
    msg = 'Camera is in use by another app. Close it and re-enable GestureScroll.';
    type = 'error';
  } else if (state.cameraStatus === 'MODEL_LOAD_ERROR') {
    msg = 'Failed to load AI model. See README for setup instructions.';
    type = 'error';
  } else if (state.cameraStatus === 'STREAM_LOST') {
    msg = 'Camera disconnected. Re-enable the extension to reconnect.';
    type = 'warning';
  } else if (state.handDetectionStatus === 'LOW_CONFIDENCE') {
    msg = 'Poor lighting or hand not clearly visible. Try better lighting.';
    type = 'warning';
  } else if (state.multipleHandsVisible && !state.errorMessage) {
    msg = 'Multiple hands detected. Using highest-confidence hand. Enable "Require single hand" in Settings for strict mode.';
    type = 'info';
  } else if (state.platform === 'UNSUPPORTED') {
    msg = 'Navigate to YouTube Shorts or Instagram Reels to use GestureScroll.';
    type = 'info';
  }

  if (msg) {
    messageText.textContent = msg;
    messageBox.hidden = false;
    messageBox.className = `message-box message-box--${type}`;
  } else {
    messageBox.hidden = true;
  }
}

// ============================================================
// MESSAGING HELPERS
// ============================================================

async function pingContentScript(): Promise<RuntimeState | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'PP_PING',
    } satisfies ExtensionMessage);
    if (response && (response as ExtensionMessage).action === 'CS_PONG') {
      return (response as Extract<ExtensionMessage, { action: 'CS_PONG' }>).payload;
    }
    return null;
  } catch {
    return null;
  }
}

async function requestCachedState(): Promise<RuntimeState | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'PP_REQUEST_STATE',
    } satisfies ExtensionMessage);
    if (response && (response as ExtensionMessage).action === 'BG_RELAY_STATE') {
      return (response as Extract<ExtensionMessage, { action: 'BG_RELAY_STATE' }>).payload;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error('[GestureScroll Popup] Init error:', err));
});
