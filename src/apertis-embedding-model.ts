import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
} from "@ai-sdk/provider";
import {
  createJsonResponseHandler,
  postJsonToApi,
} from "@ai-sdk/provider-utils";
import type {
  ApertisEmbeddingModelId,
  ApertisEmbeddingSettings,
} from "./apertis-embedding-settings";
import { apertisFailedResponseHandler } from "./apertis-error";
import { openAIEmbeddingResponseSchema } from "./schemas/embedding-response";

export interface ApertisEmbeddingConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: typeof fetch;
}

export class ApertisEmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = "v3" as const;

  readonly maxEmbeddingsPerCall: number;
  readonly supportsParallelCalls: boolean;

  constructor(
    readonly modelId: ApertisEmbeddingModelId,
    private readonly settings: ApertisEmbeddingSettings,
    private readonly config: ApertisEmbeddingConfig,
  ) {
    this.maxEmbeddingsPerCall = settings.maxEmbeddingsPerCall ?? 2048;
    this.supportsParallelCalls = settings.supportsParallelCalls ?? true;
  }

  get provider(): string {
    return this.config.provider;
  }

  async doEmbed(
    options: EmbeddingModelV3CallOptions,
  ): Promise<EmbeddingModelV3Result> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      input: options.values,
      encoding_format: "float",
    };

    // Add optional parameters
    if (this.settings.dimensions !== undefined) {
      body.dimensions = this.settings.dimensions;
    }
    if (this.settings.user !== undefined) {
      body.user = this.settings.user;
    }

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/embeddings`,
      headers: this.config.headers(),
      body,
      failedResponseHandler: apertisFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        openAIEmbeddingResponseSchema,
      ),
      fetch: this.config.fetch,
      abortSignal: options.abortSignal,
    });

    return {
      embeddings: response.data.map((item) => item.embedding),
      usage: response.usage
        ? { tokens: response.usage.prompt_tokens }
        : undefined,
      warnings: [],
    };
  }
}
