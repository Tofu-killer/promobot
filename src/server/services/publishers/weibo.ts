import { createStubPublisher } from './stub.js';

export const publishToWeibo = createStubPublisher({
  platform: 'weibo',
  mode: 'browser',
  status: 'manual_required',
});
