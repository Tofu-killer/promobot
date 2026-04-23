import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectWeiboInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  return context.monitorItems
    .filter((item) => item.source === 'weibo' && item.status !== 'ignored')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
