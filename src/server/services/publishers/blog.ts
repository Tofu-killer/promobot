import { createStubPublisher } from './stub.js';

export const publishToBlog = createStubPublisher({
  platform: 'blog',
  mode: 'manual',
  status: 'manual_required',
});
