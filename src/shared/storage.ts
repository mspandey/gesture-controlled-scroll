/**
 * @file storage.ts
 * @description Typed wrapper around chrome.storage.sync for reading/writing
 * GestureScroll settings.
 *
 * All reads/writes go through this module to ensure consistent key usage
 * and type safety. chrome.storage.sync is used (rather than .local) so that
 * settings roam across the user's Chrome sign-in profile across devices.
 * The total payload is small (< 200 bytes), well within sync quota limits.
 */

import type { ExtensionSettings, RuntimeState } from './types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_RUNTIME_STATE,
  STORAGE_KEY_SETTINGS,
  STORAGE_KEY_RUNTIME_STATE,
} from './constants';

// ============================================================
// SETTINGS (chrome.storage.sync)
// ============================================================

/**
 * Reads all settings from chrome.storage.sync.
 * Returns defaults merged with any stored overrides so callers always
 * receive a fully-populated ExtensionSettings object, even on first install.
 *
 * @returns Promise resolving to the current ExtensionSettings.
 */
export async function loadSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY_SETTINGS, (result) => {
      const stored = result[STORAGE_KEY_SETTINGS] as Partial<ExtensionSettings> | undefined;
      // Merge stored values over defaults so newly-added settings always have
      // a valid default even if the stored object pre-dates them.
      resolve({ ...DEFAULT_SETTINGS, ...(stored ?? {}) });
    });
  });
}

/**
 * Saves a full ExtensionSettings object to chrome.storage.sync.
 *
 * @param settings - The settings object to persist.
 * @returns Promise that resolves when the write is complete.
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [STORAGE_KEY_SETTINGS]: settings }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Updates only the specified keys in stored settings, leaving all other
 * settings unchanged.
 *
 * @param patch - Partial settings object with only the fields to update.
 * @returns Promise resolving to the newly merged ExtensionSettings.
 */
export async function patchSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const updated: ExtensionSettings = { ...current, ...patch };
  await saveSettings(updated);
  return updated;
}

/**
 * Resets all settings to the factory defaults.
 *
 * @returns Promise resolving to the default ExtensionSettings.
 */
export async function resetSettings(): Promise<ExtensionSettings> {
  await saveSettings(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

/**
 * Registers a listener that fires whenever settings are changed in storage
 * (e.g., by the options page in another tab).
 *
 * @param callback - Called with the new merged settings whenever they change.
 * @returns An unsubscribe function that removes the listener.
 */
export function onSettingsChanged(
  callback: (settings: ExtensionSettings) => void
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ) => {
    if (area === 'sync' && STORAGE_KEY_SETTINGS in changes) {
      const newValue = changes[STORAGE_KEY_SETTINGS].newValue as
        | Partial<ExtensionSettings>
        | undefined;
      callback({ ...DEFAULT_SETTINGS, ...(newValue ?? {}) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ============================================================
// RUNTIME STATE CACHE (chrome.storage.local)
// ============================================================
// We cache the last known RuntimeState in local storage so the popup can
// show a meaningful state snapshot even if the content script hasn't
// sent an update yet in the current popup session.

/**
 * Caches the current runtime state in chrome.storage.local.
 * This is written by the background service worker when it receives a
 * CS_STATE_UPDATE message.
 *
 * @param state - The RuntimeState snapshot to cache.
 */
export async function cacheRuntimeState(state: RuntimeState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_RUNTIME_STATE]: state }, resolve);
  });
}

/**
 * Reads the last cached RuntimeState from chrome.storage.local.
 * Returns the DEFAULT_RUNTIME_STATE if nothing is cached yet.
 *
 * @returns Promise resolving to the last known RuntimeState.
 */
export async function loadCachedRuntimeState(): Promise<RuntimeState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY_RUNTIME_STATE, (result) => {
      resolve(
        (result[STORAGE_KEY_RUNTIME_STATE] as RuntimeState | undefined) ??
          DEFAULT_RUNTIME_STATE
      );
    });
  });
}
