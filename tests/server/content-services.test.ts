import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat } from '../../src/server/services/aiClient';
import { generateXDraft } from '../../src/server/services/generators/x';

const originalEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

beforeEach(() => {
  process.env.AI_BASE_URL = 'https://example.test/v1';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'test-model';
});

afterEach(() => {
  process.env.AI_BASE_URL = originalEnv.AI_BASE_URL;
  process.env.AI_API_KEY = originalEnv.AI_API_KEY;
  process.env.AI_MODEL = originalEnv.AI_MODEL;
  vi.unstubAllGlobals();
});

describe('ai client', () => {
  it('sends prompts through a configured client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'generated-response' } }],
        }),
      }),
    );

    const result = await chat('system prompt', 'user prompt');

    expect(result).toBe('generated-response');
  });
});

describe('x generator', () => {
  it('exports a draft generator with stable output shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'x-draft-content' } }],
        }),
      }),
    );

    const draft = await generateXDraft({
      topic: 'Claude support launched',
      tone: 'professional',
    });

    expect(draft.platform).toBe('x');
    expect(draft.content).toBe('x-draft-content');
    expect(draft.hashtags).toEqual([]);
  });
});
