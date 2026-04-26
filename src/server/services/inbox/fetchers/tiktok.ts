import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectTiktokInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  return context.monitorItems
    .filter((item) => item.source === 'tiktok' && item.status !== 'ignored')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
