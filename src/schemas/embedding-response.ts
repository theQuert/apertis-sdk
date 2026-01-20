import { z } from "zod";

export const openAIEmbeddingResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(
    z.object({
      object: z.literal("embedding"),
      embedding: z.array(z.number()),
      index: z.number(),
    }),
  ),
  model: z.string(),
  usage: z
    .object({
      prompt_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export type OpenAIEmbeddingResponse = z.infer<
  typeof openAIEmbeddingResponseSchema
>;
