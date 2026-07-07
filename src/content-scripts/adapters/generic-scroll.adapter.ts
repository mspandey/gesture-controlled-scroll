/**
 * @file generic-scroll.adapter.ts
 * @description A generic fallback adapter that enables gesture-based scrolling on all websites without a specific adapter.
 */

import type { PlatformAdapter } from './platform-adapter.interface';
import type { PlatformStatus } from '../../shared/types';

export class GenericScrollAdapter implements PlatformAdapter {
  readonly platformName: PlatformStatus = 'UNSUPPORTED';

  /**
   * Returns true on all pages, acting as a universal fallback.
   */
  isSupportedPage(): boolean {
    return true;
  }

  /**
   * Navigates down by scrolling the window by a portion of the viewport height.
   */
  goToNext(): void {
    const scrollAmount = window.innerHeight * 0.8;
    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
  }

  /**
   * Navigates up by scrolling the window by a portion of the viewport height.
   */
  goToPrevious(): void {
    const scrollAmount = window.innerHeight * 0.8;
    window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
  }
}
