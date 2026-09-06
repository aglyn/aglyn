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
  type AglynOrgBilling,
  type AglynOrgMember,
  buildCrmEmailActivity,
  checkCrmEmailQuota,
  contactCaptureHostIds,
  CRM_ACTIVITY_LOG_FULL_MESSAGE,
  CRM_COLLECTIONS,
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_CONTEXT,
  CRM_EMAIL_SUBJECT_MAX,
  type CrmActivityLink,
  crmActivityLogHasRoom,
  crmEmailDeliveryTags,
  crmScopeTokens,
  isOrgWideMember,
  normalizeContactEmail,
  type PluginApiHandler,
  type PluginApiRequest,
  type PluginApiResponse,
  readContactFacet,
  readMarketingBasis,
  visibleToHost,
} from '@aglyn/aglyn/server'
import {
  isEmailConfigured,
  sendEmail,
  sendFailureReason,
  type SendEmailResult,
} from '@aglyn/shared-util-email'
import {
  consentGroupForSite,
  consumeRateLimit,
  countCrmActivitiesForRecord,
  crmEmailsSentToday,
  filterSendableForHost,
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  logOrgActivity,
  memberHasOrgPermission,
  newCrmActivityRef,
  orgDataCollectionForHost,
  recordCrmEmailSend,
  recordEmailSends,
  resolveOrgMembership,
  writeCrmEmailActivity,
} from '@aglyn/tenant-data-admin'
import {
  authorizeOrgCaller,
  type CrmRouteScope,
  orgHostIds,
  readCrmRouteScope,
} from './org-caller'

/**
 * `POST /api/crm/email-send` — one email to one person, from their record
 * (AGL-2615).
 *
 * Body: `{ hostId, contactId? | leadId? | dealId?, subject, body }`. Answers
 * `{ ok: true, activityId, to, from, logged }` once the provider accepted
 * the message, and a refusal with a `reason` the dialog can act on
 * otherwise.
 *
 * ## What it is, and what it is not
 *
 * A message a teammate wrote to one person they have a relationship with —
 * a reply to a lead, a follow-up on a deal. It is not marketing: no
 * campaign audience, no unsubscribe pair, no frequency window, no consent
 * split. What it does owe is everything a bounce or a complaint owes the
 * shared sending domain, which is why BOTH suppression lists are consulted
 * and why a person's own stated refusal — a `declined` basis — is a hard
 * stop even though the message is not the kind of mail that basis governs.
 * The recipient asked this site not to write; the kind of writing is not
 * the point.
 *
 * ## Why the recipient is resolved here and not taken from the body
 *
 * The dialog shows the address the record carries, and this route reads it
 * again off the record the caller named, through the same visibility check
 * every other CRM route makes. A `to` in the body would make this a route
 * that sends the site's mail to any address a member types, which is a
 * different product with a different abuse surface.
 *
 * ## The organization variant (AGL-2634)
 *
 * `{ orgId, hostId?, … }` from the org-level hub. The caller is authorized
 * by the org — an org-wide member holding `data.manage` — and the record is
 * read with no site's visibility to check, because an org-wide member reads
 * every row. What the org level cannot do away with is the SITE the message
 * leaves from: the sending identity, the suppression list and the person's
 * stated refusal are each a site's. So the org variant still names one —
 * the record's own capturing site or the site the reader picked, in the
 * body; failing that the record's own site read off the document; failing
 * that the org's only site — and refuses, with a `site` reason, when the
 * org has several and none was named. The row it writes is visible to
 * whoever may see the RECORD, so an email to a person another site
 * captured shows on their timeline under that site's hub; the act is
 * logged in the org's feed.
 *
 * ## The order of the gates
 *
 * Cheap and certain first. A malformed body and a missing token cost
 * nothing; the per-user pace is one counter; the record is one read and
 * decides everything after it; the daily cap is one read; the ceiling one
 * aggregate; the two suppression lists two keyed reads; the sending
 * identity last, because it is the most expensive and the one a workspace
 * fixes once. Nothing is written until the provider has accepted the
 * message, and then three things are, none of which can fail the send: the
 * activity row, today's counter, and the org's cost meter.
 */

/** How many one-to-one emails one person may send in one minute. */
export const CRM_EMAIL_SENDS_PER_MINUTE = 20
const CRM_EMAIL_RATE_WINDOW_MS = 60_000

/** What the route says when the plan carries no one-to-one email at all. */
export const CRM_EMAIL_NOT_INCLUDED_MESSAGE =
  'Your plan does not include one-to-one email. Upgrade in Billing to email ' +
  'people from their records.'

/** What the route says at the daily cap; `included` is the plan's figure. */
export function crmEmailCapReachedMessage(included: number): string {
  return (
    `Today's one-to-one email limit (${included.toLocaleString('en-US')}) is ` +
    'reached. It resets at midnight UTC — see Billing for the count.'
  )
}

export const CRM_EMAIL_SUPPRESSED_MESSAGE =
  'This address has bounced or reported a message as spam, so it cannot be ' +
  'emailed.'

export const CRM_EMAIL_DECLINED_MESSAGE =
  'This person asked not to be emailed by this site.'

export const CRM_EMAIL_RATE_MESSAGE =
  'You have sent too many emails in the last minute. Wait a moment and try again.'

/** What the org variant says when no site was named and the org has several. */
export const CRM_EMAIL_PICK_SITE_MESSAGE =
  'Pick the site this email leaves from — its sending address is what the ' +
  'message is sent as.'

type Refusal = { ok: false; status: number; body: Record<string, unknown> }

const refuse = (
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): Refusal => ({ ok: false, status, body: { error, ...extra } })

/** One typed field, trimmed and bounded. */
function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

interface Sender {
  ok: true
  uid: string
  /** The address replies go to — the token's, never the body's. */
  email: string
  /** The name in front of the sending address, when the token carries one. */
  name: string
  orgId: string
  org: Partial<AglynOrgBilling>
}

/**
 * Who is sending, and whether they may: a verified ID token, then
 * `data.manage` on the site's org through the same three-layer read the
 * create route makes, admitted only for a site the member reaches. Staff
 * pass the permission check as they do on every CRM route, and send as
 * themselves.
 */
async function authorizeSender(
  req: PluginApiRequest,
  hostId: string,
): Promise<Sender | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse(401, 'Unauthenticated')
  let decoded: { uid: string; email?: string; name?: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return refuse(401, 'Unauthenticated')
  }
  const resolved = await getOrgForHost(hostId).catch(() => null)
  if (!resolved) return refuse(404, 'Unknown site')
  const { orgId } = resolved
  const org = (resolved.org ?? {}) as Partial<AglynOrgBilling>
  if (decoded.staff !== true) {
    const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
      () => null,
    )
    const member = (membership?.member ?? null) as Partial<AglynOrgMember> | null
    const reaches =
      isOrgWideMember(member) || Boolean(member?.hostAccess?.[hostId])
    const allowed =
      member &&
      reaches &&
      (await memberHasOrgPermission(orgId, member, 'data.manage'))
    if (!allowed) {
      return refuse(
        403,
        'Sending email from a record requires the data.manage permission on this site',
      )
    }
  }
  const email = normalizeContactEmail(decoded.email)
  if (!email) {
    // A reply-to is owed and the token is the only place it can honestly
    // come from; an account with no address cannot be replied to.
    return refuse(403, 'Your account has no email address to receive replies at.')
  }
  return {
    ok: true,
    uid: decoded.uid,
    email,
    name: typed(decoded.name, 120),
    orgId,
    org,
  }
}

/**
 * The org variant's sender (AGL-2634): authorized by the org for an
 * org-wide member holding `data.manage`, with the same reply-to rule.
 */
async function authorizeOrgSender(
  req: PluginApiRequest,
  orgId: string,
): Promise<Sender | Refusal> {
  const caller = await authorizeOrgCaller(req, orgId, {
    needs: 'data.manage',
    refusal:
      'Sending email at the organization level requires the data.manage ' +
      'permission across the whole workspace',
  })
  if (caller.ok === false) return refuse(caller.status, caller.error)
  const email = normalizeContactEmail(caller.email)
  if (!email) {
    return refuse(403, 'Your account has no email address to receive replies at.')
  }
  return {
    ok: true,
    uid: caller.uid,
    email,
    name: caller.name,
    orgId,
    org: caller.org as Partial<AglynOrgBilling>,
  }
}

interface Recipient {
  ok: true
  email: string
  /** The document the consent basis is read off — the contact, or the lead. */
  record: Record<string, unknown>
  /** The contact document, when one was read — where the company link is. */
  contact: Record<string, unknown> | null
  link: CrmActivityLink
  /**
   * The site the record itself names — a contact's first capturing site, a
   * deal's own, a lead's — which is the site an org-level send leaves from
   * when the body named none.
   */
  siteHint: string
}

/**
 * The person the named record is about, as THIS site may see them.
 *
 * A deal names its contact; a lead carries its own address; a contact is
 * itself. Each is looked up by id and then checked against what the site
 * may read — the Admin SDK evaluates no rules, and a member of site A must
 * not be able to mail site B's contact by guessing an id. The links the
 * activity is filed under are whatever resolved: a deal's email is also the
 * contact's, so it lands on both timelines.
 *
 * At the organization level there is no site to check against and none is
 * checked: the caller was admitted as an org-wide member, who reads every
 * row. A lead still needs its site named — a lead lives under one.
 */
async function resolveRecipient(
  firestore: FirebaseFirestore.Firestore,
  scope: CrmRouteScope,
  orgId: string,
  ids: { contactId: string; leadId: string; dealId: string },
): Promise<Recipient | Refusal> {
  const link: CrmActivityLink = {}
  const { hostId } = scope
  const scoped = scope.level === 'site'
  const visible = (tokens: unknown) =>
    !scoped || visibleToHost(tokens as readonly string[], hostId)
  let contactId = ids.contactId
  let siteHint = ''

  if (ids.dealId) {
    const deal = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection(CRM_COLLECTIONS.deals)
      .doc(ids.dealId)
      .get()
    if (!deal.exists || !visible(deal.get('visibleTo'))) {
      return refuse(404, 'Unknown deal')
    }
    link.dealId = deal.id
    siteHint = typed(deal.get('hostId'), 128)
    contactId = contactId || String(deal.get('contactId') ?? '').trim()
    if (!contactId) {
      return refuse(400, 'This deal names no contact to email.')
    }
  }

  if (contactId) {
    const contacts = scoped
      ? await orgDataCollectionForHost(hostId, 'contacts')
      : firestore.collection('orgs').doc(orgId).collection('contacts')
    const contact = await contacts.doc(contactId).get()
    if (!contact.exists || !visible(contact.get('visibleTo'))) {
      return refuse(404, 'Unknown contact')
    }
    const email = normalizeContactEmail(contact.get('email'))
    if (!email) return refuse(400, 'This contact has no email address.')
    const record = (contact.data() ?? {}) as Record<string, unknown>
    link.contactId = contact.id
    if (ids.leadId) link.leadId = ids.leadId
    siteHint =
      siteHint || typed(record['hostId'], 128) || contactCaptureHostIds(record)[0] || ''
    return { ok: true, email, record, contact: record, link, siteHint }
  }

  if (ids.leadId) {
    if (!hostId) return refuse(400, 'Name the site the lead lives under.')
    const lead = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('leads')
      .doc(ids.leadId)
      .get()
    if (!lead.exists) return refuse(404, 'Unknown lead')
    const email = normalizeContactEmail(lead.get('email'))
    if (!email) return refuse(400, 'This lead has no email address.')
    const record = (lead.data() ?? {}) as Record<string, unknown>
    link.leadId = lead.id
    // A converted lead's email belongs on the contact it became as well.
    const converted = String(lead.get('convertedContactId') ?? '').trim()
    if (converted) link.contactId = converted
    return { ok: true, email, record, contact: null, link, siteHint: hostId }
  }

  return refuse(400, 'Name a contact, lead or deal to email.')
}

/**
 * The site an org-level send leaves from (AGL-2634): the body's, else the
 * record's own, else the org's only site — and a refusal the dialog turns
 * into a Site picker when the org has several and none was named.
 */
async function resolveSendingSite(
  firestore: FirebaseFirestore.Firestore,
  scope: CrmRouteScope,
  orgId: string,
  siteHint: string,
): Promise<{ ok: true; hostId: string } | Refusal> {
  if (scope.hostId) return { ok: true, hostId: scope.hostId }
  if (siteHint) return { ok: true, hostId: siteHint }
  const hosts = await orgHostIds(firestore, orgId)
  if (hosts.length === 1) return { ok: true, hostId: hosts[0] }
  return refuse(409, CRM_EMAIL_PICK_SITE_MESSAGE, { reason: 'site' })
}

/** The HTTP shape of a send the provider did not accept. */
function sendRefusal(result: SendEmailResult): Refusal {
  const reason = sendFailureReason(result)
  const detail = String((result as { detail?: unknown }).detail ?? '')
  if (reason === 'unverified-domain') {
    return refuse(409, detail || 'This site has no verified sending identity.', {
      reason: 'sending-identity',
    })
  }
  if (reason === 'suppressed' || reason === 'unengaged') {
    return refuse(409, CRM_EMAIL_SUPPRESSED_MESSAGE, { reason: 'suppressed' })
  }
  if (reason === 'rate-limited') {
    const retryAtMs = Number((result as { retryAtMs?: unknown }).retryAtMs)
    return refuse(
      503,
      'The mail provider asked us to slow down. Try again in a minute.',
      {
        reason: 'provider-rate',
        retryAfterSeconds: Number.isFinite(retryAtMs)
          ? Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000))
          : 60,
      },
    )
  }
  if (reason === 'unconfigured') {
    return refuse(501, 'Email is not configured on this deployment.', {
      reason: 'unconfigured',
    })
  }
  return refuse(502, 'The email could not be sent.', { reason: 'send-failed' })
}

function answer(res: PluginApiResponse, refusal: Refusal): void {
  const retry = refusal.body['retryAfterSeconds']
  if (typeof retry === 'number') res.setHeader('Retry-After', String(retry))
  res.status(refusal.status).json(refusal.body)
}

export const crmEmailSendHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const routeScope = readCrmRouteScope(body)
  if (!routeScope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const ids = {
    contactId: typed(body['contactId'], 128),
    leadId: typed(body['leadId'], 128),
    dealId: typed(body['dealId'], 128),
  }
  if (!ids.contactId && !ids.leadId && !ids.dealId) {
    res.status(400).json({ error: 'Name a contact, lead or deal to email.' })
    return
  }
  const subject = typed(body['subject'], CRM_EMAIL_SUBJECT_MAX)
  if (!subject) {
    res.status(400).json({ error: 'Enter a subject.' })
    return
  }
  // Paragraphs are what the dialog offers, and a plain-text part is what a
  // paragraph is; line endings are normalized so the stored body and the
  // sent body are one string.
  const text = String(body['body'] ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, CRM_EMAIL_BODY_MAX)
  if (!text) {
    res.status(400).json({ error: 'Write the message.' })
    return
  }

  try {
    const sender =
      routeScope.level === 'org'
        ? await authorizeOrgSender(req, routeScope.orgId)
        : await authorizeSender(req, routeScope.hostId)
    if (sender.ok === false) return answer(res, sender)
    const { orgId, org } = sender

    /*
     * THE PER-USER PACE, on its own key. The console dispatcher already
     * counts this write against the person's general console budget; this
     * is the narrower bucket the feature owes — twenty a minute is a rep
     * writing, and past it is a script — keyed by the uid the token proved
     * so one person cannot spend the bucket of everyone on their address.
     */
    const rate = await consumeRateLimit(`crm-email-send:uid:${sender.uid}`, {
      limit: CRM_EMAIL_SENDS_PER_MINUTE,
      windowMs: CRM_EMAIL_RATE_WINDOW_MS,
    })
    if (!rate.allowed) {
      return answer(
        res,
        refuse(429, CRM_EMAIL_RATE_MESSAGE, {
          reason: 'rate',
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((rate.resetMs - Date.now()) / 1000),
          ),
        }),
      )
    }

    const firestore = firebaseAdmin.app().firestore()
    const recipient = await resolveRecipient(firestore, routeScope, orgId, ids)
    if (recipient.ok === false) return answer(res, recipient)
    // The site the message leaves from — the mounted one under a site, and
    // at the organization level whatever the body, the record or the org
    // can answer.
    const site = await resolveSendingSite(firestore, routeScope, orgId, recipient.siteHint)
    if (site.ok === false) return answer(res, site)
    const { hostId } = site
    const group = await consentGroupForSite(hostId, org as Record<string, unknown>)
    // The company the sending site files this person under, so the email
    // shows on the company's log as the automation step's rows do.
    if (recipient.contact) {
      const facet = readContactFacet(recipient.contact, group.groupId)
      if (facet.companyId) recipient.link.companyId = facet.companyId
    }

    // THE DAILY CAP (AGL-2611): today's counter, refused before a message
    // leaves — the contract on `checkCrmEmailQuota`.
    const quota = checkCrmEmailQuota(org, await crmEmailsSentToday(firestore, orgId))
    if (!quota.allowed) {
      return answer(
        res,
        refuse(
          409,
          quota.included > 0
            ? crmEmailCapReachedMessage(quota.included)
            : CRM_EMAIL_NOT_INCLUDED_MESSAGE,
          {
            reason: 'quota',
            included: quota.included,
            used: quota.used,
            resetsAtMs: quota.resetsAt.getTime(),
          },
        ),
      )
    }

    // The per-record ceiling, before the send: an email that could not be
    // logged would be a message the timeline never shows, and the timeline
    // is the reason the send lives on the record.
    const orgRef = firestore.collection('orgs').doc(orgId)
    if (!crmActivityLogHasRoom(await countCrmActivitiesForRecord(orgRef, recipient.link))) {
      return answer(res, refuse(409, CRM_ACTIVITY_LOG_FULL_MESSAGE, { reason: 'ceiling' }))
    }

    // Both suppression lists, then the person's own refusal.
    const sendable = await filterSendableForHost(hostId, [recipient.email])
    if (!sendable.length) {
      return answer(res, refuse(409, CRM_EMAIL_SUPPRESSED_MESSAGE, { reason: 'suppressed' }))
    }
    if (readMarketingBasis(recipient.record, group).basis === 'declined') {
      return answer(res, refuse(409, CRM_EMAIL_DECLINED_MESSAGE, { reason: 'declined' }))
    }

    if (!isEmailConfigured()) {
      return answer(
        res,
        refuse(501, 'Email is not configured on this deployment.', {
          reason: 'unconfigured',
        }),
      )
    }
    const identity = await hostSendingIdentity(hostId)
    if (identity.refusal) {
      return answer(
        res,
        refuse(409, identity.refusal.message, { reason: 'sending-identity' }),
      )
    }

    // The row's id, minted before the send so the delivery webhook can find
    // it from the tags alone; written only once the message has left.
    const activityRef = newCrmActivityRef(firestore, orgId)
    const result = await sendEmail({
      to: recipient.email,
      subject,
      text,
      sendingIdentity: identity,
      audience: 'tenant',
      context: CRM_EMAIL_CONTEXT,
      replyTo: sender.email,
      ...(sender.name ? { fromName: sender.name } : {}),
      tags: crmEmailDeliveryTags({ orgId, hostId, activityId: activityRef.id }),
    })
    if (!result.sent) return answer(res, sendRefusal(result))

    const sentAtMs = Date.now()
    let logged = true
    /*
     * Who may list the row. Under a site, what a record created there is
     * stamped with. At the organization level the RECORD's own tokens, so
     * an email to a person another site captured shows on their timeline
     * under that site's hub — a row stamped with the sending site alone
     * would be invisible where the person is read.
     */
    const recordTokens = recipient.record['visibleTo']
    const visibleTo =
      routeScope.level === 'org' && Array.isArray(recordTokens) && recordTokens.length
        ? recordTokens.map(String)
        : crmScopeTokens(org as Record<string, unknown>, group)
    try {
      await writeCrmEmailActivity(
        activityRef,
        buildCrmEmailActivity({
          subject,
          body: text,
          to: recipient.email,
          atMs: sentAtMs,
          byUid: sender.uid,
          ...(sender.name ? { byName: sender.name } : {}),
          link: recipient.link,
          hostId,
          visibleTo,
        }),
      )
    } catch (error) {
      // The message has left. A row that could not be written is a gap on
      // the timeline, not a failed send, and it is said so in the answer.
      console.error('[crm] email activity write failed', orgId, activityRef.id, error)
      logged = false
    }
    // The count enforced is the count billed — one document for the cap and
    // the org's cost meter for COGS, both after delivery and neither able
    // to fail the send.
    await recordCrmEmailSend(firestore, orgId)
    await recordEmailSends({
      scope: { kind: 'org', orgId },
      count: 1,
      sendClass: 'transactional',
      firestore,
    })
    // The org-level act, in the org's feed: the site variant's is the
    // timeline row itself, under the site the record page is on.
    if (routeScope.level === 'org') {
      await logOrgActivity(
        orgId,
        { uid: sender.uid, email: sender.email },
        'Sent email',
        recipient.link.contactId
          ? { type: 'contact', id: recipient.link.contactId, name: recipient.email }
          : { type: 'lead', id: recipient.link.leadId, name: recipient.email },
      )
    }
    res.status(200).json({
      ok: true,
      activityId: activityRef.id,
      to: recipient.email,
      from: identity.from,
      logged,
    })
  } catch (error) {
    console.error('[crm] email-send failed', routeScope, error)
    res.status(500).json({ error: 'The email could not be sent.' })
  }
}

export default crmEmailSendHandler
