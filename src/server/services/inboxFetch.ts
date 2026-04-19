import type { InboxItemRecord } from '../store/inbox';
import { createInboxStore } from '../store/inbox';

export interface InboxFetchResult {
  items: InboxItemRecord[];
  inserted: number;
}

export function createInboxFetchService() {
  const inboxStore = createInboxStore();

  return {
    fetchNow(now: Date = new Date()): InboxFetchResult {
      const stamp = now.toISOString();
      const seeds = [
        {
          source: 'reddit',
          status: 'needs_reply',
          author: 'apac-builder',
          title: `Need OpenRouter alternative for AU users ${stamp}`,
          excerpt: 'Looking for lower-latency multi-model routing with predictable pricing in Australia.',
        },
        {
          source: 'x',
          status: 'needs_review',
          author: 'latency_hunter',
          title: `Any cheap Claude-compatible gateway? ${stamp}`,
          excerpt: 'Asking for model routing plus retry behaviour without paying OpenRouter pricing.',
        },
      ];

      const items = seeds.map((seed) => inboxStore.create(seed));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}
