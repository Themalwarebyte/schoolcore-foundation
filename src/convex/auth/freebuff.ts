import type { AuthConfig } from "convex/server";

/**
 * Optional Freebuff federated sign-in provider.
 *
 * IMPORTANT — why this is a separate module:
 *
 * The Convex Auth CLI performs a static scan of the auth config file for
 * `process.env.*` references and FAILS `convex dev` if a referenced variable
 * is not set in the target deployment. Referencing an optional variable
 * directly inside `auth.config.ts` therefore makes that variable effectively
 * mandatory, which would break the self-hosted deployment (where Freebuff is
 * not configured).
 *
 * Keeping the reference in this module means the optional variable is read at
 * module-evaluation time only, and is simply absent on self-host. The provider
 * is then not registered at all, so self-hosted SchoolCore has no Freebuff
 * issuer, no freebuff.com dependency and no Freebuff JWKS endpoint.
 *
 * Transitional: remove this module and its call site after production cutover.
 */

/**
 * Returns the Freebuff customJwt provider when — and only when — a Freebuff
 * issuer is explicitly configured. Returns undefined otherwise.
 */
/**
 * Returns the Freebuff customJwt provider when — and only when — a Freebuff
 * issuer is explicitly configured. Returns undefined otherwise.
 *
 * DEPLOYMENT REQUIREMENT (verified with Convex CLI 1.46.0):
 * The CLI's auth-config check requires EVERY environment variable referenced
 * anywhere in the auth config import graph to be *set* in the deployment, even
 * when the code guards for absence. This was confirmed to be transitive (moving
 * the reference to a separate module did not help).
 *
 * Therefore the self-hosted deployment must have this variable DEFINED but
 * EMPTY:
 *     npx convex env set VLY_CONVEX_AUTH_ISSUER ""
 * That satisfies the CLI while the empty value keeps the provider unregistered.
 * The Convex Cloud deployment sets it to the real issuer and keeps federated
 * sign-in working.
 */
export function freebuffProviders(): NonNullable<AuthConfig["providers"]> | undefined {
  const issuer = process.env.VLY_CONVEX_AUTH_ISSUER?.trim();
  if (!issuer) return undefined;

  // `customJwt` is correct for this provider: Freebuff's tokens and JWKS both
  // carry a `kid` header, which the customJwt validation path requires.
  return [
    {
      type: "customJwt",
      issuer,
      jwks: `${issuer}/api/web/.well-known/jwks.json`,
      applicationID: "vly-convex",
      algorithm: "RS256",
    },
  ];
}
