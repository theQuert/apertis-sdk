import { z } from "zod";

export const openAICompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("text_completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      text: z.string(),
      index: z.number(),
      logprobs: z
        .object({
          tokens: z.array(z.string()).optional(),
          token_logprobs: z.array(z.number()).optional(),
          top_logprobs: z.array(z.record(z.number())).optional(),
          text_offset: z.array(z.number()).optional(),
        })
        .nullable()
        .optional(),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export type OpenAICompletionResponse = z.infer<
  typeof openAICompletionResponseSchema
>;

// Streaming chunk schema
export const openAICompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("text_completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      text: z.string(),
      index: z.number(),
      logprobs: z
        .object({
          tokens: z.array(z.string()).optional(),
          token_logprobs: z.array(z.number()).optional(),
          top_logprobs: z.array(z.record(z.number())).optional(),
          text_offset: z.array(z.number()).optional(),
        })
        .nullable()
        .optional(),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional()
    .nullable(),
});

export type OpenAICompletionChunk = z.infer<typeof openAICompletionChunkSchema>;
