export type ReputationSentiment = 'positive' | 'neutral' | 'negative';
export type ReputationFollowUpStatus = 'new' | 'escalate';

export interface ReputationSentimentInput {
  title: string;
  detail: string;
}

export interface ReputationSentimentResult {
  sentiment: ReputationSentiment;
  status: ReputationFollowUpStatus;
}

export interface ReputationSentimentService {
  analyze(input: ReputationSentimentInput): ReputationSentimentResult;
}

export function createReputationSentimentService(): ReputationSentimentService {
  return {
    analyze({ title, detail }) {
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
        return {
          sentiment: 'negative',
          status: 'escalate',
        };
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
        return {
          sentiment: 'positive',
          status: 'new',
        };
      }

      return {
        sentiment: 'neutral',
        status: 'new',
      };
    },
  };
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}
