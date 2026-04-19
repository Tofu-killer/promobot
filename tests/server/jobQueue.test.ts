import { describe, expect, it } from 'vitest';
import { createJobQueueStore } from '../../src/server/store/jobQueue';
import { cleanupTestDatabasePath, createTestDatabasePath } from './testDb';

describe('job queue store', () => {
  it('enqueues jobs, lists due work, and tracks lifecycle transitions', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const store = createJobQueueStore();

      const first = store.enqueue({
        type: 'publish',
        payload: { draftId: 42 },
        runAt: '2026-04-19T10:00:00.000Z',
      });
      store.enqueue({
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T12:00:00.000Z',
      });

      const dueJobs = await store.listDueJobs('2026-04-19T10:30:00.000Z');
      expect(dueJobs).toEqual([
        expect.objectContaining({
          id: first.id,
          type: 'publish',
          status: 'pending',
        }),
      ]);

      expect(await store.markRunning(first.id, '2026-04-19T10:31:00.000Z')).toBe(true);
      await store.markDone(first.id, '2026-04-19T10:32:00.000Z');

      expect(store.getStats('2026-04-19T10:33:00.000Z')).toEqual({
        pending: 1,
        running: 0,
        done: 1,
        failed: 0,
        duePending: 0,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('requeues abandoned running jobs and records failures', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const store = createJobQueueStore();
      const job = store.enqueue({
        type: 'publish',
        payload: { draftId: 7 },
        runAt: '2026-04-19T09:00:00.000Z',
      });

      await store.markRunning(job.id, '2026-04-19T09:01:00.000Z');
      expect(store.requeueRunningJobs('2026-04-19T09:02:00.000Z')).toBe(1);

      expect(await store.markRunning(job.id, '2026-04-19T09:03:00.000Z')).toBe(true);
      await store.markFailed(job.id, 'boom', '2026-04-19T09:04:00.000Z');

      expect(store.list({ limit: 5 })).toEqual([
        expect.objectContaining({
          id: job.id,
          status: 'failed',
          attempts: 2,
          lastError: 'boom',
        }),
      ]);
      expect(store.getStats('2026-04-19T09:05:00.000Z')).toEqual({
        pending: 0,
        running: 0,
        done: 0,
        failed: 1,
        duePending: 0,
      });
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });

  it('upserts and clears publish jobs by draft id', async () => {
    const { rootDir } = createTestDatabasePath();
    try {
      const store = createJobQueueStore();

      const first = store.schedulePublishJob(42, '2026-04-19T11:00:00.000Z');
      const second = store.schedulePublishJob(42, '2026-04-19T12:00:00.000Z');

      expect(second.id).toBe(first.id);
      expect(store.list({ limit: 5 })).toEqual([
        expect.objectContaining({
          id: first.id,
          type: 'publish',
          payload: '{"draftId":42}',
          status: 'pending',
          runAt: '2026-04-19T12:00:00.000Z',
        }),
      ]);

      expect(store.deletePendingPublishJobs(42)).toBe(1);
      expect(store.list({ limit: 5 })).toEqual([]);
    } finally {
      cleanupTestDatabasePath(rootDir);
    }
  });
});
