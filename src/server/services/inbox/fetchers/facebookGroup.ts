import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectFacebookGroupInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  return context.monitorItems
    .filter((item) => item.source === 'facebook-group' && item.status !== 'ignored')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
