/**
 * TEMPORARY preload for final verification (safe to delete).
 * Maps VITE_CONVEX_URL → SMOKE_CONVEX_URL without echoing any value.
 */
process.env.SMOKE_CONVEX_URL ||= process.env.VITE_CONVEX_URL || "";
