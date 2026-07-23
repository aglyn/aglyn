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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Releases a custom domain: removes it from the tenant Vercel project and
 * clears `host.cname` (AGL-742).
 *
 * Disconnect used to clear `host.cname` client-side only, leaving the hostname
 * attached to the Vercel project forever. Vercel kept serving it, so with no
 * host holding that cname `get-host.ts` resolved nothing and the domain 404'd
 * instead of being released — while certificates kept renewing and the domain
 * counted against the project's limit.
 *
 * Deliberately does NOT touch DNS. A real custom domain's CNAME lives in the
 * customer's own zone; we have no access to it and must not imply otherwise.
 *
 * Vercel 404 on removal is treated as success — the domain was already gone,
 * which is the desired end state (mirrors how attach tolerates
 * `domain_already_in_use`). Auth: Firebase ID token; caller must be a host admin.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID
  const hostId = String(body?.hostId ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }

    // Only this host's own domain may be released — never a domain read off
    // the request body, which would let an admin detach someone else's.
    const domain = String(hostSnapshot.get('cname') ?? '')
      .trim()
      .toLowerCase()
    if (!domain) {
      return Response.json({ detached: true, alreadyClear: true }, { status: 200 })
    }

    if (token && projectId) {
      const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
      const response = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}${query}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      // 404 = already detached, which is the end state we want.
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => undefined)
        console.error(payload)
        // Record that the platform still holds it, so the orphan is visible
        // rather than silent, and keep `cname` so a retry has something to act
        // on. Same honesty as attach's `cnameAttachmentPending`.
        await hostSnapshot.ref
          .set({ cnameDetachmentPending: true }, { merge: true })
          .catch(() => undefined)
        return Response.json(
          { error: payload?.error?.message ?? 'Vercel detach failed' },
          { status: 502 },
        )
      }
    }

    await hostSnapshot.ref.set(
      {
        cname: firebaseAdmin.firestore.FieldValue.delete(),
        cnameAttachmentPending: firebaseAdmin.firestore.FieldValue.delete(),
        cnameDetachmentPending: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    return Response.json({ detached: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Detach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
