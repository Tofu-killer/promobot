import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('system handoff request helpers', () => {
  it('loads browser handoffs through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            platform: 'facebookGroup',
            draftId: '33',
            title: 'Community update',
            accountKey: 'launch-campaign',
            status: 'pending',
            artifactPath:
              'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-33.json',
            createdAt: '2026-04-21T09:10:00.000Z',
            updatedAt: '2026-04-21T09:10:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    expect(typeof handoffModule.loadBrowserHandoffsRequest).toBe('function');

    const loadBrowserHandoffsRequest = handoffModule.loadBrowserHandoffsRequest as (
      limit?: number,
      projectId?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; draftId: string }>; total: number }>;

    const result = await loadBrowserHandoffsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-handoffs?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        platform: 'facebookGroup',
        draftId: '33',
      }),
    );
  });

  it('loads project-scoped browser handoffs through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ handoffs: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    const loadBrowserHandoffsRequest = handoffModule.loadBrowserHandoffsRequest as (
      limit?: number,
      projectId?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; draftId: string }>; total: number }>;

    await loadBrowserHandoffsRequest(25, 12);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/browser-handoffs?limit=25&projectId=12', undefined);
  });

  it('posts browser handoff completion through the shared helper without blank publishUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
        draftId: 13,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        externalId: 'fb-post-42',
        message: 'browser lane completed publish',
        publishedAt: '2026-04-23T10:10:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    expect(typeof handoffModule.completeBrowserHandoffRequest).toBe('function');

    const completeBrowserHandoffRequest = handoffModule.completeBrowserHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => Promise<unknown>;

    await completeBrowserHandoffRequest({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
      handoffAttempt: 1,
      publishStatus: 'published',
      publishUrl: '   ',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13.json',
          handoffAttempt: 1,
          publishStatus: 'published',
          message: 'browser handoff marked published',
        }),
      }),
    );
  });

  it('omits browser handoffAttempt when the shared helper is called without one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath:
          'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
        draftId: 13,
        draftStatus: 'published',
        platform: 'facebookGroup',
        mode: 'browser',
        status: 'published',
        success: true,
        publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        externalId: 'fb-post-42',
        message: 'browser lane completed publish',
        publishedAt: '2026-04-23T10:10:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    const completeBrowserHandoffRequest = handoffModule.completeBrowserHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      publishStatus: 'published' | 'failed';
      message?: string;
      publishUrl?: string;
    }) => Promise<unknown>;

    await completeBrowserHandoffRequest({
      artifactPath:
        'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
      publishStatus: 'published',
      publishUrl: 'https://facebook.com/groups/group-123/posts/42',
      message: 'browser lane completed publish',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/browser-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath:
            'artifacts/browser-handoffs/facebookGroup/launch-campaign/facebookGroup-draft-13-legacy.json',
          publishStatus: 'published',
          message: 'browser lane completed publish',
          publishUrl: 'https://facebook.com/groups/group-123/posts/42',
        }),
      }),
    );
  });

  it('posts inbox reply handoff completion through the shared helper with trimmed deliveryUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
        itemId: 88,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/abc123',
        externalId: 'msg-88',
        message: 'inbox reply handoff marked sent',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    expect(typeof handoffModule.completeInboxReplyHandoffRequest).toBe('function');

    const completeInboxReplyHandoffRequest = handoffModule.completeInboxReplyHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => Promise<unknown>;

    await completeInboxReplyHandoffRequest({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      replyStatus: 'sent',
      deliveryUrl: ' https://reddit.com/message/messages/abc123 ',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/inbox-reply-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          replyStatus: 'sent',
          message: 'inbox reply handoff marked sent',
          deliveryUrl: 'https://reddit.com/message/messages/abc123',
        }),
      }),
    );
  });

  it('includes inbox reply handoffAttempt when the shared helper receives one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        imported: true,
        artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
        itemId: 88,
        itemStatus: 'handled',
        platform: 'reddit',
        mode: 'browser',
        status: 'sent',
        success: true,
        deliveryUrl: 'https://reddit.com/message/messages/abc123',
        externalId: 'msg-88',
        message: 'inbox reply handoff marked sent',
        deliveredAt: '2026-04-23T11:15:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    const completeInboxReplyHandoffRequest = handoffModule.completeInboxReplyHandoffRequest as (input: {
      artifactPath: string;
      handoffAttempt?: number;
      replyStatus: 'sent' | 'failed';
      message?: string;
      deliveryUrl?: string;
    }) => Promise<unknown>;

    await completeInboxReplyHandoffRequest({
      artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
      handoffAttempt: 1,
      replyStatus: 'sent',
      deliveryUrl: ' https://reddit.com/message/messages/abc123 ',
      message: 'inbox reply handoff marked sent',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/inbox-reply-handoffs/import',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
          handoffAttempt: 1,
          replyStatus: 'sent',
          message: 'inbox reply handoff marked sent',
          deliveryUrl: 'https://reddit.com/message/messages/abc123',
        }),
      }),
    );
  });

  it('loads inbox reply handoffs through the shared helper without project scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            platform: 'reddit',
            itemId: '88',
            source: 'reddit',
            title: 'Need help with latency',
            author: 'user123',
            accountKey: 'reddit-main',
            status: 'pending',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
            createdAt: '2026-04-23T09:10:00.000Z',
            updatedAt: '2026-04-23T09:10:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    const loadInboxReplyHandoffsRequest = handoffModule.loadInboxReplyHandoffsRequest as (
      limit?: number,
      projectId?: number,
    ) => Promise<{ handoffs: Array<{ platform: string; itemId: string }>; total: number }>;

    const result = await loadInboxReplyHandoffsRequest(10);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/inbox-reply-handoffs?limit=10', undefined);
    expect(result.total).toBe(1);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        platform: 'reddit',
        itemId: '88',
      }),
    );
  });

  it('loads project-scoped inbox reply handoffs through the shared helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        handoffs: [
          {
            platform: 'reddit',
            itemId: 88,
            handoffAttempt: '2',
            source: 'reddit',
            title: 'Need lower latency in APAC',
            author: 'user123',
            accountKey: 'reddit-main',
            status: 'pending',
            artifactPath: 'artifacts/inbox-reply-handoffs/reddit/reddit-main/reddit-item-88.json',
            createdAt: '2026-04-23T11:00:00.000Z',
            updatedAt: '2026-04-23T11:00:00.000Z',
            resolvedAt: null,
          },
        ],
        total: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handoffModule = (await import('../../src/client/lib/systemHandoffs')) as Record<string, unknown>;

    const loadInboxReplyHandoffsRequest = handoffModule.loadInboxReplyHandoffsRequest as (
      limit?: number,
      projectId?: number,
    ) => Promise<{ handoffs: Array<{ itemId: string | number; handoffAttempt?: string | number | null }>; total: number }>;

    const result = await loadInboxReplyHandoffsRequest(15, 8);

    expect(fetchMock).toHaveBeenCalledWith('/api/system/inbox-reply-handoffs?limit=15&projectId=8', undefined);
    expect(result.handoffs[0]).toEqual(
      expect.objectContaining({
        itemId: 88,
        handoffAttempt: '2',
      }),
    );
  });
});
