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

import { resolveIdpDisplayName } from '@aglyn/aglyn/app-utils/idp-profile'
import {
  isPlatformMarketingConsentDecision,
  isPlatformMarketingConsentSourceKind,
  PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  platformMarketingPromptDue,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import {
  firebaseAdmin,
  isImpersonationSession,
  readPlatformMarketingConsentForUser,
  recordPlatformMarketingConsent,
  snoozePlatformMarketingPrompt,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — records the caller's OWN decision about the platform's
// product email, on their own account document and the operator's marketing
// contact. Pre-org, so the org/host/user scope verdict has nothing to bind to,
// and a locked workspace is no reason to refuse somebody's opt-out.

/**
 * The person's decision about the platform's product email (AGL-3185).
 *
 * Server-side because half of the record is somebody else's data: the
 * operator's marketing contact lives in the operator's org, which only the
 * Admin SDK writes, and the sign-up page is a client of the person's own
 * project. The account-document half could be a client write, but one
 * writer of one fact is the rule, so both halves are written here.
 *
 * NOT gated on `email_verified`, like the legal acceptance beside it: the
 * sign-up door calls this seconds after `createUserWithEmailAndPassword`,
 * when the address is definitionally unverified. The basis is the same one
 * the marketing site's forms record — a checkbox the person ticked beside
 * the address they typed — and a typed address that bounces is suppressed
 * by the bounce, not by refusing the tick.
 *
 * The wording version is taken from THIS deploy's constant, never from the
 * body: a client that could name its own version could record agreement to
 * a sentence it never showed. The client sends the version it rendered so a
 * mismatch is caught, and a mismatch is refused rather than recorded under
 * the new wording.
 */

const UNAUTHENTICATED = () =>
  Response.json({ error: 'Unauthenticated' }, { status: 401 })

/**
 * The verified caller, or the response that refuses them.
 *
 * A refused credential is a 401 (AGL-1993). A check that could not run is
 * ours, so it is a 500 rather than a request to sign in again.
 */
async function verifyCaller(request: Request): Promise<
  | { decoded: Record<string, unknown> & { uid: string } }
  | { response: Response }
> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return { response: UNAUTHENTICATED() }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    return { decoded: decoded as Record<string, unknown> & { uid: string } }
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return { response: unauthenticated }
    console.error('[auth/marketing-consent] token verification failed', error)
    return {
      response: Response.json(
        { error: 'Could not check your sign-in' },
        { status: 500 },
      ),
    }
  }
}

/** Records a decision, or the prompt's dismissal, for the signed-in account. */
async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const caller = await verifyCaller(request)
  if ('response' in caller) return caller.response
  const { decoded } = caller

  // A support session is staff acting AS the customer (AGL-480). Consent is
  // the one thing staff must never give on a customer's behalf: a record
  // written here would carry the customer's uid as its own actor, which is
  // exactly the assertion-dressed-as-evidence the provenance field exists to
  // prevent. Refused outright rather than recorded as an operator act.
  if (isImpersonationSession(decoded as never)) {
    return Response.json(
      {
        error: 'A support session cannot decide this for the account',
        reason: 'impersonation',
      },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  const decision = body?.decision
  const source = body?.source
  if (!isPlatformMarketingConsentSourceKind(source)) {
    return Response.json({ error: 'Unknown source' }, { status: 400 })
  }

  // The prompt's close control: no decision, asked again after the snooze.
  if (decision === 'dismissed') {
    if (source !== 'console-prompt') {
      return Response.json(
        { error: 'Only the prompt can be dismissed' },
        { status: 400 },
      )
    }
    try {
      const { atMs } = await snoozePlatformMarketingPrompt(decoded.uid)
      return Response.json({ ok: true, decision: 'dismissed', atMs }, { status: 200 })
    } catch (error) {
      console.error('[auth/marketing-consent] snooze failed', error)
      return Response.json({ error: 'Could not save your choice' }, { status: 500 })
    }
  }

  if (!isPlatformMarketingConsentDecision(decision)) {
    return Response.json({ error: 'Unknown decision' }, { status: 400 })
  }
  // The sign-up form has no way to refuse — an unticked box records nothing
  // — so a refusal claiming that door is a client that is wrong about itself.
  if (decision === 'declined' && source === 'console-signup') {
    return Response.json(
      { error: 'The sign-up form records no refusal' },
      { status: 400 },
    )
  }
  const presented = String(body?.textVersion ?? '').trim()
  if (!presented) {
    return Response.json(
      { error: 'The consent wording version is required' },
      { status: 400 },
    )
  }
  if (presented !== PLATFORM_MARKETING_CONSENT_TEXT_VERSION) {
    return Response.json(
      {
        error: 'The consent wording changed — please review it again.',
        reason: 'version-mismatch',
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      },
      { status: 409 },
    )
  }

  try {
    const result = await recordPlatformMarketingConsent({
      uid: decoded.uid,
      email: typeof decoded['email'] === 'string' ? decoded['email'] : null,
      // Through the resolver, never a raw claim read (AGL-1131): a SAML
      // account carries its name under `firebase.sign_in_attributes`, where
      // a top-level read is permanently empty.
      name: resolveIdpDisplayName(decoded) || null,
      decision,
      source,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    return Response.json(
      {
        ok: true,
        decision,
        atMs: result.atMs,
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
        // Which half landed where. The person's document always did by this
        // line; the contact is the operator's and may be unconfigured.
        contact: result.contact.status,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[auth/marketing-consent] record failed', error)
    return Response.json({ error: 'Could not record your choice' }, { status: 500 })
  }
}

/**
 * What the signed-in account has decided, and whether to ask.
 *
 * SELF ONLY: the uid comes from the verified token and from nowhere else.
 * The prompt rule runs here so the console never re-derives it, and a read
 * that failed answers 500 rather than "not decided" — an unread record must
 * not turn into a prompt for somebody who already answered.
 */
async function statusHandler(request: Request): Promise<Response> {
  const caller = await verifyCaller(request)
  if ('response' in caller) return caller.response
  try {
    const state = await readPlatformMarketingConsentForUser(caller.decoded.uid)
    return Response.json(
      {
        ...state,
        promptDue: platformMarketingPromptDue(state, Date.now()),
        currentTextVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[auth/marketing-consent] status read failed', error)
    return Response.json({ error: 'Could not read your preference' }, { status: 500 })
  }
}

export { handler as POST, statusHandler as GET }
