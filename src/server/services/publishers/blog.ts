import fs from 'node:fs';
import path from 'node:path';

import type { PublishRequest, PublishResult, Publisher } from './types.js';

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'data/blog-posts');

export const publishToBlog: Publisher = async (
  request: PublishRequest,
): Promise<PublishResult> => {
  const publishedAt = new Date().toISOString();
  const draftId = String(request.draftId);
  const slug = buildSlug(draftId, request.title);
  const outputDir = resolveOutputDir();
  const outputPath = path.join(outputDir, `${slug}.md`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, buildMarkdownDocument(request, publishedAt), 'utf8');

  return {
    platform: 'blog',
    mode: 'api',
    status: 'published',
    success: true,
    publishUrl: `file://${outputPath}`,
    externalId: slug,
    message: `blog publisher wrote draft ${draftId} to ${outputPath}`,
    publishedAt,
    details: {
      ...(request.target ? { target: request.target } : {}),
      outputPath,
    },
  };
};

function resolveOutputDir() {
  const configured = process.env.BLOG_PUBLISH_OUTPUT_DIR?.trim();
  return configured ? path.resolve(configured) : DEFAULT_OUTPUT_DIR;
}

function buildSlug(draftId: string, title?: string) {
  const titleSlug = (title ?? 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return `blog-${draftId}-${titleSlug || 'untitled'}`;
}

function buildMarkdownDocument(request: PublishRequest, publishedAt: string) {
  const lines = [
    '---',
    `draftId: "${String(request.draftId)}"`,
    `title: "${escapeYamlString(request.title ?? 'Untitled')}"`,
  ];

  if (request.target) {
    lines.push(`target: "${escapeYamlString(request.target)}"`);
  }

  lines.push(`publishedAt: "${publishedAt}"`);
  lines.push('---', '', request.content, '');

  return lines.join('\n');
}

function escapeYamlString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
