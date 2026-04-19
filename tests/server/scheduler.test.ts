import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createJobRecord,
  type JobStore,
} from '../../src/server/lib/jobs';
import { createScheduler } from '../../src/server/scheduler';

describe('scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs each due pending job once with parsed payload', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler({
      pollMs: 10,
      handlers: { publish },
    });

    const results = await scheduler.runDueJobs([
      createJobRecord({
        id: 1,
        type: 'publish',
        payload: { draftId: 42 },
        runAt: '2026-04-19T10:00:00.000Z',
      }),
    ]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      { draftId: 42 },
      expect.objectContaining({ id: 1, type: 'publish' }),
    );
    expect(results).toEqual([
      expect.objectContaining({ jobId: 1, outcome: 'completed' }),
    ]);
  });

  it('skips jobs that are not pending, not due, or missing handlers', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler({
      pollMs: 10,
      now: () => new Date('2026-04-19T10:00:00.000Z'),
      handlers: { publish },
    });

    const results = await scheduler.runDueJobs([
      createJobRecord({
        id: 1,
        type: 'publish',
        payload: { draftId: 1 },
        status: 'done',
        runAt: '2026-04-19T09:00:00.000Z',
      }),
      createJobRecord({
        id: 2,
        type: 'publish',
        payload: { draftId: 2 },
        runAt: '2026-04-19T11:00:00.000Z',
      }),
      createJobRecord({
        id: 3,
        type: 'monitor_fetch',
        payload: { source: 'rss' },
        runAt: '2026-04-19T09:00:00.000Z',
      }),
    ]);

    expect(publish).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({ jobId: 1, outcome: 'skipped', reason: 'status:done' }),
      expect.objectContaining({ jobId: 2, outcome: 'skipped', reason: 'not_due' }),
      expect.objectContaining({ jobId: 3, outcome: 'skipped', reason: 'missing_handler' }),
    ]);
  });

  it('loads due jobs from the store and records completion and failure outcomes', async () => {
    const seen: string[] = [];
    const store: JobStore = {
      async listDueJobs() {
        seen.push('list');
        return [
          createJobRecord({
            id: 1,
            type: 'publish',
            payload: { draftId: 7 },
            runAt: '2026-04-19T10:00:00.000Z',
          }),
          createJobRecord({
            id: 2,
            type: 'publish',
            payload: { draftId: 8, shouldFail: true },
            runAt: '2026-04-19T10:00:00.000Z',
          }),
        ];
      },
      async markRunning(jobId) {
        seen.push(`running:${jobId}`);
        return true;
      },
      async markDone(jobId) {
        seen.push(`done:${jobId}`);
      },
      async markFailed(jobId, error) {
        seen.push(`failed:${jobId}:${error}`);
      },
    };

    const publish = vi.fn().mockImplementation(async (payload: { shouldFail?: boolean }) => {
      if (payload.shouldFail) {
        throw new Error('boom');
      }
    });

    const scheduler = createScheduler({
      pollMs: 10,
      store,
      now: () => new Date('2026-04-19T10:00:00.000Z'),
      handlers: { publish },
    });

    const results = await scheduler.tick();

    expect(publish).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([
      'list',
      'running:1',
      'done:1',
      'running:2',
      'failed:2:boom',
    ]);
    expect(results).toEqual([
      expect.objectContaining({ jobId: 1, outcome: 'completed' }),
      expect.objectContaining({ jobId: 2, outcome: 'failed', reason: 'boom' }),
    ]);
  });

  it('starts and stops the polling loop without overlapping ticks', async () => {
    vi.useFakeTimers();

    let release: (() => void) | undefined;
    const tickGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: JobStore = {
      listDueJobs: vi.fn().mockImplementation(async () => {
        await tickGate;
        return [];
      }),
      markRunning: vi.fn(),
      markDone: vi.fn(),
      markFailed: vi.fn(),
    };

    const scheduler = createScheduler({
      pollMs: 100,
      store,
      handlers: {},
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(store.listDueJobs).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(store.listDueJobs).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(300);

    expect(store.listDueJobs).toHaveBeenCalledTimes(2);
  });
});
