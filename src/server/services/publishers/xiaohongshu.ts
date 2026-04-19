import { createStubPublisher } from './stub';

export const publishToXiaohongshu = createStubPublisher({
  platform: 'xiaohongshu',
  mode: 'browser',
  status: 'manual_required',
});
