import { describe, expect, it, vi } from 'vitest';

import { createDefaultJobHandlers } from '../../src/server/runtime/defaultJobHandlers';

describe('default job handlers', () => {
  it('passes projectId through to monitor, inbox, and reputation fetch handlers', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({ projectId: 7 }, {} as never);
    await handlers.inbox_fetch({ projectId: 8 }, {} as never);
    await handlers.reputation_fetch({ projectId: 9 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(7);
    expect(inboxFetchNow).toHaveBeenCalledWith(8);
    expect(reputationFetchNow).toHaveBeenCalledWith(9);
  });

  it('falls back to global fetches when projectId is missing or invalid', async () => {
    const monitorFetchNow = vi.fn().mockResolvedValue({ items: [], inserted: 0 });
    const inboxFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });
    const reputationFetchNow = vi.fn().mockReturnValue({ items: [], inserted: 0 });

    const handlers = createDefaultJobHandlers({
      monitorFetchService: {
        fetchNow: monitorFetchNow,
      },
      inboxFetchService: {
        fetchNow: inboxFetchNow,
      },
      reputationFetchService: {
        fetchNow: reputationFetchNow,
      },
      channelAccountSessionRequestHandler: vi.fn(),
      publishJobHandler: vi.fn(),
    });

    await handlers.monitor_fetch({}, {} as never);
    await handlers.inbox_fetch({ projectId: 'bad' }, {} as never);
    await handlers.reputation_fetch({ projectId: 0 }, {} as never);

    expect(monitorFetchNow).toHaveBeenCalledWith(undefined);
    expect(inboxFetchNow).toHaveBeenCalledWith(undefined);
    expect(reputationFetchNow).toHaveBeenCalledWith(undefined);
  });
});
