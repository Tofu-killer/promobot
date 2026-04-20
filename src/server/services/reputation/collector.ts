import type { MonitorItemRecord } from '../../store/monitor.js';
import type { CreateReputationItemInput } from '../../store/reputation.js';
import type { SettingsRecord } from '../../store/settings.js';
import {
  createReputationSentimentService,
  type ReputationSentimentService,
} from './sentiment.js';

type ReputationCollectorSettings = Pick<
  SettingsRecord,
  'monitorXQueries' | 'monitorRedditQueries' | 'monitorV2exQueries'
>;

export interface ReputationCollectorInput {
  monitorItems: MonitorItemRecord[];
  settings: ReputationCollectorSettings;
}

export interface ReputationCollectorService {
  collect(input: ReputationCollectorInput): CreateReputationItemInput[];
}

interface ReputationCollectorDependencies {
  sentimentService?: ReputationSentimentService;
}

export function createReputationCollectorService(
  dependencies: ReputationCollectorDependencies = {},
): ReputationCollectorService {
  const sentimentService = dependencies.sentimentService ?? createReputationSentimentService();

  return {
    collect({ monitorItems, settings }) {
      const monitorSignals = monitorItems
        .filter((item) => item.source !== 'rss')
        .map((item) => ({
          projectId: item.projectId,
          source: item.source,
          title: item.title,
          detail: item.detail,
          ...sentimentService.analyze({
            title: item.title,
            detail: item.detail,
          }),
        }));

      if (monitorSignals.length > 0) {
        return monitorSignals;
      }

      const configuredSignals = [
        ...(settings.monitorXQueries ?? []).map((query) => ({
          source: 'x',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: 'Configured from monitorXQueries before live mentions arrive.',
        })),
        ...(settings.monitorRedditQueries ?? []).map((query) => ({
          source: 'reddit',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: 'Configured from monitorRedditQueries before live mentions arrive.',
        })),
        ...(settings.monitorV2exQueries ?? []).map((query) => ({
          source: 'v2ex',
          sentiment: 'neutral' as const,
          status: 'new' as const,
          title: `Watching reputation query: ${query}`,
          detail: 'Configured from monitorV2exQueries before live mentions arrive.',
        })),
      ];

      if (configuredSignals.length > 0) {
        return configuredSignals;
      }

      if (shouldDisableSeedDataInProduction()) {
        return [];
      }

      return buildSeedSignals();
    },
  };
}

function buildSeedSignals(): CreateReputationItemInput[] {
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

function shouldDisableSeedDataInProduction() {
  return process.env.NODE_ENV === 'production';
}
