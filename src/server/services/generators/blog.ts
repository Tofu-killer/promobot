import type { GenerateDraftInput, GeneratedDraft } from './types';
import { generatePlatformDraft } from './shared';

export async function generateBlogDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'blog',
    input,
    'Write an English long-form blog draft with a structured, SEO-friendly outline.',
  );
}
