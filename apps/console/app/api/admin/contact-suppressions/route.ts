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
  contactSuppressionKey,
  emailUnverifiedResponse,
  firebaseAdmin,
  forgetUserPhoneNumber,
  isImpersonationSession,
  listContactSuppressions,
  releasePhoneContact,
  suppressPhoneContact,
  type ContactChannel,
  type ContactSuppressionSource,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The intake path for Privacy Policy v4 §11's non-SMS routes (AGL-1592).
 *
 * §11 offers three ways to opt out of marketing calls and texts: reply STOP,
 * "tell us during a call", or email privacy@aglyn.com. The first has a seam
 * waiting for an SMS pipeline (`sms-keywords.ts`). The other two are humans
 * receiving a request in a mailbox or on a phone, and they have needed a place
 * to put it — without one, honouring the promise depended on somebody
 * remembering, which is not a mechanism.
 *
 * Staff-gated, because that is who reads privacy@ and answers the phone. Every
 * mutation writes an `adminAudit` row: an opt-out that later turns out not to
 * have been honoured becomes a question about who recorded what and when, and
 * the answer should not be "we think so".
 *
 * The route does the normalizing and the fan-out rather than the client, which
 * is why the Firestore rule denies client writes to `contactSuppressions`
 * outright.
 */
async function authorize(
  request: Request,
): Promise<{ decoded: any } | { response: Response }> {
  const { headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return { response: Response.json({ error: 'Unauthenticated' }, { status: 401 }) }
  }
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return { response: emailUnverifiedResponse() }
  }
  if (decoded['staff'] !== true) {
    return { response: Response.json({ error: 'Staff only' }, { status: 403 }) }
  }
  return { decoded }
}

async function audit(
  actorUid: string,
  action: string,
  target: string,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid,
        action,
        target,
        before: null,
        after,
        at: FieldValue.serverTimestamp(),
      })
  } catch (error) {
    // Best-effort, and only the audit row: the suppression itself has already
    // been written by the time this runs, and failing the request here would
    // invite the operator to retry a request that already succeeded.
    console.error('[admin/contact-suppressions] audit write failed', error)
  }
}

const SOURCES: ContactSuppressionSource[] = ['email', 'verbal', 'staff']
const CHANNELS: ContactChannel[] = ['calls', 'texts']

async function listHandler(request: Request): Promise<Response> {
  const authorized = await authorize(request)
  if ('response' in authorized) return authorized.response
  try {
    const records = await listContactSuppressions({ limit: 200 })
    return Response.json({ ok: true, records }, { status: 200 })
  } catch (error) {
    console.error('[admin/contact-suppressions] list failed', error)
    return Response.json({ error: 'Could not read the suppression list' }, { status: 500 })
  }
}

async function writeHandler(request: Request): Promise<Response> {
  const { method, body } = await pluginRequestFromWeb(request)
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorized = await authorize(request)
  if ('response' in authorized) return authorized.response
  const actorUid = authorized.decoded.uid

  const phoneNumber = String(body?.phoneNumber ?? '').trim()
  if (!phoneNumber) {
    return Response.json({ error: 'Missing phoneNumber' }, { status: 400 })
  }
  // Reject early and by the same rule the store uses, so the operator finds
  // out at the form rather than discovering later that the record they filed
  // is keyed to a number nobody will ever look up.
  if (!contactSuppressionKey(phoneNumber)) {
    return Response.json(
      {
        error:
          'That number could not be read as a phone number. Include the country code, e.g. +1 512 555 0123.',
      },
      { status: 400 },
    )
  }

  const action = String(body?.action ?? 'suppress')
  try {
    if (action === 'release') {
      const released = await releasePhoneContact({
        phoneNumber,
        releasedByUid: actorUid,
        note: body?.note ? String(body.note) : null,
      })
      if (released) {
        await audit(actorUid, 'contact.suppression.released', `phone/${contactSuppressionKey(phoneNumber)}`, {
          phoneNumber,
        })
      }
      return Response.json({ ok: true, released }, { status: 200 })
    }

    // An erasure request is the deletion half of §11, and it needs an account
    // to clear the stored copy from. Without a uid we can still suppress the
    // number — which is the part that protects the person — so the request is
    // not refused, just narrowed, and the response says which happened.
    const erasePhoneOnFile = body?.erasePhoneOnFile === true
    const uid = body?.uid ? String(body.uid) : null
    if (erasePhoneOnFile && uid) {
      const result = await forgetUserPhoneNumber({
        uid,
        phoneNumber,
        recordedByUid: actorUid,
        note: body?.note ? String(body.note) : null,
      })
      await audit(actorUid, 'contact.phone.erased', `users/${uid}`, {
        phoneNumber: result.suppressed,
        clearedFromProfile: result.cleared,
      })
      return Response.json(
        { ok: true, suppressed: result.suppressed, clearedFromProfile: result.cleared },
        { status: 200 },
      )
    }

    const requested = Array.isArray(body?.channels)
      ? (body.channels as unknown[]).filter((channel): channel is ContactChannel =>
          CHANNELS.includes(channel as ContactChannel),
        )
      : []
    const source = SOURCES.includes(body?.source as ContactSuppressionSource)
      ? (body.source as ContactSuppressionSource)
      : 'staff'
    const result = await suppressPhoneContact({
      phoneNumber,
      ...(requested.length ? { channels: requested } : {}),
      source,
      uid,
      recordedByUid: actorUid,
      note: body?.note ? String(body.note) : null,
      erasePhoneOnFile,
    })
    await audit(actorUid, 'contact.suppression.recorded', `phone/${contactSuppressionKey(phoneNumber)}`, {
      phoneNumber: result.phoneNumber,
      channels: result.channels,
      source,
      erasePhoneOnFile,
      uid,
    })
    return Response.json(
      { ok: true, phoneNumber: result.phoneNumber, channels: result.channels },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/contact-suppressions] write failed', error)
    return Response.json({ error: 'Could not record the request' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { listHandler as GET, writeHandler as POST }
