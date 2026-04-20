import { createStubPublisher } from './stub.js';

export const publishToXiaohongshu = createStubPublisher({
  platform: 'xiaohongshu',
  mode: 'browser',
  status: 'manual_required',
});
