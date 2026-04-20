import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectV2exInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  const monitorSignals = context.monitorItems
    .filter((item) => item.source === 'v2ex')
    .map((item) => createInboxSignalFromMonitorItem(item));

  if (monitorSignals.length > 0) {
    return monitorSignals;
  }

  return (context.settings.monitorV2exQueries ?? []).map((query) => ({
    source: 'v2ex',
    status: 'needs_reply',
    title: `Inbox follow-up for ${query}`,
    excerpt: 'Configured from monitorV2exQueries before live fetch results arrive.',
  }));
}
