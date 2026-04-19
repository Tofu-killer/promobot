import type { ReputationItemRecord } from '../store/reputation';
import { createReputationStore } from '../store/reputation';

export interface ReputationFetchResult {
  items: ReputationItemRecord[];
  inserted: number;
}

export function createReputationFetchService() {
  const reputationStore = createReputationStore();

  return {
    fetchNow(now: Date = new Date()): ReputationFetchResult {
      const stamp = now.toISOString();
      const seeds = [
        {
          source: 'reddit',
          sentiment: 'positive',
          status: 'new',
          title: `Lower APAC latency praise ${stamp}`,
          detail: 'A user praised lower Claude routing latency from Perth compared with larger aggregators.',
        },
        {
          source: 'facebook-group',
          sentiment: 'negative',
          status: 'escalate',
          title: `Billing confusion mention ${stamp}`,
          detail: 'A prospect asked whether usage caps and billing are transparent enough for agency workflows.',
        },
      ];

      const items = seeds.map((seed) => reputationStore.create(seed));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}
