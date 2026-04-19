import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorStore } from '../store/monitor';

export interface MonitorFetchResult {
  items: MonitorItemRecord[];
  inserted: number;
}

export function createMonitorFetchService() {
  const monitorStore = createMonitorStore();

  return {
    fetchNow(now: Date = new Date()): MonitorFetchResult {
      const minuteStamp = now.toISOString();
      const seeds = [
        {
          source: 'rss',
          title: `APAC pricing watch ${minuteStamp}`,
          detail: 'Tracked a competitor pricing update relevant to Australia-facing model buyers.',
        },
        {
          source: 'reddit',
          title: `Latency discussion ${minuteStamp}`,
          detail: 'Observed a new community thread comparing OpenRouter alternatives for AU traffic.',
        },
        {
          source: 'x',
          title: `Routing feature launch ${minuteStamp}`,
          detail: 'Detected a social post about routing/failover that may need a follow-up response.',
        },
      ];

      const items = seeds.map((seed) =>
        monitorStore.create({
          ...seed,
          status: 'new',
        }),
      );

      return {
        items,
        inserted: items.length,
      };
    },
  };
}
