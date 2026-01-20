import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
  LanguageModelV1FunctionTool,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import {
  createJsonResponseHandler,
  createEventSourceResponseHandler,
  postJsonToApi,
  generateId,
  type ParseResult,
} from '@ai-sdk/provider-utils';
import type { ApertisChatSettings } from './apertis-chat-settings';
import { apertisFailedResponseHandler } from './apertis-error';
import { openAIChatResponseSchema, openAIChatChunkSchema, type OpenAIChatChunk } from './schemas/chat-response';
import {
  convertToOpenAIMessages,
  convertToOpenAITools,
  convertToOpenAIToolChoice,
  mapApertisFinishReason,
} from './utils';

export interface ApertisChatConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: typeof fetch;
}

export class ApertisChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1';
  readonly defaultObjectGenerationMode = 'json';
  readonly supportsImageUrls = true;

  constructor(
    readonly modelId: string,
    private readonly settings: ApertisChatSettings,
    private readonly config: ApertisChatConfig
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  get supportsStructuredOutputs(): boolean {
    return true;
  }

  async doGenerate(
    options: LanguageModelV1CallOptions
  ): Promise<{
    text?: string;
    toolCalls?: Array<{
      toolCallType: 'function';
      toolCallId: string;
      toolName: string;
      args: string;
    }>;
    finishReason: LanguageModelV1FinishReason;
    usage: { promptTokens: number; completionTokens: number };
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
    warnings?: LanguageModelV1CallWarning[];
  }> {
    const body = this.buildRequestBody(options, false);

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: this.config.headers(),
      body,
      failedResponseHandler: apertisFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(openAIChatResponseSchema),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    const choice = response.choices[0];

    return {
      text: choice.message.content ?? undefined,
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        toolCallType: 'function' as const,
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: tc.function.arguments,
      })),
      finishReason: mapApertisFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
      rawCall: { rawPrompt: options.prompt, rawSettings: body },
    };
  }

  async doStream(
    options: LanguageModelV1CallOptions
  ): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
    warnings?: LanguageModelV1CallWarning[];
  }> {
    const body = this.buildRequestBody(options, true);

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: this.config.headers(),
      body,
      failedResponseHandler: apertisFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(openAIChatChunkSchema),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();

    const transformStream = new TransformStream<
      ParseResult<OpenAIChatChunk>,
      LanguageModelV1StreamPart
    >({
      transform(parseResult, controller) {
        // Skip failed parse results
        if (!parseResult.success) {
          return;
        }

        const chunk = parseResult.value;
        const choice = chunk.choices[0];

        if (!choice) return;

        // Handle text delta
        if (choice.delta.content) {
          controller.enqueue({ type: 'text-delta', textDelta: choice.delta.content });
        }

        // Handle tool calls
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            let buffer = toolCallBuffers.get(tc.index);

            if (!buffer) {
              buffer = { id: tc.id ?? generateId(), name: '', arguments: '' };
              toolCallBuffers.set(tc.index, buffer);
            }

            if (tc.id) buffer.id = tc.id;
            if (tc.function?.name) buffer.name += tc.function.name;
            if (tc.function?.arguments) buffer.arguments += tc.function.arguments;
          }
        }

        // Handle finish
        if (choice.finish_reason) {
          // Emit completed tool calls
          for (const [, buffer] of toolCallBuffers) {
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: buffer.id,
              toolName: buffer.name,
              args: buffer.arguments,
            });
          }

          controller.enqueue({
            type: 'finish',
            finishReason: mapApertisFinishReason(choice.finish_reason),
            usage: {
              promptTokens: chunk.usage?.prompt_tokens ?? 0,
              completionTokens: chunk.usage?.completion_tokens ?? 0,
            },
          });
        }
      },
    });

    return {
      stream: response.pipeThrough(transformStream),
      rawCall: { rawPrompt: options.prompt, rawSettings: body },
    };
  }

  private buildRequestBody(options: LanguageModelV1CallOptions, stream: boolean) {
    // Extract tools and toolChoice from mode if available
    const tools = options.mode.type === 'regular'
      ? this.filterFunctionTools(options.mode.tools)
      : undefined;
    const toolChoice = options.mode.type === 'regular'
      ? options.mode.toolChoice
      : undefined;

    // Determine response format based on mode
    const responseFormat = options.mode.type === 'object-json'
      ? { type: 'json_object' as const }
      : undefined;

    return {
      model: this.modelId,
      messages: convertToOpenAIMessages(options.prompt),
      stream,
      stream_options: stream ? { include_usage: true } : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stop: options.stopSequences,
      seed: options.seed,
      tools: convertToOpenAITools(tools),
      tool_choice: convertToOpenAIToolChoice(toolChoice),
      response_format: responseFormat,
      user: this.settings.user,
      logprobs: this.settings.logprobs,
      top_logprobs: this.settings.topLogprobs,
    };
  }

  private filterFunctionTools(
    tools: Array<LanguageModelV1FunctionTool | { type: string }> | undefined
  ): LanguageModelV1FunctionTool[] | undefined {
    if (!tools) return undefined;
    return tools.filter(
      (tool): tool is LanguageModelV1FunctionTool => tool.type === 'function'
    );
  }
}
