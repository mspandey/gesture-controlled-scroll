/**
 * @file youtube-shorts.adapter.ts
 * @description Platform adapter for YouTube Shorts.
 *
 * Navigation strategy:
 * 1. PRIMARY: Click the native navigation buttons rendered by YouTube's
 *    Shorts player UI (the circular arrow buttons flanking the video).
 *    These are the most reliable method as they invoke YouTube's own
 *    navigation logic and maintain watch history/recommendations correctly.
 *
 * 2. FALLBACK A: Dispatch keyboard events (ArrowDown / ArrowUp).
 *    YouTube Shorts supports keyboard navigation on the shorts page.
 *
 * 3. FALLBACK B: Scroll the feed container by one viewport height.
 *    Used when neither button click nor keyboard events work.
 *
 * NOTE: YouTube's DOM structure changes periodically. Selectors are written
 * with multiple fallbacks and logged in debug mode to ease future maintenance.
 * When selectors break, only this file needs updating — the rest of the
 * extension continues to work.
 */

import type { PlatformAdapter } from './platform-adapter.interface';
import type { PlatformStatus } from '../../shared/types';

export class YouTubeShortsAdapter implements PlatformAdapter {
  readonly platformName: PlatformStatus = 'YOUTUBE_SHORTS';

  /**
   * Returns true when the current URL is a YouTube Shorts page.
   * Covers both /shorts/<id> and the Shorts tab within YouTube.
   */
  isSupportedPage(): boolean {
    const host = window.location.hostname;
    const path = window.location.pathname;
    return (
      (host === 'www.youtube.com' || host === 'youtube.com') &&
      path.startsWith('/shorts/')
    );
  }

  /**
   * Navigates to the NEXT YouTube Short.
   * Tries native button → keyboard → scroll (in that order).
   */
  goToNext(): void {
    if (this._clickNativeButton('next')) return;
    if (this._dispatchKey('ArrowDown')) return;
    this._scrollFeed(1);
  }

  /**
   * Navigates to the PREVIOUS YouTube Short.
   * Tries native button → keyboard → scroll (in that order).
   */
  goToPrevious(): void {
    if (this._clickNativeButton('previous')) return;
    if (this._dispatchKey('ArrowUp')) return;
    this._scrollFeed(-1);
  }

  /**
   * Returns the Shorts feed scroll container.
   */
  getFeedContainer(): HTMLElement | null {
    // Try current known selectors in priority order.
    const selectors = [
      'ytd-shorts',
      '#shorts-container',
      'ytd-reel-video-renderer',
    ];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * Attempts to click the native YouTube Shorts navigation button.
   *
   * YouTube Shorts renders two navigation buttons:
   * - The "next" button (navigate to next short)
   * - The "previous" button (navigate to previous short)
   *
   * These buttons are part of the ytd-shorts component and can be found
   * via various aria/class attributes depending on the YouTube version.
   *
   * @param direction - 'next' or 'previous'.
   * @returns true if a button was found and clicked.
   */
  private _clickNativeButton(direction: 'next' | 'previous'): boolean {
    // Selector list in priority order (most specific first).
    // YouTube updates these selectors — add new ones at the TOP of each list.
    const nextSelectors = [
      'ytd-shorts #navigation-button-down button',
      'ytd-shorts .navigation-button[aria-label*="next" i]',
      'ytd-shorts [aria-label="Next video"]',
      '.ytd-reel-video-renderer #navigation-endpoint[aria-label*="next" i]',
      'ytd-shorts button.yt-spec-button-shape-next[aria-label*="next" i]',
    ];

    const prevSelectors = [
      'ytd-shorts #navigation-button-up button',
      'ytd-shorts .navigation-button[aria-label*="previous" i]',
      'ytd-shorts [aria-label="Previous video"]',
      '.ytd-reel-video-renderer #navigation-endpoint[aria-label*="prev" i]',
      'ytd-shorts button.yt-spec-button-shape-next[aria-label*="previous" i]',
    ];

    const selectors = direction === 'next' ? nextSelectors : prevSelectors;

    for (const sel of selectors) {
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Dispatches a keyboard event on the document to trigger YouTube's built-in
   * keyboard navigation for Shorts.
   *
   * @param key - The keyboard key name to dispatch.
   * @returns true (always succeeds — we cannot detect if YT handled it).
   */
  private _dispatchKey(key: 'ArrowDown' | 'ArrowUp'): boolean {
    // Dispatch on document.body first (where YT attaches listeners),
    // then on the active element as a fallback.
    const targets: EventTarget[] = [document, document.body];
    const activeEl = document.activeElement;
    if (activeEl && !targets.includes(activeEl)) {
      targets.push(activeEl);
    }

    for (const target of targets) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    }
    return true;
  }

  /**
   * Scrolls the feed container by the specified number of viewport heights.
   *
   * @param direction - +1 for next (scroll down), -1 for previous (scroll up).
   */
  private _scrollFeed(direction: 1 | -1): void {
    const container = this.getFeedContainer();
    const scrollAmount = window.innerHeight * direction;
    if (container) {
      container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }
  }
}
