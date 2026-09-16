export function isStartableIn(
  position: string | null | undefined,
  startable: ReadonlySet<string>,
): boolean {
  return startable.has((position ?? "").toUpperCase());
}
