/**
 * Convert backend failures into user-friendly toast text.
 *
 * Convex surfaces thrown errors as "Uncaught ConvexError: <message>" strings
 * that include request IDs and stack frames. Those are fine in server logs,
 * but raw in a toast: use this helper wherever a mutation/action error is
 * surfaced to the user so they see the readable business message instead
 * ("Unable to complete this action…").
 */
export function friendlyError(err: unknown, fallback = "Unable to complete this action. Please check your information and try again."): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/Uncaught ConvexError: (.+?)(?:\n|$)/s);
  const core = (m ? m[1] : raw)
    .replace(/^\[Request ID: [^\]]+\]\s*/, "")
    .replace(/\s+at .*/g, "")
    .trim();
  return core.length > 0 ? core.slice(0, 180) : fallback;
}
