export interface ApertisCompletionSettings {
  /**
   * Echo back the prompt in addition to the completion.
   */
  echo?: boolean;

  /**
   * Include the log probabilities on the logprobs most likely tokens.
   */
  logprobs?: number;

  /**
   * The suffix that comes after a completion of inserted text.
   */
  suffix?: string;

  /**
   * A unique identifier representing your end-user.
   */
  user?: string;
}

export type ApertisCompletionModelId =
  | "gpt-3.5-turbo-instruct"
  | "davinci-002"
  | "babbage-002"
  | (string & {});
