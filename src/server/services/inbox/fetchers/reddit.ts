import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types';

export function collectRedditInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  const monitorSignals = context.monitorItems
    .filter((item) => item.source === 'reddit')
    .map((item) => createInboxSignalFromMonitorItem(item));

  if (monitorSignals.length > 0) {
    return monitorSignals;
  }

  return (context.settings.monitorRedditQueries ?? []).map((query) => ({
    source: 'reddit',
    status: 'needs_reply',
    title: `Inbox follow-up for ${query}`,
    excerpt: 'Configured from monitorRedditQueries before live fetch results arrive.',
  }));
}
