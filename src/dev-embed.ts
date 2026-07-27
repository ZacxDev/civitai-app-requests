// Dev-server embeddability for `civitai app dev-tunnel`.
//
// `dev:tunnel` serves THIS local dev server, through a hardened reverse tunnel,
// as a `dev-<16hex>.civit.ai` host that the REAL production parent
// (https://civitai.com/apps/dev/<blockId>) iframes. For that embed to work the
// dev server must be framable BY civitai.com and the block bundle must ACCEPT
// postMessages from the civitai.com parent origin.
//
// This is the single source of truth for both, imported by vite.config.ts. It
// is DEV-ONLY: vite `server.*` options apply only to `vite dev`, never to
// `vite build`, so the PRODUCTION bundle's framing is untouched (its allowlist
// still comes from .env.production).

/** The production parent origin that embeds the dev tunnel. */
export const PROD_PARENT_ORIGIN = 'https://civitai.com';

/** The dev host suffix the tunnel serves the child on (`dev-<16hex>.civit.ai`). */
export const DEV_TUNNEL_HOST_SUFFIX = '.civit.ai';

/**
 * Hosts the dev server accepts (Vite `server.allowedHosts`). `localhost` covers
 * the normal harness; the `.civit.ai` suffix admits the tunneled host.
 */
export const DEV_ALLOWED_HOSTS: string[] = ['localhost', DEV_TUNNEL_HOST_SUFFIX];

/**
 * Response headers that make the dev server iframe-embeddable from the prod
 * parent. Both DEV-ONLY:
 *  1. `frame-ancestors` CSP scoped to civitai.com (+ self) so civitai.com may
 *     EMBED the dev server. We DO NOT set `X-Frame-Options` (which would block
 *     the cross-origin embed regardless of the CSP).
 *  2. `Access-Control-Allow-Origin: *` so the ES modules load from the
 *     NULL-origin sandboxed PageBlockHost iframe (matches how PRODUCTION
 *     app-blocks are served). Safe: the dev server is reachable only through the
 *     authenticated dev-tunnel gate; module-script fetches are non-credentialed.
 */
export function devServerSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': `frame-ancestors 'self' ${PROD_PARENT_ORIGIN}`,
    'Access-Control-Allow-Origin': '*',
  };
}

/**
 * The dev parent-origin allowlist baked into the block bundle for the SDK's
 * IframeTransport (`VITE_BLOCK_ALLOWED_PARENT_ORIGINS`). Merges whatever the dev
 * env already declares with the prod parent so the SAME dev build works BOTH in
 * the local harness AND embedded by the real civitai.com host over the tunnel.
 */
export function devAllowedParentOrigins(envValue: string | undefined): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...fromEnv];
  if (!merged.includes(PROD_PARENT_ORIGIN)) merged.push(PROD_PARENT_ORIGIN);
  return merged;
}
