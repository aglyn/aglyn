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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

const SESSION_COOKIE = '__session'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Cross-subdomain sessions (AGL-236): Firebase client auth persists
 * per-origin, so hopping between {org}.aglyn.io workspaces would force
 * re-login. POST mints a session cookie scoped to the parent domain from
 * a fresh ID token; GET exchanges the cookie for a custom token so a new
 * subdomain's client can sign in silently; DELETE clears it on sign-out.
 * Revocation-aware: the exchange rejects cookies minted before the
 * user's tokens were revoked.
 */
function cookieAttributes(req: NextApiRequest, maxAgeSeconds: number) {
  const host = String(req.headers.host ?? '').split(':')[0]
  const onWorkspaceDomain =
    host === WORKSPACE_DOMAIN || host.endsWith(`.${WORKSPACE_DOMAIN}`)
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    // Domain only on the real deployment so localhost dev still works;
    // Secure likewise (localhost is http).
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`, 'Secure'] : []),
  ].join('; ')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const auth = firebaseAdmin.app().auth()

    if (req.method === 'POST') {
      const authorization = req.headers.authorization ?? ''
      const idToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined
      if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
      const sessionCookie = await auth.createSessionCookie(idToken, {
        expiresIn: SESSION_TTL_MS,
      })
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${sessionCookie}; ${cookieAttributes(req, SESSION_TTL_MS / 1000)}`,
      )
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'GET') {
      const cookie = req.cookies?.[SESSION_COOKIE]
      if (!cookie) return res.status(401).json({ error: 'No session' })
      const decoded = await auth.verifySessionCookie(cookie, true)
      const token = await auth.createCustomToken(decoded.uid)
      return res.status(200).json({ token })
    }

    if (req.method === 'DELETE') {
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`,
      )
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    // Expired/revoked cookies land here — clear and report unauthenticated.
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`,
    )
    return res.status(401).json({ error: 'Session invalid' })
  }
}
