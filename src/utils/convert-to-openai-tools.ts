import type { LanguageModelV1FunctionTool, LanguageModelV1ToolChoice } from '@ai-sdk/provider';

export type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenAIToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } };

export function convertToOpenAITools(
  tools: LanguageModelV1FunctionTool[] | undefined
): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

export function convertToOpenAIToolChoice(
  toolChoice: LanguageModelV1ToolChoice | undefined
): OpenAIToolChoice | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice.type) {
    case 'none':
      return 'none';
    case 'auto':
      return 'auto';
    case 'required':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.toolName } };
    default:
      return undefined;
  }
}
