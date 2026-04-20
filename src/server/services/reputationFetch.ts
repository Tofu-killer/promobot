import type { ReputationItemRecord } from '../store/reputation';
import { createReputationStore } from '../store/reputation';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';
import { createReputationCollectorService } from './reputation/collector';

export interface ReputationFetchResult {
  items: ReputationItemRecord[];
  inserted: number;
}

export function createReputationFetchService() {
  const reputationStore = createReputationStore();
  const monitorStore = createMonitorStore();
  const settingsStore = createSettingsStore();
  const collectorService = createReputationCollectorService();

  return {
    fetchNow(): ReputationFetchResult {
      const signals = collectorService.collect({
        monitorItems: monitorStore.list(),
        settings: settingsStore.get(),
      });
      const items = signals.map((signal) => reputationStore.create(signal));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}
