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
import { generateOrgSlug, isValidOrgSlug } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  createOrganization,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  OrgSlugTakenError,
} from '@aglyn/tenant-data-admin'

/**
 * Creates an organization for the signed-in user (AGL-233). Like Slack,
 * any account can create workspaces; the creator becomes the org owner.
 * Server-side because slug reservation and membership docs are
 * Admin-SDK-only (rules deny client writes).
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const name = String(body?.name ?? '')
    .trim()
    .slice(0, 80)
  if (!name) return Response.json({ error: 'Missing organization name' }, { status: 400 })
  const slug = (String(body?.slug ?? '').trim().toLowerCase() ||
    generateOrgSlug(name)) as string
  if (!isValidOrgSlug(slug)) {
    return Response.json({
      error:
        'Workspace URL must be 3–30 lowercase letters, digits, or dashes ' +
        'and not a reserved name',
    }, { status: 400 })
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
    const orgId = await createOrganization({
      name,
      slug,
      ownerUid: decoded.uid,
      ownerEmail: decoded.email ?? null,
      ownerDisplayName: (decoded['name'] as string | undefined) ?? null,
    })

    // Welcome email on the owner's FIRST org only (AGL-768): someone who
    // creates their second workspace does not get welcomed again. Counted
    // after creation — they now own exactly one — and wrapped so nothing in
    // the send can turn a created org into a 500. Best-effort like every
    // other send; `renderSystemEmail` returns null to fall back to the copy
    // below, `sendEmail` never throws.
    try {
      if (decoded.email && isEmailConfigured()) {
        const ownedCount = (
          await firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .where('ownerUid', '==', decoded.uid)
            .limit(2)
            .get()
        ).size
        if (ownedCount === 1) {
          const origin = headers.origin ?? `https://${headers.host}`
          const ownerName = (decoded['name'] as string | undefined) || 'there'
          const fallbackText =
            `Hi ${ownerName}, thanks for creating ${name}. Your workspace ` +
            `is ready.\n\nOpen your dashboard at ${origin}.`
          const designed = await renderSystemEmail('welcome', {
            name: ownerName,
            'org.name': name,
            consoleUrl: origin,
          })
          await sendEmail({
            to: decoded.email,
            subject: designed?.subject ?? 'Welcome to Aglyn',
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            context: 'welcome',
          })
        }
      }
    } catch (welcomeError) {
      console.error('welcome email skipped', welcomeError)
    }

    return Response.json({ orgId, slug }, { status: 200 })
  } catch (error) {
    if (error instanceof OrgSlugTakenError) {
      return Response.json({ error: 'That workspace URL is taken' }, { status: 409 })
    }
    console.error(error)
    return Response.json({ error: 'Organization creation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
