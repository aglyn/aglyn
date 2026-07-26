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
const NETWORK_ORIGIN = /^https:\/\/[^\s/]+$/

const BASE_FRAME_ANCESTORS =
  'frame-ancestors https://app.aglyn.com https://*.aglyn.app'

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

function csp(connectExtra) {
  const connect = ["'self'", ...connectExtra].join(' ')
  return (
    "default-src 'none'; " +
    "script-src 'unsafe-inline' blob:; " +
    `connect-src ${connect}; ` +
    "style-src 'unsafe-inline'; " +
    'img-src data: blob: https:; ' +
    BASE_FRAME_ANCESTORS
  )
}

export default async function handler(req, res) {
  const listingId = String(req.query?.listing ?? '')
  const version = String(req.query?.v ?? '')

  let network = []
  if (LISTING_ID.test(listingId) && VERSION.test(version)) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(
        'https://app.aglyn.com/api/community/listing-versions?listingId=' +
          encodeURIComponent(listingId),
        { signal: controller.signal },
      )
      clearTimeout(timer)
      if (response.ok) {
        const payload = await response.json()
        const entry = (payload?.versions ?? []).find(
          (candidate) => String(candidate?.version) === version,
        )
        network = (Array.isArray(entry?.network) ? entry.network : [])
          .map((origin) => String(origin))
          .filter((origin) => NETWORK_ORIGIN.test(origin))
          .slice(0, 20)
      }
    } catch {
      // Strict fallback — the plugin still runs, just without direct
      // network; hostFetch remains available.
      network = []
    }
  }

  let html
  try {
    html = loadHtml()
  } catch (error) {
    console.error('loader html missing:', error)
    return res.status(500).json({ error: 'Loader unavailable' })
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy', csp(network))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'origin')
  res.setHeader('Cache-Control', 'private, no-store')
  return res.status(200).send(html)
}
