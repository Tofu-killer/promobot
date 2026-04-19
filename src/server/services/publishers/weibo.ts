import { createStubPublisher } from './stub';

export const publishToWeibo = createStubPublisher({
  platform: 'weibo',
  mode: 'browser',
  status: 'manual_required',
});
