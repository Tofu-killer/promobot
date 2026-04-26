import {
  createInboxSignalFromMonitorItem,
  type InboxFetcherContext,
  type InboxSignal,
} from './types.js';

export function collectInstagramInboxSignals(context: InboxFetcherContext): InboxSignal[] {
  return context.monitorItems
    .filter((item) => item.source === 'instagram' && item.status !== 'ignored')
    .map((item) => createInboxSignalFromMonitorItem(item));
}
