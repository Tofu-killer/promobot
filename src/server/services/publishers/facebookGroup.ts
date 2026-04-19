import { createStubPublisher } from './stub';

export const publishToFacebookGroup = createStubPublisher({
  platform: 'facebookGroup',
  mode: 'browser',
  status: 'manual_required',
});
