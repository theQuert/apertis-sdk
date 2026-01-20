import type { LanguageModelV1Prompt } from '@ai-sdk/provider';

export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export function convertToOpenAIMessages(prompt: LanguageModelV1Prompt): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        messages.push({ role: 'system', content: message.content });
        break;

      case 'user':
        messages.push({
          role: 'user',
          content: message.content.map((part): OpenAIContentPart => {
            switch (part.type) {
              case 'text':
                return { type: 'text', text: part.text };
              case 'image':
                return {
                  type: 'image_url',
                  image_url: {
                    url:
                      part.image instanceof URL
                        ? part.image.toString()
                        : `data:${part.mimeType ?? 'image/png'};base64,${Buffer.from(part.image).toString('base64')}`,
                  },
                };
              default:
                throw new Error(`Unsupported user content part type: ${(part as { type: string }).type}`);
            }
          }),
        });
        break;

      case 'assistant': {
        const textContent = message.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('');

        const toolCalls = message.content
          .filter((p): p is { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown } => p.type === 'tool-call')
          .map((tc) => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
          }));

        messages.push({
          role: 'assistant',
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        break;
      }

      case 'tool':
        for (const result of message.content) {
          messages.push({
            role: 'tool',
            tool_call_id: result.toolCallId,
            content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
          });
        }
        break;
    }
  }

  return messages;
}
