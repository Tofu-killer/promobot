import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishToBlog } from '../../src/server/services/publishers/blog';

const originalEnv = {
  BLOG_PUBLISH_OUTPUT_DIR: process.env.BLOG_PUBLISH_OUTPUT_DIR,
};

describe('publishToBlog', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(tmpdir(), 'promobot-blog-publisher-'));
    process.env.BLOG_PUBLISH_OUTPUT_DIR = outputDir;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T10:11:12.000Z'));
  });

  afterEach(() => {
    process.env.BLOG_PUBLISH_OUTPUT_DIR = originalEnv.BLOG_PUBLISH_OUTPUT_DIR;
    vi.useRealTimers();
    rmSync(outputDir, { force: true, recursive: true });
  });

  it('writes a local markdown file and returns a published contract', async () => {
    const result = await publishToBlog({
      draftId: 12,
      title: 'Launch post',
      content: 'Blog draft body',
      target: 'blog-main',
    });

    const outputPath = path.join(outputDir, 'blog-12-launch-post.md');

    expect(readFileSync(outputPath, 'utf8')).toBe(`---
draftId: "12"
title: "Launch post"
target: "blog-main"
publishedAt: "2026-04-21T10:11:12.000Z"
---

Blog draft body
`);

    expect(result).toEqual({
      platform: 'blog',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: `file://${outputPath}`,
      externalId: 'blog-12-launch-post',
      message: `blog publisher wrote draft 12 to ${outputPath}`,
      publishedAt: '2026-04-21T10:11:12.000Z',
      details: {
        target: 'blog-main',
        outputPath,
      },
    });
  });
});
