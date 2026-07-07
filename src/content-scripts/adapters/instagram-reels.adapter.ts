/**
 * @file instagram-reels.adapter.ts
 * @description Platform adapter for Instagram Reels.
 *
 * Navigation strategy:
 * 1. PRIMARY: Click Instagram's native navigation arrows/buttons within
 *    the Reels player. Instagram renders "next" and "previous" SVG-icon
 *    buttons in the Reels viewer.
 *
 * 2. FALLBACK A: Dispatch ArrowDown / ArrowUp keyboard events. Instagram's
 *    Reels page responds to these keys for in-feed navigation.
 *
 * 3. FALLBACK B: Scroll the reels container by one viewport height.
 *    Instagram Reels uses a vertical scroll container where each reel
 *    occupies exactly 100vh.
 *
 * NOTE: Instagram's DOM uses obfuscated/hashed class names that change with
 * each frontend deployment. Selectors use aria-labels and data attributes
 * where possible, which are more stable. When selectors break, update only
 * this file.
 */

import type { PlatformAdapter } from './platform-adapter.interface';
import type { PlatformStatus } from '../../shared/types';

export class InstagramReelsAdapter implements PlatformAdapter {
  readonly platformName: PlatformStatus = 'INSTAGRAM_REELS';

  /**
   * Returns true when on an Instagram Reels page.
   * Covers /reels/, /reels/<id>, and the Reels tab URL.
   */
  isSupportedPage(): boolean {
    const host = window.location.hostname;
    const path = window.location.pathname;
    return (
      (host === 'www.instagram.com' || host === 'instagram.com') &&
      (path.startsWith('/reels') || path === '/reels')
    );
  }

  /**
   * Navigates to the NEXT Instagram Reel.
   */
  goToNext(): void {
    if (this._clickNativeButton('next')) return;
    if (this._dispatchKey('ArrowDown')) return;
    this._scrollFeed(1);
  }

  /**
   * Navigates to the PREVIOUS Instagram Reel.
   */
  goToPrevious(): void {
    if (this._clickNativeButton('previous')) return;
    if (this._dispatchKey('ArrowUp')) return;
    this._scrollFeed(-1);
  }

  /**
   * Returns the Reels feed scroll container.
   */
  getFeedContainer(): HTMLElement | null {
    // Instagram's Reels container selectors (most specific first).
    const selectors = [
      'main[role="main"] > div > div',
      '[data-testid="reels-viewer"]',
      'div[style*="overflow: hidden"] > div[style*="overflow: hidden"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        // Verify it's a scrollable container (heuristic).
        const style = getComputedStyle(el);
        if (
          style.overflowY === 'hidden' ||
          style.overflowY === 'scroll' ||
          el.scrollHeight > el.clientHeight
        ) {
          return el;
        }
      }
    }
    return null;
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * Attempts to click Instagram's native Reels navigation button.
   *
   * Instagram's Reels player renders SVG-based navigation buttons.
   * We identify them via aria-labels and SVG content heuristics.
   *
   * @param direction - 'next' or 'previous'.
   * @returns true if a button was found and clicked.
   */
  private _clickNativeButton(direction: 'next' | 'previous'): boolean {
    const nextSelectors = [
      '[aria-label="Next"]',
      '[aria-label="next"]',
      'button[aria-label*="next" i]',
      'svg[aria-label*="next" i]',
      // Reels-specific navigation chevron buttons
      '[data-visualcompletion="css-img"][aria-label*="next" i]',
    ];

    const prevSelectors = [
      '[aria-label="Previous"]',
      '[aria-label="previous"]',
      'button[aria-label*="previous" i]',
      'svg[aria-label*="prev" i]',
      '[data-visualcompletion="css-img"][aria-label*="prev" i]',
    ];

    const selectors = direction === 'next' ? nextSelectors : prevSelectors;

    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        // If it's an SVG, click the parent button.
        const clickTarget =
          el.tagName.toLowerCase() === 'svg'
            ? (el.closest('button') as HTMLElement | null) ?? el
            : el;
        clickTarget.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Dispatches a keyboard event for Instagram's Reels keyboard navigation.
   *
   * @param key - The keyboard key to simulate.
   * @returns true (always).
   */
  private _dispatchKey(key: 'ArrowDown' | 'ArrowUp'): boolean {
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
   * Scrolls the Instagram Reels feed container.
   *
   * @param direction - +1 = next (down), -1 = previous (up).
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
