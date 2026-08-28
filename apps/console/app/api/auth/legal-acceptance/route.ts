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
  featureLockdownRefusal,
  firebaseAdmin,
  getLegalAcceptanceStatus,
  recordLegalAcceptance,
} from '@aglyn/tenant-data-admin'
import {
  LEGAL_DOCUMENT_VERSION,
  LEGAL_DOCUMENTS,
} from '../../../../constants/legal-documents'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'

// lockdown-423: exempt — records the caller's own ToS acceptance during sign-in; pre-org,
// so the org/host/user scope verdict has nothing to bind to; the session mint carries
// the scope lockdown gate for this flow. The SIGNUPS feature gate below is separate
// (AGL-1510): every acceptance context is a signup door, so a signups lock refuses here.

/**
 * Records a clickwrap acceptance for the signed-in account (AGL-1497).
 *
 * Server-side because the record is evidence about the person it describes:
 * the Firestore rules make `users/{uid}/legalAcceptances` owner-READABLE and
 * `write: if false`, so only the Admin SDK can create one and the subject can
 * neither forge nor amend their own. It also means the timestamp is the
 * server's rather than whatever the client's clock claimed.
 *
 * NOT gated on `email_verified`, unlike most authenticated routes here. This
 * is called seconds after `createUserWithEmailAndPassword`, when the address
 * is definitionally unverified — gating it would mean no email/password
 * sign-up ever recorded its own acceptance, which is the entire point of the
 * endpoint. The ID token still proves who is asking, and consent is about the
 * human at the keyboard, not about whether they have opened their mail yet.
 *
 * The version is taken from THIS deploy's constant rather than from the body:
 * a client that could name its own version could record agreement to terms it
 * was never shown. The client sends the version it rendered purely so a
 * mismatch can be caught — that only happens when a deploy changed the
 * documents between the page load and the click, and in that case the honest
 * answer is to refuse and make them read the new ones.
 */
async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const presented = String(body?.version ?? '').trim()
  if (presented && presented !== LEGAL_DOCUMENT_VERSION) {
    return Response.json(
      {
        error: 'The legal documents changed — please review them again.',
        reason: 'version-mismatch',
        version: LEGAL_DOCUMENT_VERSION,
      },
      { status: 409 },
    )
  }
  const context = String(body?.context ?? 'unknown').trim().slice(0, 60)

  let uid: string
  let staff: boolean
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    uid = decoded.uid
    staff = decoded['staff'] === true
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Feature lockdown: SIGNUPS (AGL-1510). This endpoint exists solely to
  // record acceptances from the account-creation doors (every `context` it
  // receives is a signup door — AGL-1497), so a signups lock refuses it
  // with the honest 423 body the client can show. The `staff` claim is
  // passed for the platform-scope un-panic bypass only; the feature stage
  // grants no bypass (LOCKDOWN_FEATURE_STAFF_BYPASS.signups = false).
  const locked = await featureLockdownRefusal({ feature: 'signups', staff })
  if (locked) return locked

  try {
    const result = await recordLegalAcceptance(uid, {
      version: LEGAL_DOCUMENT_VERSION,
      documents: LEGAL_DOCUMENTS,
      context,
      // Standard clickwrap evidence. Best-effort: a deployment whose proxy
      // names no address supplies none, and a missing IP is not a reason to
      // lose the record. Null rather than a placeholder, because this field is
      // evidence — a value invented here would read as a fact about where
      // somebody accepted the agreement.
      ipAddress: readClientIp(request.headers),
      userAgent: request.headers.get('user-agent'),
    })
    return Response.json(
      { ok: true, version: result.version, recorded: result.recorded },
      { status: 200 },
    )
  } catch (error) {
    console.error('[auth/legal-acceptance] record failed', error)
    return Response.json({ error: 'Could not record acceptance' }, { status: 500 })
  }
}

/**
 * What the signed-in account has accepted (AGL-2316).
 *
 * The read that makes the write worth having. Two questions, both of which
 * had no answer at all before this: has this person accepted the version we
 * publish TODAY — and if not, is it because they never accepted anything or
 * because the documents moved under them — and is ToS §18.5's 30-day
 * arbitration opt-out window still open for them.
 *
 * SELF ONLY. The uid comes from the verified ID token and from nowhere else;
 * there is no `?uid=` parameter to add later by accident. Somebody else's
 * acceptance history is staff-surface material (`/api/admin/users/detail`),
 * and it carries an IP address and a user agent.
 *
 * NOT lockdown-gated and NOT email-verification gated, for the same reason
 * the POST beside it is neither: this runs on the sign-up path seconds after
 * account creation, and it is a read of the caller's own consent state, which
 * a maintenance freeze has no interest in refusing.
 */
async function statusHandler(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let uid: string
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    uid = decoded.uid
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const status = await getLegalAcceptanceStatus(uid, {
      currentVersion: LEGAL_DOCUMENT_VERSION,
      // The manifest published now, so the status can say WHICH documents
      // moved since this person last agreed. Same constant the POST beside
      // this one pins onto the record it writes.
      currentDocuments: LEGAL_DOCUMENTS,
    })
    return Response.json(
      {
        currentVersion: status.currentVersion,
        accepted: status.accepted,
        acceptedVersions: status.acceptedVersions,
        latestAcceptedVersion: status.latestAcceptedVersion,
        currentVersionAcceptedAt: status.currentVersionAcceptedAt,
        // WHEN they last agreed, and WHAT has moved since — the two facts the
        // banner needs to acknowledge an existing acceptance instead of
        // reading like a first-time ask. Neither carries the IP or the user
        // agent, so the rule below still holds.
        latestAcceptedAt: status.latestAcceptedAt,
        changedDocumentKeys: status.changedDocumentKeys,
        reacceptanceRequired: status.reacceptanceRequired,
        reacceptanceReason: status.reacceptanceReason,
        arbitration: status.arbitration,
        // The full history is NOT returned here. This endpoint drives a
        // banner, and a banner needs a verdict; the IP and user agent on each
        // record are evidence for a dispute, not payload for every page load.
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[auth/legal-acceptance] status read failed', error)
    // Fails SILENT, not closed: a read that could not run must not nag a user
    // who has accepted. The staff surface is where an unreadable record has
    // to be visible, and it says so there.
    return Response.json({ error: 'Could not read acceptance' }, { status: 500 })
  }
}

export { handler as POST, statusHandler as GET }
