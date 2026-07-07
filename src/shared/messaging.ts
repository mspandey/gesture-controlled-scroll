/**
 * @file messaging.ts
 * @description Helper utilities for chrome.runtime message passing.
 *
 * Provides typed wrappers around sendMessage/onMessage so that all
 * message passing is type-checked at compile time using the ExtensionMessage
 * discriminated union defined in types.ts.
 *
 * Message flow overview:
 *   Content Script ──CS_STATE_UPDATE──► Background ──BG_RELAY_STATE──► Popup
 *   Popup ──PP_SET_ENABLED──► Content Script (via tabs.sendMessage)
 *   Options ──OPT_SETTINGS_CHANGED──► Content Script (via tabs.sendMessage)
 *   Popup ──PP_PING──► Content Script ──CS_PONG──► Popup
 */

import type { ExtensionMessage, RuntimeState } from './types';

// ============================================================
// SEND HELPERS
// ============================================================

/**
 * Sends a message to the background service worker.
 * Does not wait for a response (fire-and-forget).
 *
 * @param message - The typed ExtensionMessage to send.
 */
export function sendToBackground(message: ExtensionMessage): void {
  // chrome.runtime.sendMessage can throw if no listener is registered; swallow.
  chrome.runtime.sendMessage(message).catch(() => {
    // Background service worker may be inactive — safe to ignore.
  });
}

/**
 * Sends a message to the background and waits for a typed response.
 *
 * @param message - The typed ExtensionMessage to send.
 * @returns Promise resolving to the response message, or null on timeout/error.
 */
export async function sendToBackgroundWithResponse(
  message: ExtensionMessage
): Promise<ExtensionMessage | null> {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response as ExtensionMessage | null;
  } catch {
    return null;
  }
}

/**
 * Sends a message to the content script in the currently active tab.
 * Used by the popup and options page.
 *
 * @param message - The typed ExtensionMessage to send.
 * @returns Promise resolving to the content script's response, or null on error.
 */
export async function sendToActiveTab(
  message: ExtensionMessage
): Promise<ExtensionMessage | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response as ExtensionMessage | null;
  } catch {
    return null;
  }
}

/**
 * Broadcasts a message to ALL content script tabs for the extension's
 * supported hostnames. Used by the background service worker to fan out
 * settings changes.
 *
 * @param message - The typed ExtensionMessage to broadcast.
 */
export async function broadcastToAllContentTabs(
  message: ExtensionMessage
): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: [
      'https://www.youtube.com/shorts/*',
      'https://youtube.com/shorts/*',
      'https://www.instagram.com/reels/*',
      'https://www.instagram.com/reels',
    ],
  });
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Content script may not be ready; ignore.
      });
    }
  }
}

// ============================================================
// RECEIVE HELPERS
// ============================================================

type MessageHandler<A extends ExtensionMessage['action']> = (
  payload: Extract<ExtensionMessage, { action: A }> extends { payload: infer P }
    ? P
    : undefined,
  sender: chrome.runtime.MessageSender
) => void | ExtensionMessage | Promise<ExtensionMessage | void>;

/**
 * Registers a typed listener for a specific message action.
 * Returns an unsubscribe function.
 *
 * @param action - The message action string to listen for.
 * @param handler - The callback to invoke when a matching message arrives.
 * @returns A function that removes the listener when called.
 */
export function onMessage<A extends ExtensionMessage['action']>(
  action: A,
  handler: MessageHandler<A>
): () => void {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    if (
      typeof message !== 'object' ||
      message === null ||
      (message as ExtensionMessage).action !== action
    ) {
      return undefined;
    }
    const msg = message as Extract<ExtensionMessage, { action: A }>;
    const payload = 'payload' in msg ? msg.payload : undefined;
    const result = handler(
      payload as Parameters<MessageHandler<A>>[0],
      sender
    );
    if (result instanceof Promise) {
      result.then(sendResponse).catch(() => sendResponse(undefined));
      return true; // keep channel open for async response
    }
    if (result !== undefined) {
      sendResponse(result);
    }
    return undefined;
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

// ============================================================
// POPUP ↔ CONTENT SCRIPT STATE RELAY
// ============================================================

/**
 * Pings the content script in the active tab and returns its current
 * RuntimeState, or null if the content script is not present/ready.
 *
 * @returns Promise resolving to RuntimeState or null.
 */
export async function pingContentScript(): Promise<RuntimeState | null> {
  const response = await sendToActiveTab({ action: 'PP_PING' });
  if (response && response.action === 'CS_PONG') {
    return response.payload;
  }
  return null;
}
