/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  isPluginNetworkAllowed,
  PLUGIN_FETCH_MAX_BODY_BYTES,
} from '@aglyn/aglyn/server'
import { lookup } from 'dns/promises'
import { isIPv4, isIPv6 } from 'net'
import type { NextApiRequest, NextApiResponse } from 'next'
import { Agent } from 'undici'
import { firebaseAdmin } from './firebase-admin'

const FETCH_TIMEOUT_MS = 8000
/**
 * Redirect hops the proxy will follow, each one re-validated (AGL-1881).
 * Small on purpose: a legitimate API redirects once (http->https is refused
 * outright by the allowlist, so in practice this is a path or host alias).
 */
const MAX_REDIRECT_HOPS = 3
/** The statuses `redirect: 'manual'` hands back instead of following. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** True for loopback / private / link-local / CGNAT / ULA addresses. */
function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    // The ranges AGL-1881 found missing. None is routable on the public
    // internet, so refusing them costs a plugin nothing:
    if (a === 192 && b === 0) return true // 192.0.0.0/24 IETF protocol
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmark
    if (a >= 224) return true // 224/4 multicast, 240/4 reserved, broadcast
    return false
  }
  if (isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true
    if (low.startsWith('fc') || low.startsWith('fd')) return true // ULA
    // Link-local is fe80::/10 — fe80 through febf, not the fe80 prefix
    // alone (AGL-1881). `fec0::/10` site-local is deprecated but inside the
    // same span, so one test covers both.
    if (/^fe[89ab]/.test(low)) return true // link-local fe80::/10
    if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7)) // v4-mapped
    return false
  }
  return true // unparseable → refuse
}

/**
 * SSRF hardening (AGL-515): even an https, allowlisted origin can resolve to
 * an internal address (a plugin author pointing DNS at 127.0.0.1 / the cloud
 * metadata endpoint). Resolve the host and return a single validated PUBLIC
 * address to pin the connection to (null if any resolved address is private).
 * Pinning the exact IP the fetch connects to closes the DNS-rebinding TOCTOU —
 * the name can't re-resolve to an internal target between check and connect.
 */
async function resolvePublicIp(hostname: string): Promise<string | null> {
  try {
    const addresses = await lookup(hostname, { all: true })
    if (!addresses.length) return null
    if (addresses.some((a) => isPrivateIp(a.address))) return null
    return addresses[0].address
  } catch {
    return null
  }
}

/**
 * Build the dispatcher that pins the socket to `pinnedIp` (AGL-515). A custom
 * `connect.lookup` forces the connection to the address `resolvePublicIp`
 * already validated, so the name can't be rebound to an internal target
 * between the check and the connect. TLS SNI / certificate validation still
 * use the original hostname, because only the address resolution is replaced.
 *
 * Exported so the transport itself is covered by a spec (AGL-2480). `undici`
 * is a **declared direct dependency** for exactly this reason: it used to
 * arrive only as a transitive of the dev-only `jsdom`, which meant a
 * `--omit=dev` install had no `undici` at all and a jsdom bump silently
 * re-versioned the HTTP client behind a production security control. undici 8
 * rejects this `lookup` shape with `UND_ERR_INVALID_ARG` on every request —
 * fail-closed, but the plugin-fetch route stops working outright. The spec
 * drives a real request through this dispatcher so that break is a red test,
 * not a production discovery.
 */
export function createPinnedDispatcher(pinnedIp: string): Agent {
  const family = isIPv6(pinnedIp) ? 6 : 4
  return new Agent({
    connect: {
      lookup: (_host, options, cb) =>
        options && options.all
          ? cb(null, [{ address: pinnedIp, family }])
          : cb(null, pinnedIp, family),
    },
  })
}

/**
 * Host-mediated plugin fetch (AGL-191). The sandboxed plugin can't reach
 * the network directly under a strict plugin-origin CSP, so `PluginFrame`
 * forwards a `fetch-request` here and the host proxies it. Mounted in BOTH
 * apps (console for the editor/preview, tenant for the published site) so
 * plugin fetches work wherever the plugin renders — hence public, no
 * admin auth: the security boundary is the ALLOWLIST, re-derived from the
 * host's server-side install record and never trusting the client's claim.
 * https-only, exact-origin, method/body/time capped, and no host
 * credentials are ever forwarded — a plugin can only reach origins it
 * declared at install (surfaced on the install screen).
 *
 * Abuse note: this uses platform egress to origins the plugin already
 * declared; a per-listing rate limit is a sensible follow-up.
 */
export async function servePluginFetch(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ ok: false, status: 0, error: 'Method not allowed' })
    return
  }
  const body =
    typeof req.body === 'string' ? safeJson(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const listingId = String(body.listingId ?? '')
  const url = String(body.url ?? '')
  const method = body.method === 'POST' ? 'POST' : 'GET'
  const requestBody =
    typeof body.body === 'string' ? (body.body as string) : undefined
  if (!hostId || !listingId || !url) {
    res.status(400).json({ ok: false, status: 0, error: 'Bad request' })
    return
  }
  if (requestBody && Buffer.byteLength(requestBody) > PLUGIN_FETCH_MAX_BODY_BYTES) {
    res.status(413).json({ ok: false, status: 0, error: 'Body too large' })
    return
  }

  try {
    const install = (
      await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('installs')
        .doc(listingId)
        .get()
    ).data() as { manifest?: { capabilities?: unknown } } | undefined
    if (!install?.manifest) {
      res.status(404).json({ ok: false, status: 0, error: 'Not installed' })
      return
    }
    if (
      !isPluginNetworkAllowed(
        url,
        (install.manifest as { capabilities?: any }).capabilities,
      )
    ) {
      res
        .status(403)
        .json({ ok: false, status: 0, error: 'URL not in allowlist' })
      return
    }
    // Follow redirects OURSELVES, re-validating every hop (AGL-1881).
    //
    // `fetch` defaults to `redirect: 'follow'`, and every control above runs
    // on the FIRST url only: the allowlist, the https-only check and the
    // pinned dispatcher. A declared, allowlisted, genuinely public origin
    // answering `302 Location: http://169.254.169.254/...` therefore reached
    // the cloud metadata service and returned its body to the caller — on an
    // unauthenticated route. The IP pin did not stop it: Node skips a custom
    // `connect.lookup` when the target is an IP literal, so the redirect
    // connected directly and the pinned lookup was consulted exactly once,
    // for the original hostname.
    //
    // `redirect: 'manual'` hands us each hop instead. Every one re-enters the
    // same two gates the first url passed — the manifest allowlist (which is
    // also what enforces https and the exact origin) and a fresh
    // `resolvePublicIp` with its own pinned dispatcher — so a redirect can
    // only ever reach somewhere the plugin could have named directly.
    let currentUrl = url
    let upstream: Response
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECT_HOPS) {
        res
          .status(403)
          .json({ ok: false, status: 0, error: 'Too many redirects' })
        return
      }
      const pinnedIp = await resolvePublicIp(new URL(currentUrl).hostname)
      if (!pinnedIp) {
        res.status(403).json({
          ok: false,
          status: 0,
          error: 'URL resolves to a non-public address',
        })
        return
      }

      // Pin the socket to the address we just validated (AGL-515).
      const dispatcher = createPinnedDispatcher(pinnedIp)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      // `dispatcher` is an undici extension not in the DOM RequestInit type;
      // assigning to a variable first avoids the object-literal excess-property
      // check while still passing it through to the (undici) global fetch.
      const requestInit = {
        method,
        signal: controller.signal,
        dispatcher,
        redirect: 'manual' as const,
        headers: { Accept: 'application/json, text/*;q=0.9, */*;q=0.1' },
        ...(method === 'POST' && requestBody ? { body: requestBody } : {}),
      }
      try {
        upstream = await fetch(currentUrl, requestInit)
      } finally {
        clearTimeout(timeout)
        await dispatcher.close().catch(() => undefined)
      }

      if (!REDIRECT_STATUSES.has(upstream.status)) break

      const location = upstream.headers.get('location')
      if (!location) break // a redirect status with no target is just a body
      let nextUrl: string
      try {
        nextUrl = new URL(location, currentUrl).toString()
      } catch {
        res
          .status(403)
          .json({ ok: false, status: 0, error: 'Redirect target is not a URL' })
        return
      }
      if (
        !isPluginNetworkAllowed(
          nextUrl,
          (install.manifest as { capabilities?: any }).capabilities,
        )
      ) {
        res.status(403).json({
          ok: false,
          status: 0,
          error: 'Redirect target not in allowlist',
        })
        return
      }
      currentUrl = nextUrl
    }

    const text = await upstream.text()
    const clipped =
      Buffer.byteLength(text) > PLUGIN_FETCH_MAX_BODY_BYTES
        ? text.slice(0, PLUGIN_FETCH_MAX_BODY_BYTES)
        : text
    res.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      body: clipped,
    })
  } catch (error) {
    console.error('servePluginFetch failed', hostId, listingId, error)
    res.status(502).json({ ok: false, status: 0, error: 'Fetch failed' })
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}
