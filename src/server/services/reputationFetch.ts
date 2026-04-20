import type { ReputationItemRecord } from '../store/reputation';
import { createReputationStore } from '../store/reputation';
import type { MonitorItemRecord } from '../store/monitor';
import { createMonitorStore } from '../store/monitor';
import { createSettingsStore } from '../store/settings';

export interface ReputationFetchResult {
  items: ReputationItemRecord[];
  inserted: number;
}

export function createReputationFetchService() {
  const reputationStore = createReputationStore();
  const monitorStore = createMonitorStore();
  const settingsStore = createSettingsStore();

  return {
    fetchNow(): ReputationFetchResult {
      const signals = collectReputationSignals(monitorStore.list(), settingsStore.get());
      const items = signals.map((signal) => reputationStore.create(signal));

      return {
        items,
        inserted: items.length,
      };
    },
  };
}

function collectReputationSignals(
  monitorItems: MonitorItemRecord[],
  settings: {
    monitorRedditQueries?: string[];
    monitorV2exQueries?: string[];
  },
) {
  const monitorSignals = monitorItems
    .filter((item) => item.source !== 'rss')
    .map((item) => {
      const sentiment = classifySentiment(item.title, item.detail);

      return {
        source: item.source,
        sentiment,
        status: sentiment === 'negative' ? 'escalate' : 'new',
        title: item.title,
        detail: item.detail,
      };
    });

  if (monitorSignals.length > 0) {
    return monitorSignals;
  }

  const configuredSignals = [
    ...(settings.monitorRedditQueries ?? []).map((query) => ({
      source: 'reddit',
      sentiment: 'neutral',
      status: 'new',
      title: `Watching reputation query: ${query}`,
      detail: 'Configured from monitorRedditQueries before live mentions arrive.',
    })),
    ...(settings.monitorV2exQueries ?? []).map((query) => ({
      source: 'v2ex',
      sentiment: 'neutral',
      status: 'new',
      title: `Watching reputation query: ${query}`,
      detail: 'Configured from monitorV2exQueries before live mentions arrive.',
    })),
  ];

  if (configuredSignals.length > 0) {
    return configuredSignals;
  }

  return [
    {
      source: 'reddit',
      sentiment: 'positive',
      status: 'new',
      title: 'Lower APAC latency praise',
      detail: 'A user praised lower Claude routing latency from Perth compared with larger aggregators.',
    },
    {
      source: 'facebook-group',
      sentiment: 'negative',
      status: 'escalate',
      title: 'Billing confusion mention',
      detail: 'A prospect asked whether usage caps and billing are transparent enough for agency workflows.',
    },
  ];
}

function classifySentiment(title: string, detail: string) {
  const haystack = `${title}\n${detail}`.toLowerCase();

  if (
    includesAny(haystack, [
      'confusion',
      'complaint',
      'error',
      'problem',
      'issue',
      'billing',
      'expired',
      'transparent',
      'fail',
    ])
  ) {
    return 'negative';
  }

  if (
    includesAny(haystack, [
      'praise',
      'praised',
      'improved',
      'lower latency',
      'fast',
      'smooth',
      'recommend',
    ])
  ) {
    return 'positive';
  }

  return 'neutral';
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}
