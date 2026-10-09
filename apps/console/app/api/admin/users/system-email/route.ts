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
  isEmailConfigured,
  PRODUCT_TIP_RETENTION_EMAILS,
  sendEmail,
  SYSTEM_EMAIL_TEMPLATES,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isEmailSuppressed,
  isImpersonationSession,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { readPlatformMarketingConsent } from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { resolveIdpDisplayName } from '@aglyn/aglyn/app-utils/idp-profile'
import { generateAuthActionLink } from '../../../_lib/auth-action-link'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import { renderSystemEmail } from '../../../_lib/render-system-email'
import {
  ACTION_LINK_SYSTEM_EMAILS,
  autoMergeValues,
  consoleOriginForEmail,
  followUpProblem,
  mergeStaffValues,
  requiresUnverifiedAccount,
  STAFF_FOLLOW_UP_EMAIL,
  STAFF_SYSTEM_EMAIL_LIMIT,
  STAFF_SYSTEM_EMAIL_WINDOW_MS,
  staffSendableSystemEmail,
  type StaffSendTarget,
} from '../../../../../utils/server/staff-system-email'

// lockdown-423: exempt — staff tooling, and the mail it sends is how a
// locked-out or stranded account is reached.

/**
 * SEND ONE ACCOUNT A SYSTEM EMAIL, OR A WRITTEN FOLLOW-UP (AGL-3691).
 *
 * `GET ?uid=` lists what can be sent to the account, each email with its
 * merge tokens already filled from what the server knows about the account.
 *
 * `POST { uid, templateKey, mergeValues, send }` renders the email. With
 * `send` false or absent it only previews: the subject and the rendered HTML
 * come back and nothing leaves. With `send: true` it sends from the platform
 * sender (`USAGE_EMAIL_FROM`), tagged with the email's own `context`, so the
 * delivery log files it under the email it is. A verification or reset link
 * is minted fresh at send time, never at preview.
 *
 * Refusals, all before anything is minted or sent:
 *  - not staff (403);
 *  - an unknown, Stripe-delivered or staff-audience email id (400);
 *  - verification for an account that is already verified (409,
 *    `alreadyVerified`);
 *  - an address on the platform suppression list (409, `suppressed`);
 *  - more than {@link STAFF_SYSTEM_EMAIL_LIMIT} sends to one account in an
 *    hour (429);
 *  - Identity Platform's own `TOO_MANY_ATTEMPTS_TRY_LATER` throttle on the
 *    link mint (429), as `/api/auth/send-verification` reports it.
 *
 * Every send writes an `adminAudit` row naming the account, so it shows on
 * that account's staff page, and is metered as platform mail.
 */

async function staffCaller(
  headers: Partial<Record<string, string>>,
): Promise<
  | { ok: true; uid: string; email: string; name: string }
  | { ok: false; response: Response }
> {
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthenticated' }, { status: 401 }),
    }
  }
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return { ok: false, response: emailUnverifiedResponse() }
  }
  if (!decoded['staff']) {
    return {
      ok: false,
      response: Response.json({ error: 'Staff only' }, { status: 403 }),
    }
  }
  return {
    ok: true,
    uid: decoded.uid,
    email: String(decoded.email ?? '').toLowerCase(),
    name: resolveIdpDisplayName(decoded).trim().split(/\s+/)[0] || '',
  }
}

interface LoadedTarget extends StaffSendTarget {
  uid: string
  emailVerified: boolean
  /** Set for an account in an enterprise tenant pool. */
  tenantId: string | null
  /** The account answered No to product email (AGL-3692). */
  declinedProductEmail: boolean
}

/** The account, its profile name and its first workspace. */
async function loadTarget(uid: string): Promise<LoadedTarget | null> {
  const pooled = await findUserByUidAcrossPools(uid)
  const record = pooled?.record
  const email = String(record?.email ?? '').trim().toLowerCase()
  if (!record || !email) return null
  const firestore = firebaseAdmin.app().firestore()
  const [profile, orgIndex] = await Promise.all([
    firestore.collection('users').doc(uid).get().catch(() => null),
    firestore
      .collection('users')
      .doc(uid)
      .collection('orgs')
      .limit(1)
      .get()
      .catch(() => null),
  ])
  const orgId = orgIndex?.docs?.[0]?.id
  const org = orgId
    ? await firestore.collection('orgs').doc(orgId).get().catch(() => null)
    : null
  return {
    uid,
    email,
    emailVerified: record.emailVerified === true,
    tenantId: pooled?.tenantId ?? null,
    declinedProductEmail:
      readPlatformMarketingConsent(
        (profile?.data?.() as Record<string, unknown> | undefined) ?? null,
      ).decision === 'declined',
    displayName: record.displayName ?? null,
    firstName: (profile?.get?.('firstName') as string | undefined) ?? null,
    org: org?.exists
      ? {
          name: (org.get('name') as string | undefined) ?? null,
          slug: (org.get('slug') as string | undefined) ?? null,
        }
      : null,
  }
}

function describeEmail(
  definition: SystemEmailTemplateDefinition,
  target: LoadedTarget,
) {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    actionLink: Boolean(ACTION_LINK_SYSTEM_EMAILS[definition.key]),
    followUp: definition.key === STAFF_FOLLOW_UP_EMAIL,
    tokens: definition.mergeTokens
      .filter((token) => !token.name.startsWith('brand.'))
      .map((token) => ({
        name: token.name,
        description: token.description,
        sample: token.sample,
      })),
    values: autoMergeValues(definition, target),
  }
}

/**
 * Identity Platform's throttle, which surfaces as a generic
 * `auth/internal-error` whose upstream body names the cause. The same match
 * `/api/auth/send-verification` makes.
 */
function isTooManyAttempts(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const probe = error as {
    code?: unknown
    message?: unknown
    cause?: { response?: { text?: unknown } }
  }
  if (probe.code !== 'auth/internal-error') return false
  const body = probe.cause?.response?.text
  const haystack = `${typeof body === 'string' ? body : ''} ${
    typeof probe.message === 'string' ? probe.message : ''
  }`
  return haystack.includes('TOO_MANY_ATTEMPTS_TRY_LATER')
}

async function handleGet(query: Record<string, unknown>): Promise<Response> {
  const uid = String(query?.uid ?? '').trim()
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })
  const target = await loadTarget(uid)
  if (!target) {
    return Response.json(
      { error: 'No account with an email address has that uid' },
      { status: 404 },
    )
  }
  const suppressed = await isEmailSuppressed(target.email)
  const emails = SYSTEM_EMAIL_TEMPLATES.map((entry) =>
    staffSendableSystemEmail(entry.key),
  )
    .filter((entry): entry is SystemEmailTemplateDefinition => Boolean(entry))
    .map((definition) => describeEmail(definition, target))
  return Response.json(
    {
      account: {
        uid,
        email: target.email,
        emailVerified: target.emailVerified,
        suppressed,
        configured: isEmailConfigured(),
      },
      emails,
    },
    { status: 200 },
  )
}

async function handlePost(
  payload: Record<string, unknown>,
  caller: { uid: string; email: string; name: string },
): Promise<Response> {
  const definition = staffSendableSystemEmail(payload?.templateKey)
  if (!definition) {
    return Response.json(
      { error: 'Unknown email, or not one staff can send to an account' },
      { status: 400 },
    )
  }
  const uid = String(payload?.uid ?? '').trim()
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })
  const send = payload?.send === true

  const target = await loadTarget(uid)
  if (!target) {
    return Response.json(
      { error: 'No account with an email address has that uid' },
      { status: 404 },
    )
  }
  if (requiresUnverifiedAccount(definition.key) && target.emailVerified) {
    return Response.json(
      {
        error: 'This account has already confirmed its email address.',
        alreadyVerified: true,
      },
      { status: 409 },
    )
  }

  // A getting-started tip is product email (AGL-3692): an account that said
  // No to product email is not sent one by hand either.
  if (PRODUCT_TIP_RETENTION_EMAILS.has(definition.key) && target.declinedProductEmail) {
    return Response.json(
      {
        error: 'This account turned off product emails, so getting-started tips are not sent to it.',
        declinedProductEmail: true,
      },
      { status: 409 },
    )
  }

  const values = mergeStaffValues(
    definition,
    autoMergeValues(definition, target),
    payload?.mergeValues,
  )
  if (definition.key === STAFF_FOLLOW_UP_EMAIL) {
    if (!String(values['sender.name'] ?? '').trim()) {
      values['sender.name'] = caller.name || 'The team'
    }
    const problem = followUpProblem(values)
    if (problem) return Response.json({ error: problem }, { status: 400 })
  }

  if (!send) {
    const preview = await renderSystemEmail(definition.key, values)
    if (!preview) {
      return Response.json({ error: 'Nothing to render' }, { status: 400 })
    }
    return Response.json(
      {
        sent: false,
        preview: true,
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        to: target.email,
      },
      { status: 200 },
    )
  }

  if (await isEmailSuppressed(target.email)) {
    return Response.json(
      {
        error:
          'This address is on the suppression list (a bounce, a complaint or ' +
          'a staff hold). Release it first if mail should reach it.',
        suppressed: true,
      },
      { status: 409 },
    )
  }
  if (!isEmailConfigured()) {
    return Response.json({ error: 'Email is not configured' }, { status: 501 })
  }
  const limited = await consumeRateLimit(`staff-system-email:${uid}`, {
    limit: STAFF_SYSTEM_EMAIL_LIMIT,
    windowMs: STAFF_SYSTEM_EMAIL_WINDOW_MS,
  })
  if (!limited.allowed) {
    return Response.json(
      {
        error: `This account has been sent ${STAFF_SYSTEM_EMAIL_LIMIT} emails from staff in the last hour. Try again later.`,
      },
      { status: 429 },
    )
  }

  const action = ACTION_LINK_SYSTEM_EMAILS[definition.key]
  if (action) {
    if (target.tenantId) {
      return Response.json(
        {
          error:
            'This account signs in through its organization’s identity ' +
            'provider, so its links are not ours to mint.',
        },
        { status: 409 },
      )
    }
    values[action.token] = await generateAuthActionLink(
      action.kind,
      target.email,
      consoleOriginForEmail(),
    )
  }

  const rendered = await renderSystemEmail(definition.key, values)
  if (!rendered) {
    return Response.json({ error: 'Nothing to render' }, { status: 400 })
  }
  const result = await sendEmail({
    to: target.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    context: definition.key,
    ...(action ? { owedFor: 'account' as const } : {}),
    ...(PRODUCT_TIP_RETENTION_EMAILS.has(definition.key) && values['preferencesUrl']
      ? { headers: { 'List-Unsubscribe': `<${values['preferencesUrl']}>` } }
      : {}),
    // A written follow-up is a person talking: an answer goes to them, not
    // to the platform's no-reply address.
    ...(definition.key === STAFF_FOLLOW_UP_EMAIL && caller.email
      ? { replyTo: caller.email }
      : {}),
  })
  if (result.sent) await meterPlatformEmail().catch(() => undefined)

  await addAdminAudit(firebaseAdmin.app().firestore(), {
    actorUid: caller.uid,
    action: 'systemEmail.staffSend',
    target: `users/${uid}`,
    subjectUid: uid,
    before: null,
    after: {
      templateKey: definition.key,
      sent: result.sent,
      ...(definition.key === STAFF_FOLLOW_UP_EMAIL
        ? { subject: rendered.subject }
        : {}),
    },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }).catch((error: unknown) =>
    console.error('[admin/users/system-email] audit write failed', error),
  )

  if (result.sent) {
    return Response.json(
      { sent: true, id: result.id, subject: rendered.subject, to: target.email },
      { status: 200 },
    )
  }
  const failure = result as { reason?: string; detail?: string }
  return Response.json(
    {
      sent: false,
      error: 'The email was not sent.',
      reason: failure.reason ?? null,
      detail: failure.detail ?? null,
    },
    { status: 502 },
  )
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    body,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  try {
    const caller = await staffCaller(headers)
    if ('response' in caller) return caller.response
    return method === 'GET'
      ? await handleGet((query ?? {}) as Record<string, unknown>)
      : await handlePost((body ?? {}) as Record<string, unknown>, caller)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (isTooManyAttempts(error)) {
      console.warn(
        '[admin/users/system-email] Identity Platform throttled the link mint (TOO_MANY_ATTEMPTS_TRY_LATER)',
      )
      return Response.json(
        {
          error:
            'Too many links minted for this address — wait a few minutes and send again.',
        },
        { status: 429 },
      )
    }
    console.error('[admin/users/system-email] failed', error)
    return Response.json({ error: 'Sending failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
