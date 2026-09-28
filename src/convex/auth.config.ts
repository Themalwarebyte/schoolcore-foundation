import type { AuthConfig } from "convex/server";
import { freebuffProviders } from "./auth/freebuff";

// SchoolCore's own sign-in provider.
//
// The deployment self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header),
// validated via OIDC discovery at `${domain}/.well-known/openid-configuration`,
// served by auth.addHttpRoutes() in convex/http.ts.
//
// Do NOT convert this entry to `type: "customJwt"` — that path rejects tokens
// without a `kid` header, so sign-in would silently never confirm and
// RequireAuth would loop back to /auth forever.
//
// CONVEX_SITE_URL is provided by the platform on Convex Cloud and is set
// explicitly on the self-hosted deployment to the public site origin
// (e.g. https://schoolcore-site.ooflowdesk.com).
//
// The optional Freebuff federated provider lives in ./auth/freebuff so that
// its environment variable is not statically required by this file.
const providers: NonNullable<AuthConfig["providers"]> = [
  {
    domain: process.env.CONVEX_SITE_URL!,
    applicationID: "convex",
  },
];

const freebuff = freebuffProviders();
if (freebuff) {
  providers.push(...freebuff);
}

export default {
  providers,
} satisfies AuthConfig;
