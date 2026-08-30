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
 * The Inbox's two acts on the person who sent a submission: answer them, and
 * put them on a marketing list.
 *
 * `POST inbox/reply` sends one message. `POST inbox/assign-list` enrolls, and
 * `POST inbox/list-options` tells the merchant what they may do before they
 * do it.
 *
 * ## The two acts are kept apart everywhere
 *
 * A reply is TRANSACTIONAL — the person asked to be contacted by submitting
 * the form, and answering them is the transaction they started. A list is
 * MARKETING — a standing invitation to mail them about things they never
 * asked about. So they are separate routes, separate records and separate
 * cards on screen, and neither is a side effect of the other: replying
 * enrolls nobody and writes no consent, and enrolling sends nothing and
 * meters nothing. Folding either into the other would make a merchant's
 * ordinary act of answering a customer into an act with consequences they
 * did not choose. The enrollment rule itself is
 * `model/list-assignment-policy.ts`.
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
  isOrgWideMember,
  readMarketingBasis,
  registerPluginApiRoute,
  resolveBrandingProfile,
  type MarketingConsentRecord,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  emailSuppressionKey,
  enrollListMember,
  firebaseAdmin,
  getOrgForHost,
  isEmailSuppressed,
  meterHostEmail,
  orgDataCollectionForHost,
  resolveOrgMembership,
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
import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentBasis,
  assignmentReadout,
  type AssignmentRefusal,
} from './model/list-assignment-policy'

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
 *
 * Named for the ADDRESS rather than for either act, because both use it: a
 * reply must not go to a dead or complaining mailbox, and a list enrollment
 * must not put one on a standing audience. A second copy for the second act
 * would be two answers to "may this address be mailed".
 */
export async function addressSuppression(
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

    const suppressed = await addressSuppression(hostId, recipient.email)
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

/** Where an assignment is recorded, under the submission that occasioned it. */
export const LIST_ASSIGNMENTS_SUBCOLLECTION = 'listAssignments'

/** The `source` stamped on a member enrolled from the Inbox. */
export const ASSIGNMENT_SOURCE = 'inbox'

/**
 * How many lists the picker offers.
 *
 * A ceiling on the READ, so a merchant with an unusual number of lists costs
 * one bounded query rather than a scan, and the response says when it is a
 * floor rather than presenting a slice as the whole set.
 */
export const LIST_OPTIONS_LIMIT = 100

/** Everything both list-assignment handlers need, or the refusal to send. */
type AssignmentContext =
  | {
      ok: true
      uid: string
      orgId: string
      firestore: FirebaseFirestore.Firestore
      submissionRef: FirebaseFirestore.DocumentReference
      email: string
    }
  | { ok: false; status: number; body: Record<string, unknown> }

/**
 * Who is asking, about which submission, and for which person.
 *
 * ## Two gates, not one
 *
 * A host role is necessary and NOT sufficient. Lists live at
 * `orgs/{orgId}/lists` and their members are contacts, so the security rules
 * put both behind `isOrgWideMember()` — an editor invited to ONE site is an
 * org member with `allHosts: false`, and gating an org-wide write on the host
 * role alone would let a single-site collaborator enroll people into an
 * audience every other site in the org can mail. The Admin SDK evaluates no
 * rules, so this route is the enforcement rather than an echo of it.
 *
 * ## The address is read off the submission
 *
 * Through `replyRecipient`, the same resolver the reply and the Inbox row use.
 * A `to` in the request body would let a site editor enroll an address of
 * their choosing into a marketing audience, which is the same defect the
 * reply handler refuses for the same reason.
 */
async function resolveAssignmentContext(
  req: Parameters<PluginApiHandler>[0],
): Promise<AssignmentContext> {
  const hostId = String(req.body?.hostId ?? '')
  const submissionId = String(req.body?.submissionId ?? '')
  if (!hostId || !submissionId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Missing hostId or submissionId' },
    }
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return { ok: false, status: 401, body: { error: 'Unauthenticated' } }
  }

  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown site' } }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Not a site admin or editor' },
    }
  }

  const orgId = String((await getOrgForHost(hostId).catch(() => null))?.orgId ?? '')
  if (!orgId) {
    return {
      ok: false,
      status: 404,
      body: { error: 'This site has no organization, so it has no lists.' },
    }
  }
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  const member = membership?.member
  const orgWideWriter =
    isOrgWideMember(member) &&
    (member?.role === 'owner' ||
      member?.role === 'admin' ||
      member?.role === 'editor') &&
    (member as { orgSuspended?: boolean } | undefined)?.orgSuspended !== true
  if (!orgWideWriter) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          'Marketing lists belong to the whole organization, so adding ' +
          'someone to one needs organization-wide access rather than access ' +
          'to this site.',
      },
    }
  }

  const submissionRef = hostRef.collection('formSubmissions').doc(submissionId)
  const submission = await submissionRef.get()
  if (!submission.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown submission' } }
  }
  const recipient = replyRecipient(
    (submission.get('fields') ?? {}) as Record<string, unknown>,
  )
  if ('refusal' in recipient) {
    return {
      ok: false,
      status: 422,
      body: {
        error: ASSIGNMENT_REFUSAL_MESSAGES[recipient.refusal],
        reason: recipient.refusal,
      },
    }
  }

  return {
    ok: true,
    uid: decoded.uid,
    orgId,
    firestore,
    submissionRef,
    email: recipient.email,
  }
}

/**
 * The person's own consent facts, read off the org contact for this address.
 *
 * The CRM record is where a refusal lives: `marketingConsent` is written
 * `false` by exactly one path in the product and it writes a contact. So this
 * is the read that makes `declined` mean something at enrollment time, and an
 * absent contact is honestly `unrecorded` rather than a reason to guess.
 *
 * Read UNSCOPED, deliberately. `scopedToHost` narrows an org collection to
 * what one site may see, and a refusal filtered out by that narrowing is a
 * refusal this route would then step over — the failure mode is mailing
 * somebody who said no. It is safe here because the caller has already been
 * proved an org-wide member, which is the tier the rules grant the whole
 * org's contacts to.
 */
async function storedConsentForAddress(
  hostId: string,
  email: string,
): Promise<MarketingConsentRecord> {
  try {
    const contacts = await orgDataCollectionForHost(hostId, 'contacts')
    const found = await contacts.where('email', '==', email).limit(1).get()
    return readMarketingBasis(
      found.empty
        ? null
        : (found.docs[0].data() as Record<string, unknown>),
    )
  } catch (error) {
    console.error('[inbox] consent lookup failed', error)
    /*
     * FAILS TO `declined`, which reads oddly until you name the alternative.
     * A throwing read cannot say the person consented and cannot say they
     * refused; the question is which way the unknown should fall. `unrecorded`
     * would leave the attestation control on screen and let the merchant add
     * somebody whose stored refusal this route simply failed to see, and no
     * later surface would ever revisit it. A refusal costs a retry.
     */
    return { basis: 'declined', basisAtMs: null, capturedAtMs: null }
  }
}

/**
 * `POST inbox/list-options` — what the merchant may do with this sender.
 *
 * Reads only. It exists because the answer needs three things the browser
 * cannot have: the org's lists (rules put them behind org-wide membership,
 * which the acting console session may not hold), the person's consent record
 * (an org contact, same gate), and both suppression lists. Computing any of
 * it client-side would be a second copy of the rule, on the surface whose
 * whole job is to tell the merchant the truth about what is about to happen.
 *
 * Reached by an explicit expansion in the reader, never on mount: it is three
 * reads and a bounded query, and paying them once per opened submission would
 * charge every merchant who never touches lists.
 */
export const inboxListOptionsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const context = await resolveAssignmentContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const hostId = String(req.body?.hostId ?? '')

    const suppression = await addressSuppression(hostId, context.email)
    const stored = await storedConsentForAddress(hostId, context.email)
    const readout = assignmentReadout({ stored, suppression })

    const listsRef = context.firestore
      .collection('orgs')
      .doc(context.orgId)
      .collection('lists')
    /*
     * Ordered by document id, which is the one key every list has.
     * `limit()` alone answers in that order anyway but does not SAY so, and a
     * page of results whose order is an implementation detail is the shape
     * that turned an audience into a random sample. Ordering by `name` would
     * be worse than either: `orderBy` drops documents missing the field, so a
     * list created without a name would vanish from its own picker.
     */
    const snapshot = await listsRef
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .limit(LIST_OPTIONS_LIMIT + 1)
      .get()
    const lists = snapshot.docs
      .slice(0, LIST_OPTIONS_LIMIT)
      .map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
        id: doc.id,
        name: String(doc.get('name') ?? doc.id),
      }))

    return res.status(200).json({
      to: context.email,
      lists,
      listsTruncated: snapshot.docs.length > LIST_OPTIONS_LIMIT,
      basis: stored.basis,
      basisAtMs: stored.basisAtMs,
      ...readout,
    })
  } catch (error) {
    console.error('[inbox] list options failed', error)
    return res.status(500).json({ error: 'The lists could not be read.' })
  }
}

/**
 * `POST inbox/assign-list` — put this sender on a marketing list.
 *
 * Body: `{ hostId, submissionId, listId, attestConsent? }`. `attestConsent` is
 * the merchant STATING that they have this person's permission; it is not a
 * way to name a basis, because the pass-through basis is derived server-side
 * from the person's own record.
 *
 * ## What this act is, and what it is not
 *
 * It is marketing enrollment: the only consumer of a list is a campaign. It
 * is therefore kept entirely separate from the reply — different route,
 * different card in the UI, different record — and replying enrolls nobody.
 * The reverse holds too: enrolling somebody sends them nothing, meters
 * nothing, and is not a promise that they are still mailable when a campaign
 * eventually runs. Suppression is consulted again at send time, in
 * `filterSendableForHost`, because an address can be suppressed the day after
 * it is enrolled and an enrollment-time check that licensed every later send
 * would be a check that passes once and pays out forever.
 */
export const inboxAssignListHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listId = String(req.body?.listId ?? '')
  if (!listId) return res.status(400).json({ error: 'Missing listId' })
  const attested = req.body?.attestConsent === true

  try {
    const context = await resolveAssignmentContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const hostId = String(req.body?.hostId ?? '')

    const refuse = (status: number, reason: AssignmentRefusal) =>
      res
        .status(status)
        .json({ error: ASSIGNMENT_REFUSAL_MESSAGES[reason], reason })

    const suppressed = await addressSuppression(hostId, context.email)
    if (suppressed) return refuse(409, suppressed)

    const listRef = context.firestore
      .collection('orgs')
      .doc(context.orgId)
      .collection('lists')
      .doc(listId)
    const listSnapshot = await listRef.get()
    // A stale or mistyped id must not CREATE a list: a campaign's `list`
    // audience would then read a list nobody set up.
    if (!listSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown list' })
    }

    const stored = await storedConsentForAddress(hostId, context.email)
    const nowMs = Date.now()
    const decision = assignmentBasis({
      stored,
      attested,
      actingUid: context.uid,
      nowMs,
    })
    if ('refusal' in decision) {
      // 409 for a refusal that no answer can change, 422 for the one the
      // merchant can answer by asserting a basis. The distinction is what
      // lets the UI offer the attestation control on exactly one of them.
      return refuse(decision.refusal === 'declined' ? 409 : 422, decision.refusal)
    }

    const enrollment = await enrollListMember({
      listRef,
      email: context.email,
      source: ASSIGNMENT_SOURCE,
      // Never `'rule'`: the dynamic-list materializer reconciles its own rows
      // away when a person stops matching, and a decision somebody made by
      // hand is not a rule match that lapsed.
      via: 'manual',
      consent: decision,
    })
    if (enrollment.enrolled === false) {
      /*
       * The membership itself records a refusal that the CRM record did not.
       * `enrollListMember` is the only writer of the collection and holds the
       * row, so it is the backstop for every enrollment route; reaching it
       * here means the two records disagree, and the refusal wins.
       */
      return refuse(409, enrollment.refusal === 'declined' ? 'declined' : 'no-address')
    }

    /*
     * The attestation trail, beside the reply record and for the same reason:
     * a support question about a marketing list starts with "who put this
     * person on it, and on what basis". The member document carries the basis
     * so the send-time join can read it; this carries the same facts where
     * the act happened, which is the only place that survives the person
     * later being removed from the list.
     */
    await context.submissionRef
      .collection(LIST_ASSIGNMENTS_SUBCOLLECTION)
      .add({
        to: context.email,
        listId,
        listName: String(listSnapshot.get('name') ?? listId),
        memberId: enrollment.memberId,
        basis: decision.basis,
        basisAtMs: decision.atMs,
        assertedByUid: decision.byUid,
        addedByUid: context.uid,
        addedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
      })

    return res.status(200).json({
      enrolled: true,
      to: context.email,
      listId,
      listName: String(listSnapshot.get('name') ?? listId),
      memberId: enrollment.memberId,
      basis: decision.basis,
    })
  } catch (error) {
    console.error('[inbox] list assignment failed', error)
    return res.status(500).json({ error: 'The list assignment failed.' })
  }
}

/**
 * Console API registration.
 *
 * None of these is on the machine-path exemption list in
 * `plugin-api-rate-limit.ts`. Each is reached by a person pressing a button in
 * a browser, so the visitor limiter's per-(site, IP) budget is far above any
 * real use of them and is the right ceiling for surfaces that put mail on the
 * wire or a person into a marketing audience.
 */
export function registerInboxConsoleApi(): void {
  registerPluginApiRoute('inbox/reply', inboxReplyHandler)
  registerPluginApiRoute('inbox/list-options', inboxListOptionsHandler)
  registerPluginApiRoute('inbox/assign-list', inboxAssignListHandler)
}
