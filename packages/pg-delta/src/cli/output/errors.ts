import { Data } from "effect";

export class NonInteractiveError extends Data.TaggedError(
  "NonInteractiveError",
)<{
  readonly detail: string;
  readonly suggestion?: string;
}> {}
