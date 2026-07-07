/**
 * @file adapter-registry.ts
 * @description Registry of all registered platform adapters.
 *
 * To add a new platform (e.g. TikTok):
 * 1. Create TikTokAdapter implementing PlatformAdapter.
 * 2. Import it here and add it to the ADAPTERS array.
 * 3. No other files need changing.
 *
 * The registry searches adapters in array order; earlier entries take
 * precedence if multiple adapters could theoretically match (shouldn't
 * happen with well-scoped isSupportedPage() implementations).
 */

import type { PlatformAdapter } from './platform-adapter.interface';
import { YouTubeShortsAdapter } from './youtube-shorts.adapter';
import { InstagramReelsAdapter } from './instagram-reels.adapter';

/**
 * Ordered list of all registered platform adapters.
 * Add new adapters here. Earlier entries have higher priority.
 */
const ADAPTERS: PlatformAdapter[] = [
  new YouTubeShortsAdapter(),
  new InstagramReelsAdapter(),

  // ─────────────────────────────────────────────────────────
  // ADD NEW ADAPTERS BELOW THIS LINE
  // Example:
  //   new TikTokAdapter(),       // src/content-scripts/adapters/tiktok.adapter.ts
  //   new FacebookReelsAdapter(), // src/content-scripts/adapters/facebook-reels.adapter.ts
  // ─────────────────────────────────────────────────────────
];

/**
 * Finds the first adapter that reports isSupportedPage() === true
 * for the current page.
 *
 * @returns The matching PlatformAdapter, or null if no adapter matches.
 */
export function detectAdapter(): PlatformAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.isSupportedPage()) {
      return adapter;
    }
  }
  return null;
}

export type { PlatformAdapter };
