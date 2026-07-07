/**
 * @file service-worker.ts
 * @description Manifest V3 background service worker for GestureScroll.
 *
 * Responsibilities:
 * 1. Acts as a message relay between content scripts and the popup.
 *    The popup may open at any time and needs the last known state — we cache
 *    it via storage.local and relay it on demand.
 * 2. Handles the PP_REQUEST_STATE message from the popup by returning the
 *    cached RuntimeState from storage.
 * 3. Relays OPT_SETTINGS_CHANGED from the options page to all active content
 *    script tabs.
 * 4. Does NOT hold any persistent state in memory — MV3 service workers are
 *    ephemeral and may be killed at any time. All state that must survive
 *    across awakenings is stored in chrome.storage.local.
 *
 * NOTE: The service worker does NOT access the camera or run MediaPipe.
 * All CV processing runs in the content script (see architecture note in
 * camera-manager.ts and content-main.ts).
 */

import { cacheRuntimeState, loadCachedRuntimeState } from '../shared/storage';
import { broadcastToAllContentTabs } from '../shared/messaging';
import type { ExtensionMessage, RuntimeState } from '../shared/types';

// ============================================================
// INSTALL / UPDATE LIFECYCLE
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[GestureScroll BG] Extension installed — version', chrome.runtime.getManifest().version);
    // Open the options page on first install so users can configure settings.
    chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    console.log('[GestureScroll BG] Extension updated to', chrome.runtime.getManifest().version);
  }
});

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    if (typeof message !== 'object' || message === null) return undefined;
    const msg = message as ExtensionMessage;

    switch (msg.action) {
      // ---- Content script broadcasting state update ----
      case 'CS_STATE_UPDATE': {
        const state = (msg as Extract<ExtensionMessage, { action: 'CS_STATE_UPDATE' }>).payload;
        // Cache in local storage so popup can read it on open.
        cacheRuntimeState(state).catch((e) =>
          console.error('[GestureScroll BG] Failed to cache state:', e)
        );
        sendResponse(undefined);
        return undefined;
      }

      // ---- Popup requesting last known state ----
      case 'PP_REQUEST_STATE': {
        // Return cached state asynchronously.
        loadCachedRuntimeState()
          .then((state: RuntimeState) => {
            sendResponse({ action: 'BG_RELAY_STATE', payload: state } satisfies ExtensionMessage);
          })
          .catch(() => {
            sendResponse({ action: 'BG_RELAY_STATE', payload: null } satisfies ExtensionMessage);
          });
        return true; // keep channel open for async sendResponse
      }

      // ---- Options page settings changed — relay to all active tabs ----
      case 'OPT_SETTINGS_CHANGED': {
        const payload = (msg as Extract<ExtensionMessage, { action: 'OPT_SETTINGS_CHANGED' }>).payload;
        broadcastToAllContentTabs({
          action: 'OPT_SETTINGS_CHANGED',
          payload,
        }).catch((e) => console.error('[GestureScroll BG] Broadcast error:', e));
        sendResponse(undefined);
        return undefined;
      }

      // ---- Content script gesture detected (for logging/analytics in debug mode) ----
      case 'CS_GESTURE_DETECTED': {
        // Currently just acknowledged. Could be used for badge text or
        // other background-side responses in future.
        sendResponse(undefined);
        return undefined;
      }

      default:
        return undefined;
    }
  }
);

// ============================================================
// EXTENSION ICON BADGE (visual feedback for active tabs)
// ============================================================

/**
 * Update the extension badge on the active tab's icon to indicate
 * whether the pipeline is running.
 * Called when a tab becomes active or when the state changes.
 */
async function updateBadgeForActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const state = await loadCachedRuntimeState();
  const isActive =
    state.cameraStatus === 'ACTIVE' &&
    state.platform !== 'UNSUPPORTED' &&
    state.platform !== 'UNKNOWN';

  chrome.action.setBadgeText({
    tabId: tab.id,
    text: isActive ? '●' : '',
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tab.id,
    color: isActive ? '#22c55e' : '#6b7280',
  });
}

chrome.tabs.onActivated.addListener(() => {
  updateBadgeForActiveTab().catch(console.error);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    updateBadgeForActiveTab().catch(console.error);
  }
});
