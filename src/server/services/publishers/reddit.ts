import { createStubPublisher } from './stub';

export const publishToReddit = createStubPublisher({
  platform: 'reddit',
  mode: 'api',
});
