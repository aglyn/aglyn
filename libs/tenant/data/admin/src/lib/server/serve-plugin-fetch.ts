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
import type { NextApiRequest, NextApiResponse } from 'next'
import { firebaseAdmin } from './firebase-admin'

const FETCH_TIMEOUT_MS = 8000

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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let upstream: Response
    try {
      upstream = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { Accept: 'application/json, text/*;q=0.9, */*;q=0.1' },
        ...(method === 'POST' && requestBody ? { body: requestBody } : {}),
      })
    } finally {
      clearTimeout(timeout)
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
