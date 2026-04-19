export interface ChatOptions {
  model?: string;
  json?: boolean;
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export async function chat(
  systemPrompt: string,
  userPrompt: string,
  options: ChatOptions = {},
): Promise<string> {
  const baseUrl = process.env.AI_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = options.model ?? process.env.AI_MODEL ?? 'gpt-4o-mini';

  if (!baseUrl || !apiKey) {
    throw new Error('AI client not configured');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: options.json ? { type: 'json_object' } : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
