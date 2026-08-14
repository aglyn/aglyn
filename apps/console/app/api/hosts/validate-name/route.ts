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
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
  suggestSubdomains,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — advisory availability probe that fires per keystroke in the create
// dialog and mutates nothing; hosts/create carries the gate, and the
// per-call verdict reads are not worth it here (AGL-1302 read budget).

async function subdomainTaken(
  firestore: FirebaseFirestore.Firestore,
  subdomain: string,
  excludeHostId?: string,
): Promise<boolean> {
  const matches = await firestore
    .collection('hosts')
    .where('subdomain', '==', subdomain)
    .limit(2)
    .get()
  return matches.docs.some((host) => host.id !== excludeHostId)
}

/**
 * Host name validation (AGL-147), shared by the create dialog and Setup
 * basic-details rename: checks subdomain pattern/reserved/uniqueness
 * (excluding the host being renamed) and flags display-name collisions
 * within the caller's tenant. Suggestions are returned pre-checked for
 * availability so the client can offer them one-click.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '') || undefined
  const displayName = String(body?.displayName ?? '').trim()
  const subdomain = String(body?.subdomain ?? '')
    .trim()
    .toLowerCase()

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
    const firestore = firebaseAdmin.app().firestore()
    const result: {
      subdomainValid: boolean
      subdomainBlocked: boolean
      subdomainTaken: boolean
      suggestions: string[]
      displayNameCollision: boolean
    } = {
      subdomainValid: true,
      subdomainBlocked: false,
      subdomainTaken: false,
      suggestions: [],
      displayNameCollision: false,
    }

    if (subdomain) {
      result.subdomainValid = SUBDOMAIN_PATTERN.test(subdomain)
      result.subdomainBlocked =
        result.subdomainValid && isBlockedSubdomain(subdomain)
      if (result.subdomainValid && !result.subdomainBlocked) {
        result.subdomainTaken = await subdomainTaken(
          firestore,
          subdomain,
          hostId,
        )
      }
      if (result.subdomainTaken || result.subdomainBlocked) {
        const available: string[] = []
        for (const candidate of suggestSubdomains(subdomain)) {
          if (!(await subdomainTaken(firestore, candidate, hostId))) {
            available.push(candidate)
          }
        }
        result.suggestions = available
      }
    }

    if (displayName) {
      // Same-name hosts under one workspace are legal but confusing — warn.
      const membership = await resolveOrgMembership(decoded.uid)
      if (membership) {
        const siblings = await firestore
          .collection('hosts')
          .where('orgId', '==', membership.orgId)
          .where('displayName', '==', displayName)
          .limit(2)
          .get()
        result.displayNameCollision = siblings.docs.some(
          (host) => host.id !== hostId,
        )
      }
    }

    return Response.json(result, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Validation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
