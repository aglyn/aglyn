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
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Emails an org owner that a GDPR erasure request was recorded (AGL-768
 * follow-up). The request itself is a staff Firestore write on the
 * Organizations page; this is the acknowledgement that goes to the owner at
 * request time — the completion confirmation is sent later from run-erasures.
 *
 * Staff-gated and best-effort (returns `{ emailed }`), so the request
 * succeeds whether or not the email goes out.
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

  const orgId = String(body?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (decoded['staff'] !== true) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    if (!isEmailConfigured()) {
      return Response.json(
        { ok: true, emailed: false, reason: 'unconfigured' },
        { status: 200 },
      )
    }

    const auth = firebaseAdmin.app().auth()
    const firestore = firebaseAdmin.app().firestore()
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const orgName = orgSnapshot.get('name') ?? 'your organization'
    // White-label brand (White-Label Phase 3): the erasure acknowledgement
    // reads as the org's brand — sender name and product name — via the one
    // shared resolver.
    const branding = resolveBrandingProfile(
      orgSnapshot.data() as Partial<AglynOrgBilling>,
    )
    const ownerUid = String(orgSnapshot.get('ownerUid') ?? '')
    const ownerEmail = ownerUid
      ? await auth
          .getUser(ownerUid)
          .then((user) => user.email)
          .catch(() => undefined)
      : undefined
    if (!ownerEmail) {
      return Response.json(
        { ok: true, emailed: false, reason: 'no-owner-email' },
        { status: 200 },
      )
    }

    const fallbackText =
      `We have recorded a request to erase ${orgName} and all of its data ` +
      `from ${branding.productName}. Deletion is permanent and happens after ` +
      'a 7-day hold. If this was not intended, contact support before then ' +
      'to cancel.'
    const designed = await renderSystemEmail('erasure-requested', {
      'org.name': String(orgName),
    })
    const result = await sendEmail({
      to: ownerEmail,
      subject: designed?.subject ?? 'We received your erasure request',
      text: designed?.text || fallbackText,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: branding.fromName,
      context: 'erasure-requested',
    })
    return Response.json({ ok: true, emailed: result.sent }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Erasure request email failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
