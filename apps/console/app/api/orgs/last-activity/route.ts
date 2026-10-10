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
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  stampOrgLastActivity,
  type OrgActivityStore,
} from '../../../../utils/server/org-last-activity'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — writes one server-clock timestamp the platform keeps
// ABOUT the workspace (when a member last used it), never the workspace's own
// content; a locked workspace's members still being active is exactly what
// staff reading the list need to see.

/**
 * `POST { orgId }` — a member of the organization is using the console in it
 * now. Stamps `orgs/{orgId}.lastActivityAt` at most once per
 * `ORG_LAST_ACTIVITY_INTERVAL_MS` (`utils/org-list-query.ts` says what the
 * field is and who reads it).
 *
 * The org shell calls it on real input, throttled per tab to the same
 * interval (`hooks/use-org-last-activity.ts`); this route is the per-org
 * bound, so the field costs at most four writes an hour however busy the
 * workspace is.
 *
 * Only a MEMBER's activity counts. Staff who are not members (reading a
 * customer workspace from the staff console) and impersonation sessions are
 * answered `{ stamped: false }` and write nothing: the field answers "when
 * did this customer last use Aglyn", and staff activity is not that.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String((body as { orgId?: unknown } | null)?.orgId ?? '').trim()
  if (!orgId || orgId.includes('/')) {
    return Response.json({ error: 'Missing orgId' }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (isImpersonationSession(decoded)) {
      return Response.json({ stamped: false, reason: 'impersonation' }, { status: 200 })
    }
    if (!decoded.email_verified) return emailUnverifiedResponse()
    if (!(await resolveOrgMembership(decoded.uid, orgId))?.member) {
      return Response.json({ stamped: false, reason: 'not a member' }, { status: 200 })
    }
    const outcome = await stampOrgLastActivity(
      app.firestore() as unknown as OrgActivityStore,
      orgId,
    )
    return Response.json({ stamped: outcome === 'stamped', outcome }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Activity was not recorded' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
