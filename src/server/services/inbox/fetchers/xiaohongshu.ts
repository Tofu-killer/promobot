import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectXiaohongshuInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  return context.monitorItems
    .filter((item) => item.source === 'xiaohongshu' && item.status !== 'ignored')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
