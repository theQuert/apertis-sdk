import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import {
  type ParseResult,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import type {
  ApertisCompletionModelId,
  ApertisCompletionSettings,
} from "./apertis-completion-settings";
import { apertisFailedResponseHandler } from "./apertis-error";
import {
  type OpenAICompletionChunk,
  openAICompletionChunkSchema,
  openAICompletionResponseSchema,
} from "./schemas/completion-response";

export interface ApertisCompletionConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: typeof fetch;
}

export class ApertisCompletionLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;

  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    readonly modelId: ApertisCompletionModelId,
    private readonly settings: ApertisCompletionSettings,
    private readonly config: ApertisCompletionConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const body = this.buildRequestBody(options, false);

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/completions`,
      headers: this.config.headers(),
      body,
      failedResponseHandler: apertisFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        openAICompletionResponseSchema,
      ),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    const choice = response.choices[0];

    const content: LanguageModelV3Content[] = [];

    if (choice.text) {
      content.push({
        type: "text",
        text: choice.text,
      });
    }

    return {
      content,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        inputTokens: {
          total: response.usage?.prompt_tokens ?? 0,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: response.usage?.completion_tokens ?? 0,
          text: undefined,
          reasoning: undefined,
        },
      },
      warnings: [],
      request: { body },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const body = this.buildRequestBody(options, true);

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/completions`,
      headers: this.config.headers(),
      body,
      failedResponseHandler: apertisFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        openAICompletionChunkSchema,
      ),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    let textId: string | null = null;

    const transformStream = new TransformStream<
      ParseResult<OpenAICompletionChunk>,
      LanguageModelV3StreamPart
    >({
      transform(parseResult, controller) {
        if (!parseResult.success) {
          return;
        }

        const chunk = parseResult.value;
        const choice = chunk.choices[0];

        if (!choice) return;

        if (choice.text) {
          if (!textId) {
            textId = generateId();
            controller.enqueue({
              type: "text-start",
              id: textId,
            });
          }
          controller.enqueue({
            type: "text-delta",
            id: textId,
            delta: choice.text,
          });
        }

        if (choice.finish_reason) {
          if (textId) {
            controller.enqueue({
              type: "text-end",
              id: textId,
            });
          }

          controller.enqueue({
            type: "finish",
            finishReason: {
              unified:
                choice.finish_reason === "stop"
                  ? "stop"
                  : choice.finish_reason === "length"
                    ? "length"
                    : "other",
              raw: choice.finish_reason ?? undefined,
            },
            usage: {
              inputTokens: {
                total: chunk.usage?.prompt_tokens ?? 0,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: chunk.usage?.completion_tokens ?? 0,
                text: undefined,
                reasoning: undefined,
              },
            },
          });
        }
      },
      flush(controller) {
        if (textId) {
          controller.enqueue({
            type: "text-end",
            id: textId,
          });
        }
      },
    });

    return {
      stream: response.pipeThrough(transformStream),
      request: { body },
    };
  }

  private buildRequestBody(
    options: LanguageModelV3CallOptions,
    stream: boolean,
  ) {
    const prompt = this.convertPromptToText(options.prompt);

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      stream,
    };

    if (stream) body.stream_options = { include_usage: true };
    if (options.maxOutputTokens !== undefined)
      body.max_tokens = options.maxOutputTokens;
    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;
    if (options.frequencyPenalty !== undefined)
      body.frequency_penalty = options.frequencyPenalty;
    if (options.presencePenalty !== undefined)
      body.presence_penalty = options.presencePenalty;
    if (options.stopSequences !== undefined) body.stop = options.stopSequences;
    if (options.seed !== undefined) body.seed = options.seed;

    // Completion-specific settings
    if (this.settings.echo !== undefined) body.echo = this.settings.echo;
    if (this.settings.logprobs !== undefined)
      body.logprobs = this.settings.logprobs;
    if (this.settings.suffix !== undefined) body.suffix = this.settings.suffix;
    if (this.settings.user !== undefined) body.user = this.settings.user;

    return body;
  }

  private convertPromptToText(
    prompt: LanguageModelV3CallOptions["prompt"],
  ): string {
    const parts: string[] = [];

    for (const message of prompt) {
      if (message.role === "system") {
        parts.push(message.content);
      } else if (message.role === "user") {
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push(part.text);
          }
        }
      } else if (message.role === "assistant") {
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push(part.text);
          }
        }
      }
    }

    return parts.join("\n\n");
  }

  private mapFinishReason(
    finishReason: string | null | undefined,
  ): LanguageModelV3FinishReason {
    const raw = finishReason ?? undefined;

    switch (finishReason) {
      case "stop":
        return { unified: "stop", raw };
      case "length":
        return { unified: "length", raw };
      default:
        return { unified: "other", raw };
    }
  }
}
