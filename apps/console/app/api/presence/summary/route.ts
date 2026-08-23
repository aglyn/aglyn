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
import { summarizeOrgPresence } from '../../_lib/presence-summary'

/**
 * Who is in each document of one site, for list rows and detail pages
 * (AGL-2486).
 *
 * Zach: "add the presence avatars indicators to the detail page and list rows
 * as well to easily identify who is currently in the document already before
 * joining."
 *
 * ## Why this exists at all
 *
 * The RTDB rules let a client read exactly ONE room — measured against the
 * live rules from the browser: one room `ALLOWED`, the docType subtree and the
 * org subtree both `Permission denied`. A list of fifty screens would
 * therefore need fifty subscriptions, and the presence tree is sparse enough
 * (2 occupied rooms against a largest host of 69 documents) that almost all of
 * them would exist to learn that nobody is there. One request replaces them.
 *
 * ## ADMIN CREDENTIALS BYPASS THE RULES, SO THIS DOES ITS OWN AUTHORIZATION
 *
 * That is the whole risk of the design and it is handled here rather than
 * assumed. The read below runs as the service account, which the security
 * rules do not constrain, so "any signed-in user can enumerate who is editing
 * what across the platform" is exactly one missing check away. The check is
 * deliberately the SAME bar `/api/presence/token` uses, and it proves the same
 * thing in the same order:
 *
 *   1. a verified ID token, with the email-verification gate;
 *   2. membership proven against the HOST the caller names — never against an
 *      orgId they supply, which would let anyone read any org;
 *   3. the org read is then scoped to that host's org and nothing else.
 *
 * The result is exactly as permissive as the RTDB rule a client already has:
 * `auth.token.presenceOrg === $orgId` grants a member read of any room in
 * their own org, one at a time. This returns the same information in one
 * response. It widens convenience, not access.
 *
 * ## What comes back is a display artifact
 *
 * `summarizeOrgPresence` BUILDS each person from named fields rather than
 * passing a stored row through, so cursors never leave the editor and a field
 * added to presence later cannot leak here by default. It also applies the
 * DISPLAY staleness window, not the reaper's: a list is read at a glance and
 * believed, so it must never claim someone is editing a document the editor
 * itself would already have stopped drawing them in.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()

    // Membership against the HOST the caller names, exactly as the token
    // route proves it. An orgId taken from the request body would be the
    // whole vulnerability.
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json({ error: 'Site has no organization' }, { status: 409 })
    }
    const membership = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(decoded.uid)
      .get()
    if (!membership.exists) {
      return Response.json(
        { error: 'Not a member of this site' },
        { status: 403 },
      )
    }

    const tree = (
      await firebaseAdmin.database().ref(`presence/${orgId}`).get()
    ).val()
    return Response.json(
      { summary: summarizeOrgPresence(tree, Date.now()) },
      {
        status: 200,
        // A snapshot of who is in a room right now is never cacheable, and a
        // shared cache holding one org's answer for another's would be the
        // authorization check undone by a header.
        headers: { 'Cache-Control': 'no-store, private' },
      },
    )
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '')
    if (code.startsWith('auth/')) {
      console.warn('[presence/summary] refused:', code)
      return Response.json(
        { error: 'Your sign-in is no longer valid', reason: code },
        { status: 401 },
      )
    }
    console.error('[presence/summary] failed:', error)
    // A list that cannot say who is present shows nobody; it must never fail
    // the page it decorates.
    return Response.json({ summary: {}, reason: 'unavailable' }, { status: 200 })
  }
}

export const POST = handler
