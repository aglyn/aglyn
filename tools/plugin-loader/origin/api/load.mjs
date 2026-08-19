/**
 * Dynamic sandbox loader serving (AGL-879 follow-up).
 *
 * Serves load.html with a **per-manifest Content-Security-Policy**: the
 * `connect-src` allowlist is built from the plugin version's declared
 * `capabilities.network` (fetched from the console's public
 * listing-versions endpoint), so a sandboxed plugin's direct fetches can
 * only reach origins its manifest declared — everything else still goes
 * through host-mediated `hostFetch`, which the host re-checks server-side.
 *
 * Fails strict: any lookup problem serves the base CSP with
 * `connect-src 'self'` only. No secrets — the endpoint is public data.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LISTING_ID = /^[A-Za-z0-9_-]{1,64}$/
const VERSION = /^[A-Za-z0-9._-]{1,32}$/
const HOST_ID = /^[A-Za-z0-9_-]{1,64}$/
const NETWORK_ORIGIN = /^https:\/\/[^\s/]+$/
// Strict origin shape for CSP/HTML injection — scheme + hostname only.
const ANCESTOR_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/
// Bare hostname, at least two labels — the shape `*.<apex>` needs.
const ANCESTOR_HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Where this loader's control plane lives, and who may frame it (AGL-2196).
 *
 * Both were bare `app.aglyn.com` literals in a file with no `process.env`
 * read anywhere, which made this the one Aglyn-operated service a self-hoster
 * could not point away from. Two consequences, and the second is the sharp
 * one:
 *
 *  1. `frame-ancestors` named only Aglyn's console and `*.aglyn.app`, so an
 *     operator's own console could never frame its own plugin sandbox. Not a
 *     degraded feature — a blank iframe, blocked by the browser, with the
 *     reason only in the console log.
 *  2. The two lookups below queried Aglyn's marketplace API with the
 *     operator's own listing and host ids, on every sandbox load. That is
 *     someone else's traffic arriving at our infrastructure carrying their
 *     identifiers, and it returns 404s that silently strip every plugin's
 *     declared network capability.
 *
 * `CONSOLE_ORIGIN` and `TENANT_APEX` are read at module scope from the
 * loader's own deployment environment. Aglyn's deployment sets neither, so
 * the defaults keep our behaviour byte-identical.
 */
const CONSOLE_ORIGIN = (() => {
  const raw = String(process.env.PLUGIN_LOADER_CONSOLE_URL ?? '').trim()
  if (!raw) return 'https://app.aglyn.com'
  try {
    return new URL(raw).origin
  } catch {
    // A malformed value must not silently retarget the control plane.
    return 'https://app.aglyn.com'
  }
})()

const TENANT_APEX = (() => {
  const raw = String(process.env.PLUGIN_LOADER_TENANT_DOMAIN ?? '')
    .trim()
    .toLowerCase()
  // Must look like a hostname: a bare `*.` wildcard, or an empty label, would
  // widen `frame-ancestors` to everything.
  return ANCESTOR_HOSTNAME.test(raw) ? raw : 'aglyn.app'
})()

const BASE_FRAME_ANCESTORS = `frame-ancestors ${CONSOLE_ORIGIN} https://*.${TENANT_APEX}`

// includeFiles roots differ between builders — resolve the shipped
// load.html wherever this bundle landed, lazily and cached.
let cachedHtml = null
function loadHtml() {
  if (cachedHtml) return cachedHtml
  const candidates = [
    join(process.cwd(), 'load.html'),
    fileURLToPath(new URL('../load.html', import.meta.url)),
    fileURLToPath(new URL('./load.html', import.meta.url)),
    join(process.cwd(), 'tools/plugin-loader/origin/load.html'),
  ]
  for (const candidate of candidates) {
    try {
      cachedHtml = readFileSync(candidate, 'utf8')
      return cachedHtml
    } catch {
      // try the next location
    }
  }
  throw new Error('load.html not found in bundle')
}

/**
 * The policy this deployment actually serves (AGL-1092).
 *
 * Exported for `load.csp.test.mjs`, because for a long time the only TESTED
 * plugin CSP was a helper in libs/aglyn that nothing called and that
 * disagreed with this one — including on `connect-src`, where its `'none'`
 * would have broken every load. This is the policy; it is the one that needs
 * the coverage.
 *
 * `'self'` in connect-src is load-bearing: the frame fetches its own bundle
 * from this origin. `base-uri`/`form-action` are `'none'` so a plugin can
 * neither re-point relative URLs with a `<base>` tag nor exfiltrate through
 * a form submission — neither is reachable through connect-src.
 */
export function csp(connectExtra, ancestorExtra) {
  const connect = ["'self'", ...connectExtra].join(' ')
  const ancestors = [BASE_FRAME_ANCESTORS, ...ancestorExtra].join(' ')
  return (
    "default-src 'none'; " +
    "script-src 'unsafe-inline' blob:; " +
    `connect-src ${connect}; ` +
    "style-src 'unsafe-inline'; " +
    'img-src data: blob: https:; ' +
    "base-uri 'none'; " +
    "form-action 'none'; " +
    ancestors
  )
}

/**
 * Declared origins that may enter `connect-src`.
 *
 * The values arrive from a public HTTP endpoint, so shape is validated here
 * rather than trusted: anything but a bare `https://host` is dropped, which
 * is what keeps a rogue value from injecting a second directive. Capped so a
 * long list cannot bloat the header.
 */
export function sanitizeNetwork(list) {
  return (Array.isArray(list) ? list : [])
    .map((origin) => String(origin))
    .filter((origin) => NETWORK_ORIGIN.test(origin))
    .slice(0, 20)
}

/**
 * Extra `frame-ancestors` — a site's VERIFIED custom domain (AGL-884).
 * Lower-cased and shape-checked for the same reason, and capped at four.
 */
export function sanitizeAncestors(list) {
  return (Array.isArray(list) ? list : [])
    .map((origin) => String(origin).toLowerCase())
    .filter((origin) => ANCESTOR_ORIGIN.test(origin))
    .slice(0, 4)
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok ? await response.json() : null
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  const listingId = String(req.query?.listing ?? '')
  const version = String(req.query?.v ?? '')
  const hostId = String(req.query?.host ?? '')

  let network = []
  if (LISTING_ID.test(listingId) && VERSION.test(version)) {
    try {
      const payload = await fetchJson(
        CONSOLE_ORIGIN +
          '/api/marketplace/listing-versions?listingId=' +
          encodeURIComponent(listingId),
      )
      const entry = (payload?.versions ?? []).find(
        (candidate) => String(candidate?.version) === version,
      )
      network = sanitizeNetwork(entry?.network)
    } catch {
      // Strict fallback — the plugin still runs, just without direct
      // network; hostFetch remains available.
      network = []
    }
  }

  // Custom-domain ancestors (AGL-884): resolved server-side from the
  // framing host's VERIFIED domain — the host id names WHICH lookup to do;
  // the origin value itself never comes from the caller.
  let ancestors = []
  if (HOST_ID.test(hostId)) {
    try {
      const payload = await fetchJson(
        CONSOLE_ORIGIN +
          '/api/plugin-host-origins/' +
          encodeURIComponent(hostId),
      )
      ancestors = sanitizeAncestors(payload?.origins)
    } catch {
      ancestors = []
    }
  }

  let html
  try {
    html = loadHtml()
  } catch (error) {
    console.error('loader html missing:', error)
    return res.status(500).json({ error: 'Loader unavailable' })
  }
  // Mirror the extra ancestors into the page's own referrer check
  // (defense in depth). Values are regex-validated origins, so the
  // JSON.stringify injection is inert.
  if (ancestors.length) {
    html = html.replace(
      'const EXTRA_ANCESTORS = []',
      `const EXTRA_ANCESTORS = ${JSON.stringify(ancestors)}`,
    )
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy', csp(network, ancestors))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'origin')
  res.setHeader('Cache-Control', 'private, no-store')
  return res.status(200).send(html)
}
