import { createStubPublisher } from './stub';

export const publishToBlog = createStubPublisher({
  platform: 'blog',
  mode: 'manual',
});
