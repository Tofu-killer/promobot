import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectXInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  const monitorSignals = context.monitorItems
    .filter((item) => item.source === 'x')
    .map((item) => createInboxSignalFromMonitorItem(item));

  if (monitorSignals.length > 0) {
    return monitorSignals;
  }

  return (context.settings.monitorXQueries ?? []).map((query) => ({
    source: 'x',
    status: 'needs_review',
    title: `Inbox follow-up for ${query}`,
    excerpt: 'Configured from monitorXQueries before live fetch results arrive.',
  }));
}
