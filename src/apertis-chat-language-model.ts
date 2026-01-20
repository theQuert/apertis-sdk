import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1FinishReason,
  LanguageModelV1FunctionTool,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import {
  type ParseResult,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import type { ApertisChatSettings } from "./apertis-chat-settings";
import { apertisFailedResponseHandler } from "./apertis-error";
import {
  type OpenAIChatChunk,
  openAIChatChunkSchema,
  openAIChatResponseSchema,
} from "./schemas/chat-response";
import {
  convertToOpenAIMessages,
  convertToOpenAIToolChoice,
  convertToOpenAITools,
  mapApertisFinishReason,
} from "./utils";

export interface ApertisChatConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: typeof fetch;
}

export class ApertisChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1";
  readonly defaultObjectGenerationMode = "json";
  readonly supportsImageUrls = true;

  constructor(
    readonly modelId: string,
    private readonly settings: ApertisChatSettings,
    private readonly config: ApertisChatConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  get supportsStructuredOutputs(): boolean {
    return true;
  }

  async doGenerate(options: LanguageModelV1CallOptions): Promise<{
    text?: string;
    toolCalls?: Array<{
      toolCallType: "function";
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
      successfulResponseHandler: createJsonResponseHandler(
        openAIChatResponseSchema,
      ),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    const choice = response.choices[0];

    return {
      text: choice.message.content ?? undefined,
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        toolCallType: "function" as const,
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

  async doStream(options: LanguageModelV1CallOptions): Promise<{
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
      successfulResponseHandler: createEventSourceResponseHandler(
        openAIChatChunkSchema,
      ),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    const toolCallBuffers: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();

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
          controller.enqueue({
            type: "text-delta",
            textDelta: choice.delta.content,
          });
        }

        // Handle tool calls
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            let buffer = toolCallBuffers.get(tc.index);

            if (!buffer) {
              buffer = { id: tc.id ?? generateId(), name: "", arguments: "" };
              toolCallBuffers.set(tc.index, buffer);
            }

            if (tc.id) buffer.id = tc.id;
            if (tc.function?.name) buffer.name += tc.function.name;
            if (tc.function?.arguments)
              buffer.arguments += tc.function.arguments;
          }
        }

        // Handle finish
        if (choice.finish_reason) {
          // Emit completed tool calls (only those with valid names)
          for (const [, buffer] of toolCallBuffers) {
            if (buffer.name) {
              controller.enqueue({
                type: "tool-call",
                toolCallType: "function",
                toolCallId: buffer.id,
                toolName: buffer.name,
                args: buffer.arguments,
              });
            }
          }
          // Clear buffers after emitting
          toolCallBuffers.clear();

          controller.enqueue({
            type: "finish",
            finishReason: mapApertisFinishReason(choice.finish_reason),
            usage: {
              promptTokens: chunk.usage?.prompt_tokens ?? 0,
              completionTokens: chunk.usage?.completion_tokens ?? 0,
            },
          });
        }
      },
      flush(controller) {
        // Emit any remaining buffered tool calls when stream closes early
        for (const [, buffer] of toolCallBuffers) {
          if (buffer.name) {
            controller.enqueue({
              type: "tool-call",
              toolCallType: "function",
              toolCallId: buffer.id,
              toolName: buffer.name,
              args: buffer.arguments,
            });
          }
        }
      },
    });

    return {
      stream: response.pipeThrough(transformStream),
      rawCall: { rawPrompt: options.prompt, rawSettings: body },
    };
  }

  private buildRequestBody(
    options: LanguageModelV1CallOptions,
    stream: boolean,
  ) {
    // Extract tools and toolChoice from mode if available
    const tools =
      options.mode.type === "regular"
        ? this.filterFunctionTools(options.mode.tools)
        : undefined;
    const toolChoice =
      options.mode.type === "regular" ? options.mode.toolChoice : undefined;

    // Determine response format based on mode
    const responseFormat =
      options.mode.type === "object-json"
        ? { type: "json_object" as const }
        : undefined;

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: convertToOpenAIMessages(options.prompt),
      stream,
    };

    // Only add defined optional fields to avoid sending undefined to API
    if (stream) body.stream_options = { include_usage: true };
    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.topP !== undefined) body.top_p = options.topP;
    if (options.frequencyPenalty !== undefined)
      body.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined)
      body.presence_penalty = options.presencePenalty;
    if (options.stopSequences !== undefined) body.stop = options.stopSequences;
    if (options.seed !== undefined) body.seed = options.seed;

    const convertedTools = convertToOpenAITools(tools);
    if (convertedTools !== undefined) body.tools = convertedTools;

    const convertedToolChoice = convertToOpenAIToolChoice(toolChoice);
    if (convertedToolChoice !== undefined)
      body.tool_choice = convertedToolChoice;

    if (responseFormat !== undefined) body.response_format = responseFormat;
    if (this.settings.user !== undefined) body.user = this.settings.user;
    if (this.settings.logprobs !== undefined)
      body.logprobs = this.settings.logprobs;
    if (this.settings.topLogprobs !== undefined)
      body.top_logprobs = this.settings.topLogprobs;

    return body;
  }

  private filterFunctionTools(
    tools: Array<LanguageModelV1FunctionTool | { type: string }> | undefined,
  ): LanguageModelV1FunctionTool[] | undefined {
    if (!tools) return undefined;
    return tools.filter(
      (tool): tool is LanguageModelV1FunctionTool => tool.type === "function",
    );
  }
}
