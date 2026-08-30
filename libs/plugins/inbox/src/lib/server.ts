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

/**
 * `POST inbox/reply` — answer one form submission by email.
 *
 * ## The boundary this feature sits on, stated because the UI must say it too
 *
 * The Inbox is not a mailbox. Nothing in this platform receives mail: there
 * is no inbound route, no MX record pointed here, and no parser. A submission
 * arrived as an HTTP POST, not as a message, so there is no `Message-ID` to
 * thread against and a reply is always the FIRST message in its conversation.
 *
 * That decides two things:
 *
 * - **No `In-Reply-To` or `References` header is sent.** There is nothing to
 *   put in them. Inventing an identifier would produce headers that reference
 *   a message no mail server has ever seen, which threads nothing and makes
 *   some filters treat the message as forged.
 * - **`Reply-To` is the sender's own console account address**, so when the
 *   recipient answers, the answer reaches a human in a real mailbox. It does
 *   not come back here, and the composer says so. A reply that went to the
 *   platform's unmonitored address would be a message the merchant never sees
 *   and the customer believes was received.
 *
 * The thread the merchant sees is ours, stored under the submission, and it
 * holds what we sent — never what came back, because nothing comes back.
 *
 * ## Sending identity
 *
 * The `From:` address is the one verified platform identity, because per-org
 * sending domains do not exist. Only the display name varies, through the
 * shared `resolveBrandingProfile`, which is entitlement-gated — so a merchant
 * without white-label replies to their own customer under the platform's
 * name. That is a known deficiency of a phase this feature does not build,
 * and it is the reason `Reply-To` is load-bearing rather than a nicety.
 *
 * ## Consent and suppression
 *
 * A reply is transactional: the recipient asked to be contacted by submitting
 * the form, so no marketing-consent record is required and none is read. The
 * suppression lists still apply — both of them — and this is the first send
 * path in the product to consult BOTH on one address:
 *
 * - the platform list, through `isEmailSuppressed`, which fails closed;
 * - this site's list, under `hosts/{hostId}/suppressions`.
 *
 * Both are keyed with `emailSuppressionKey`, one derivation, so the two reads
 * cannot disagree about which document to look for.
 */

import {
  registerPluginApiRoute,
  resolveBrandingProfile,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  emailSuppressionKey,
  firebaseAdmin,
  getOrgForHost,
  isEmailSuppressed,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import { sendEmail } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  REPLY_BODY_MAX,
  REPLY_SUBJECT_MAX,
  composeReplyBody,
  replyRecipient,
  type ReplyRefusal,
} from './model/reply-policy'

/** Where a reply is stored, under the submission it answers. */
export const REPLIES_SUBCOLLECTION = 'replies'

/** `context` on the send: the log label and the Resend attribution tag. */
export const REPLY_CONTEXT = 'inbox-reply'

/** What a refusal says to the merchant. One line, naming the cause. */
const REFUSAL_MESSAGES: Record<ReplyRefusal, string> = {
  'no-address': 'This submission has no email field, so there is nobody to reply to.',
  'unroutable-address':
    'The email address on this submission is not a valid address.',
  'suppressed-platform':
    'This address bounced or reported a message as spam, so it cannot be mailed.',
  'suppressed-host':
    'This address unsubscribed from this site, so it cannot be mailed.',
}

/**
 * Is this address suppressed, on either list?
 *
 * Order matters only for the reason reported, not the outcome. The platform
 * list is read first because it is the one that carries a bounce learned
 * anywhere — including on a send that named no site — and that is the more
 * useful thing to tell a merchant who is about to retype the message.
 */
export async function replySuppression(
  hostId: string,
  email: string,
  firestore?: unknown,
): Promise<ReplyRefusal | null> {
  const key = emailSuppressionKey(email)
  // `emailSuppressionKey` returns null for an address it cannot key, and
  // `isEmailSuppressed` already answers `true` for that case. Treating it as
  // suppressed here keeps the two halves agreeing: an address we cannot key
  // is an address we cannot prove is safe to mail.
  if (!key) return 'suppressed-platform'
  if (await isEmailSuppressed(email, firestore)) return 'suppressed-platform'
  const db = (firestore ?? firebaseAdmin.app().firestore()) as any
  const doc = await db
    .collection('hosts')
    .doc(hostId)
    .collection('suppressions')
    .doc(key)
    .get()
  return doc.exists ? 'suppressed-host' : null
}

/**
 * Reply to one submission.
 *
 * Body: `{ hostId, submissionId, subject, message }`. The recipient is
 * deliberately absent — it is read off the stored submission, so this route
 * cannot be pointed at an address of the caller's choosing.
 */
export const inboxReplyHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const hostId = String(req.body?.hostId ?? '')
  const submissionId = String(req.body?.submissionId ?? '')
  const subject = String(req.body?.subject ?? '')
    .trim()
    .slice(0, REPLY_SUBJECT_MAX)
  const message = String(req.body?.message ?? '')
    .trim()
    .slice(0, REPLY_BODY_MAX)
  if (!hostId || !submissionId) {
    return res.status(400).json({ error: 'Missing hostId or submissionId' })
  }
  if (!subject || !message) {
    return res.status(400).json({ error: 'Missing subject or message' })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    // The address the reply goes back to, and the only thing that makes this
    // send worth making. A console account with no address on it would put
    // the customer's answer nowhere, so it refuses rather than sending a
    // message that invites a reply into a void.
    const replyTo = String(decoded.email ?? '')
    if (!replyTo) {
      return res.status(400).json({
        error:
          'Your account has no email address, so a reply would have nowhere to come back to.',
      })
    }

    const submissionRef = hostRef
      .collection('formSubmissions')
      .doc(submissionId)
    const submission = await submissionRef.get()
    if (!submission.exists) {
      return res.status(404).json({ error: 'Unknown submission' })
    }

    const fields = (submission.get('fields') ?? {}) as Record<string, unknown>
    const recipient = replyRecipient(fields)
    if ('refusal' in recipient) {
      return res
        .status(422)
        .json({ error: REFUSAL_MESSAGES[recipient.refusal], reason: recipient.refusal })
    }

    const suppressed = await replySuppression(hostId, recipient.email)
    if (suppressed) {
      return res
        .status(409)
        .json({ error: REFUSAL_MESSAGES[suppressed], reason: suppressed })
    }

    const siteName = String(
      hostSnapshot.get('displayName') ?? hostSnapshot.get('subdomain') ?? '',
    )
    const branding = resolveBrandingProfile(
      (await getOrgForHost(hostId).catch(() => null))?.org as never,
    )

    // No `html` is passed on purpose. `sendEmail` synthesizes the HTML part
    // from `text`, which is the single place that guarantee is enforced; a
    // hand-built one here would be a second place it can be forgotten.
    // No `priority` either: absent, it resolves to transactional, which the
    // platform governor may never refuse. That is the correct class — a reply
    // is a person answering a person, and it cannot be retried by a sweep.
    const result = await sendEmail({
      to: recipient.email,
      subject,
      text: composeReplyBody({ message, fields, siteName }),
      replyTo,
      fromName: branding.fromName,
      context: REPLY_CONTEXT,
    })

    if (!result.sent) {
      return res.status(502).json({
        error: 'The reply could not be sent.',
        reason: (result as { reason?: string }).reason ?? 'unknown',
      })
    }

    // Metered as transactional, so it enters the cost meter and never the
    // campaign meter a plan limit can refuse.
    void meterHostEmail(hostId, 1, 'transactional')

    const sentAtMs = Date.now()
    const replyRef = await submissionRef
      .collection(REPLIES_SUBCOLLECTION)
      .add({
        to: recipient.email,
        subject,
        // The merchant's own words, not the composed wire body. The quote and
        // the attribution line are rendered from the submission every time, so
        // storing them would be storing a copy of a document one field away.
        message,
        replyTo,
        fromName: branding.fromName,
        sentByUid: decoded.uid,
        providerMessageId: (result as { id?: string | null }).id ?? null,
        sentAtMs,
        createdAt: FieldValue.serverTimestamp(),
      })

    // A replied submission is a handled one, so it stops being unread in the
    // same write that records the reply. `repliedAtMs` is what the row reads;
    // the count of replies is a subcollection read the list must not make.
    await submissionRef.set(
      { read: true, repliedAtMs: sentAtMs },
      { merge: true },
    )

    return res.status(200).json({
      sent: true,
      replyId: replyRef.id,
      to: recipient.email,
      replyTo,
      sentAtMs,
    })
  } catch (error) {
    console.error('[inbox] reply failed', error)
    return res.status(500).json({ error: 'The reply could not be sent.' })
  }
}

/**
 * Console API registration.
 *
 * `inbox/reply` is deliberately NOT on the machine-path exemption list in
 * `plugin-api-rate-limit.ts`. It is reached by a person pressing Send in a
 * browser, so the visitor limiter's per-(site, IP) budget is far above any
 * real use of it and is the right ceiling for a surface that puts mail on
 * the wire.
 */
export function registerInboxConsoleApi(): void {
  registerPluginApiRoute('inbox/reply', inboxReplyHandler)
}
