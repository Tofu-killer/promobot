import { Router } from 'express';
import { createChannelAccountStore } from '../store/channelAccounts';

const channelAccountStore = createChannelAccountStore();

export const channelAccountsRouter = Router();

channelAccountsRouter.get('/', (_request, response) => {
  response.json({ channelAccounts: channelAccountStore.list() });
});

channelAccountsRouter.post('/', (request, response) => {
  const {
    platform,
    accountKey,
    displayName,
    authType,
    status,
    metadata,
  } = request.body ?? {};

  if (
    typeof platform !== 'string' ||
    typeof accountKey !== 'string' ||
    typeof displayName !== 'string' ||
    typeof authType !== 'string' ||
    typeof status !== 'string'
  ) {
    response.status(400).json({ error: 'invalid channel account payload' });
    return;
  }

  const channelAccount = channelAccountStore.create({
    platform,
    accountKey,
    displayName,
    authType,
    status,
    metadata: isPlainObject(metadata) ? metadata : undefined,
  });

  response.status(201).json({ channelAccount });
});

channelAccountsRouter.patch('/:id', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const input = request.body ?? {};
  const channelAccount = channelAccountStore.update(id, {
    platform: typeof input.platform === 'string' ? input.platform : undefined,
    accountKey: typeof input.accountKey === 'string' ? input.accountKey : undefined,
    displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
    authType: typeof input.authType === 'string' ? input.authType : undefined,
    status: typeof input.status === 'string' ? input.status : undefined,
    metadata: isPlainObject(input.metadata) ? input.metadata : undefined,
  });

  if (!channelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  response.json({ channelAccount });
});

channelAccountsRouter.post('/:id/test', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: 'invalid channel account id' });
    return;
  }

  const input = request.body ?? {};
  if (
    input.status !== undefined &&
    input.status !== 'healthy' &&
    input.status !== 'failed'
  ) {
    response.status(400).json({ error: 'invalid channel account test payload' });
    return;
  }

  const channelAccount = channelAccountStore.test(id, {
    status: input.status,
  });

  if (!channelAccount) {
    response.status(404).json({ error: 'channel account not found' });
    return;
  }

  response.json({
    ok: true,
    test: {
      checkedAt: new Date().toISOString(),
      status: channelAccount.status,
    },
    channelAccount,
  });
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
