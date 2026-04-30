import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishToBlog } from '../../src/server/services/publishers/blog';

const originalEnv = {
  BLOG_PUBLISH_DRIVER: process.env.BLOG_PUBLISH_DRIVER,
  BLOG_PUBLISH_OUTPUT_DIR: process.env.BLOG_PUBLISH_OUTPUT_DIR,
  BLOG_WORDPRESS_SITE_URL: process.env.BLOG_WORDPRESS_SITE_URL,
  BLOG_WORDPRESS_USERNAME: process.env.BLOG_WORDPRESS_USERNAME,
  BLOG_WORDPRESS_APP_PASSWORD: process.env.BLOG_WORDPRESS_APP_PASSWORD,
  BLOG_GHOST_ADMIN_URL: process.env.BLOG_GHOST_ADMIN_URL,
  BLOG_GHOST_ADMIN_API_KEY: process.env.BLOG_GHOST_ADMIN_API_KEY,
};

describe('publishToBlog', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(tmpdir(), 'promobot-blog-publisher-'));
    process.env.BLOG_PUBLISH_DRIVER = 'file';
    process.env.BLOG_PUBLISH_OUTPUT_DIR = outputDir;
    delete process.env.BLOG_WORDPRESS_SITE_URL;
    delete process.env.BLOG_WORDPRESS_USERNAME;
    delete process.env.BLOG_WORDPRESS_APP_PASSWORD;
    delete process.env.BLOG_GHOST_ADMIN_URL;
    delete process.env.BLOG_GHOST_ADMIN_API_KEY;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T10:11:12.000Z'));
  });

  afterEach(() => {
    process.env.BLOG_PUBLISH_DRIVER = originalEnv.BLOG_PUBLISH_DRIVER;
    process.env.BLOG_PUBLISH_OUTPUT_DIR = originalEnv.BLOG_PUBLISH_OUTPUT_DIR;
    process.env.BLOG_WORDPRESS_SITE_URL = originalEnv.BLOG_WORDPRESS_SITE_URL;
    process.env.BLOG_WORDPRESS_USERNAME = originalEnv.BLOG_WORDPRESS_USERNAME;
    process.env.BLOG_WORDPRESS_APP_PASSWORD = originalEnv.BLOG_WORDPRESS_APP_PASSWORD;
    process.env.BLOG_GHOST_ADMIN_URL = originalEnv.BLOG_GHOST_ADMIN_URL;
    process.env.BLOG_GHOST_ADMIN_API_KEY = originalEnv.BLOG_GHOST_ADMIN_API_KEY;
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
        provider: 'file',
        target: 'blog-main',
        outputPath,
      },
    });
  });

  it('publishes blog drafts to wordpress when cms credentials are configured', async () => {
    process.env.BLOG_PUBLISH_DRIVER = 'wordpress';
    process.env.BLOG_WORDPRESS_SITE_URL = 'https://cms.example.com/';
    process.env.BLOG_WORDPRESS_USERNAME = 'editor';
    process.env.BLOG_WORDPRESS_APP_PASSWORD = 'app-password';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 83,
          link: 'https://cms.example.com/launch-post/',
          status: 'publish',
          slug: 'launch-post',
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToBlog({
      draftId: 18,
      title: 'Launch post',
      content: '<p>WordPress body</p>',
      target: 'blog-main',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cms.example.com/wp-json/wp/v2/posts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from('editor:app-password').toString('base64')}`,
        }),
        body: JSON.stringify({
          title: 'Launch post',
          content: '<p>WordPress body</p>',
          status: 'publish',
        }),
      }),
    );
    expect(result).toEqual({
      platform: 'blog',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://cms.example.com/launch-post/',
      externalId: '83',
      message: 'blog wordpress published draft 18',
      publishedAt: '2026-04-21T10:11:12.000Z',
      details: {
        provider: 'wordpress',
        target: 'blog-main',
        siteUrl: 'https://cms.example.com',
        remoteStatus: 'publish',
        slug: 'launch-post',
        retry: {
          publish: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'publish',
            lastHttpStatus: 201,
          },
        },
      },
    });
  });

  it('publishes blog drafts to ghost when admin api credentials are configured', async () => {
    process.env.BLOG_PUBLISH_DRIVER = 'ghost';
    process.env.BLOG_GHOST_ADMIN_URL = 'https://ghost.example.com';
    process.env.BLOG_GHOST_ADMIN_API_KEY =
      '1234567890abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          posts: [
            {
              id: 'post-42',
              url: 'https://ghost.example.com/launch-post/',
              status: 'published',
              slug: 'launch-post',
            },
          ],
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToBlog({
      draftId: 22,
      title: 'Launch post',
      content: '<p>Ghost body</p>',
      target: 'ghost-main',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ghost.example.com/ghost/api/admin/posts/?source=html',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: expect.stringMatching(/^Ghost /),
        }),
        body: JSON.stringify({
          posts: [
            {
              title: 'Launch post',
              html: '<p>Ghost body</p>',
              status: 'published',
            },
          ],
        }),
      }),
    );
    expect(result).toEqual({
      platform: 'blog',
      mode: 'api',
      status: 'published',
      success: true,
      publishUrl: 'https://ghost.example.com/launch-post/',
      externalId: 'post-42',
      message: 'blog ghost published draft 22',
      publishedAt: '2026-04-21T10:11:12.000Z',
      details: {
        provider: 'ghost',
        target: 'ghost-main',
        adminUrl: 'https://ghost.example.com/ghost',
        remoteStatus: 'published',
        slug: 'launch-post',
        retry: {
          publish: {
            attempts: 1,
            maxAttempts: 3,
            stage: 'publish',
            lastHttpStatus: 201,
          },
        },
      },
    });
  });

  it('returns a failed contract when wordpress driver is selected without full credentials', async () => {
    process.env.BLOG_PUBLISH_DRIVER = 'wordpress';
    process.env.BLOG_WORDPRESS_SITE_URL = 'https://cms.example.com';

    const result = await publishToBlog({
      draftId: 25,
      title: 'Needs creds',
      content: 'WordPress credentials missing',
    });

    expect(result).toEqual({
      platform: 'blog',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message:
        'missing wordpress blog credentials: configure BLOG_WORDPRESS_SITE_URL, BLOG_WORDPRESS_USERNAME, and BLOG_WORDPRESS_APP_PASSWORD',
      publishedAt: null,
      details: {
        provider: 'wordpress',
        retry: {
          publish: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'publish',
          },
        },
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
        },
      },
    });
  });

  it('returns a failed contract when ghost driver is selected with an invalid admin api key', async () => {
    process.env.BLOG_PUBLISH_DRIVER = 'ghost';
    process.env.BLOG_GHOST_ADMIN_URL = 'https://ghost.example.com';
    process.env.BLOG_GHOST_ADMIN_API_KEY = 'invalid-key';

    const result = await publishToBlog({
      draftId: 26,
      title: 'Needs ghost creds',
      content: 'Ghost credentials invalid',
    });

    expect(result).toEqual({
      platform: 'blog',
      mode: 'api',
      status: 'failed',
      success: false,
      publishUrl: null,
      externalId: null,
      message: 'ghost admin api key is invalid',
      publishedAt: null,
      details: {
        provider: 'ghost',
        adminUrl: 'https://ghost.example.com/ghost',
        retry: {
          publish: {
            attempts: 0,
            maxAttempts: 0,
            stage: 'publish',
          },
        },
        error: {
          category: 'auth',
          retriable: false,
          stage: 'publish',
          bodySnippet: 'ghost admin api key must be formatted as <id>:<secret>',
        },
      },
    });
  });
});
