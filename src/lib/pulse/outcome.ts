/**
 * A job that did part of its work did not succeed.
 *
 * The refresh jobs settle every league independently, which is right: one
 * dead source must not stop the others. But a job that then returns "0 of 3
 * leagues rebuilt" as its detail has reported a failure as a success, the
 * tier is recorded as done, and the retry waits an hour. This turns a partial
 * result into the error it is, with the names in it.
 */
export function partialFailure(what: string, total: number, failed: string[]): string | null {
  if (failed.length === 0) return null;
  return `${total - failed.length} of ${total} ${what}. Failed: ${failed.join("; ")}`;
}
