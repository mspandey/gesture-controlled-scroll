/**
 * @file platform-adapter.interface.ts
 * @description The PlatformAdapter interface that all site-specific adapters must implement.
 *
 * ============================================================
 * ADAPTER PATTERN — HOW TO ADD A NEW PLATFORM (e.g. TikTok)
 * ============================================================
 *
 * 1. Create a new file: src/content-scripts/adapters/tiktok.adapter.ts
 *
 * 2. Implement the PlatformAdapter interface:
 *
 *      import type { PlatformAdapter } from './platform-adapter.interface';
 *      import type { PlatformStatus } from '../../shared/types';
 *
 *      export class TikTokAdapter implements PlatformAdapter {
 *        readonly platformName: PlatformStatus = 'TIKTOK'; // add to PlatformStatus union
 *
 *        isSupportedPage(): boolean {
 *          return window.location.hostname.includes('tiktok.com');
 *        }
 *
 *        goToNext(): void {
 *          // Find TikTok's "next" button and click it, or dispatch ArrowDown.
 *          const nextBtn = document.querySelector('[data-e2e="arrow-right"]') as HTMLElement | null;
 *          if (nextBtn) { nextBtn.click(); return; }
 *          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
 *        }
 *
 *        goToPrevious(): void {
 *          const prevBtn = document.querySelector('[data-e2e="arrow-left"]') as HTMLElement | null;
 *          if (prevBtn) { prevBtn.click(); return; }
 *          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
 *        }
 *
 *        getFeedContainer(): HTMLElement | null {
 *          return document.querySelector('.swiper-wrapper') as HTMLElement | null;
 *        }
 *      }
 *
 * 3. Register the adapter in adapter-registry.ts — add it to the ADAPTERS array.
 *
 * 4. Add the new hostname to manifest.json:
 *      - content_scripts "matches": add "https://www.tiktok.com/*"
 *      - host_permissions: add "https://www.tiktok.com/*"
 *
 * 5. No changes needed to the gesture engine or content-main.ts.
 *
 * ============================================================
 */

import type { PlatformStatus } from '../../shared/types';

/**
 * Common interface for all platform-specific navigation adapters.
 * Each adapter encapsulates the DOM-interaction logic for one website.
 */
export interface PlatformAdapter {
  /**
   * The platform identifier string returned in RuntimeState.platform.
   * Must match a value in the PlatformStatus union type.
   */
  readonly platformName: PlatformStatus;

  /**
   * Returns true if the extension is currently on a page where this adapter
   * should be active. Called once when the content script initialises and
   * again on navigation changes (for SPAs).
   *
   * @returns true if this adapter handles the current page.
   */
  isSupportedPage(): boolean;

  /**
   * Navigates to the NEXT video/reel in the feed.
   *
   * Implementation strategy (in priority order):
   * 1. Find and click the platform's native "next" button if available.
   * 2. Dispatch an ArrowDown keyboard event on the document.
   * 3. Scroll the feed container by one viewport height.
   */
  goToNext(): void;

  /**
   * Navigates to the PREVIOUS video/reel in the feed.
   *
   * Implementation strategy (in priority order):
   * 1. Find and click the platform's native "previous" button if available.
   * 2. Dispatch an ArrowUp keyboard event on the document.
   * 3. Scroll the feed container by negative one viewport height.
   */
  goToPrevious(): void;

  /**
   * Returns the main feed scroll container element, or null if not found.
   * Used for scroll-based fallback navigation.
   */
  getFeedContainer(): HTMLElement | null;
}
