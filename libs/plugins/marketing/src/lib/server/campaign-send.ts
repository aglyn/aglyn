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
  checkQuota,
  contactMatchesSegment,
  createResourceUid,
  decodeStoredNodes,
  resolveBrandingProfile,
  visibleToHost,
} from '@aglyn/aglyn/server'
import { renderEmailHtml, resolveMergeTags, type EmailRenderProduct } from '@aglyn/plugins-email/model'
import { assignExperimentVariant, type HostExperiment } from '../model'
import { productPriceRange } from '@aglyn/plugins-commerce/model'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  campaignEmailSendsForMonth,
  orgDataCollectionForHost,
  orgDataQueryForHost,
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { createHash, createHmac } from 'crypto'
import {
  EMAIL_NODE_ROOT_ID,
  isEmailConfigured,
  sendEmail,
} from '@aglyn/shared-util-email'

const MAX_RECIPIENTS_PER_SEND = 500
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Stable doc id for a suppression entry (emails are PII — hash them). */
export function suppressionId(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex')
}

/** HMAC for unsubscribe links; env-gated on the shared secret. */
export function unsubscribeSignature(
  hostId: string,
  email: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${hostId}:${email.toLowerCase()}`)
    .digest('hex')
}

/** Send failures carry the HTTP status the API route should answer. */
export class CampaignSendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export interface CampaignSendOptions {
  hostId: string
  subject: string
  body: string
  audience: string
  segmentId?: string
  listId?: string
  /**
   * Resolve the audience and return the count WITHOUT sending anything
   * (AGL-2178). Returns before the first write, so it mints no campaign
   * id and touches no counter.
   */
  dryRun?: boolean
  emails?: string[]
  campaignId?: string
  experimentId?: string
  /**
   * Designed email template (AGL-349): screen id of a besigner email
   * document. When set, the render pipeline produces the HTML body and
   * `body` becomes the plain-text fallback.
   */
  templateScreenId?: string
  /** Test sends (AGL-349) skip the campaign record and stats. */
  recordCampaign?: boolean
  /** Recorded as `sentBy`; the scheduler passes the scheduling user. */
  senderUid: string
}

/**
 * Loads a designed email template's nodes + referenced products for the
 * render pipeline. Throws 400 when the screen isn't an email document.
 */
async function loadEmailTemplate(hostId: string, screenId: string) {
  const firestore = firebaseAdmin.app().firestore()
  const screenRef = firestore
    .collection('hosts')
    .doc(hostId)
    .collection('screens')
    .doc(screenId)
  const screenSnapshot = await screenRef.get()
  if (!screenSnapshot.exists) {
    throw new CampaignSendError('Unknown email template', 400)
  }
  const versionId = screenSnapshot.get('versionId')
  const versionSnapshot = versionId
    ? await screenRef.collection('versions').doc(String(versionId)).get()
    : null
  /**
   * Decoded, because a `kind: 'email'` screen is a SCREEN document and its
   * versions are compressed msgpack `Bytes` from the first designer save
   * onward (AGL-1394). `createEmailScreen` writes it under
   * `hosts/{h}/screens/{id}` and the Emails list opens it in the SCREEN
   * besigner, which saves through `use-screen-version`'s converter —
   * `Bytes.fromUint8Array(compress(nodes))`. Only the very first version,
   * seeded from a JSON body through `/api/hosts/versions`, is a plain map.
   *
   * `publish-email-template.ts` reading `nodes` raw is not evidence that this
   * one may: that reads `emailTemplates`, a different collection whose
   * besigner saves with a bare `setDoc` and no converter.
   *
   * The guard below is why this was silent rather than loud. `Object.keys` of
   * a Buffer yields the byte INDICES, so a compressed version read as a
   * populated template, `Object.values` found no `emailProduct` node, and a
   * designed campaign went out to real customer inboxes with its product
   * blocks missing — discovered by the recipients. Decoding first is also what
   * makes the guard mean something: `decodeStoredNodes` returns null for an
   * undecodable payload, so the send is refused instead of mailed empty.
   */
  const nodes = (decodeStoredNodes(versionSnapshot?.get('nodes')) ??
    {}) as Record<string, any>
  if (!Object.keys(nodes).length) {
    throw new CampaignSendError('The email template is empty', 400)
  }
  // Resolve emailProduct references (by id — rename-safe, AGL-343).
  const productIds = [
    ...new Set(
      Object.values(nodes)
        .filter((node: any) => node?.componentId === 'emailProduct')
        .map((node: any) => String(node?.props?.productId ?? ''))
        // AGL-1771: a besigner node prop is merchant-authored and reaches
        // `.doc()` below, where a slash-bearing value throws and turns the
        // whole send into a 500. Dropped rather than refused: the block simply
        // resolves to no product, exactly as it does for a deleted one, and a
        // designed campaign is not worth blocking over one bad reference.
        .filter(isDocumentId),
    ),
  ].slice(0, 20)
  const products: Record<string, EmailRenderProduct> = {}
  await Promise.all(
    productIds.map(async (productId) => {
      const productSnapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('products')
        .doc(productId)
        .get()
      if (!productSnapshot.exists) return
      const data = productSnapshot.data() as any
      const [minPrice] = productPriceRange(data)
      products[productId] = {
        name: String(data.name ?? productId),
        priceLabel: minPrice ? `$${minPrice}` : undefined,
        imageUrl: data.imageUrl ?? data.mediaUrls?.[0],
        url: data.slug ? `/products/${data.slug}` : undefined,
      }
    }),
  )
  return {
    nodes,
    products,
    subject: String(screenSnapshot.get('emailSubject') ?? ''),
    preheader: String(screenSnapshot.get('emailPreheader') ?? ''),
  }
}

/**
 * Campaign delivery core (AGL-161, extracted for AGL-272): resolves the
 * audience server-side, drops suppressed addresses, enforces the plan's
 * monthly send cap, personalizes merge tags per recipient, and delivers
 * through Resend with a signed unsubscribe link. Shared by the
 * authenticated send route and the scheduled-campaign processor. The
 * caller owns authorization.
 */
export async function performCampaignSend(
  options: CampaignSendOptions,
): Promise<{
  campaignId: string
  recipients: number
  sent: number
  /** Dry run only (AGL-2178): recipients left after the suppression list. */
  sendable?: number
  /** Dry run only: how many of `recipients` have unsubscribed. */
  suppressed?: number
  dryRun?: boolean
}> {
  const unsubscribeSecret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!isEmailConfigured() || !unsubscribeSecret) {
    throw new CampaignSendError(
      'Campaigns are not configured (RESEND_API_KEY, USAGE_EMAIL_FROM, ' +
        'EMAIL_UNSUBSCRIBE_SECRET).',
      501,
    )
  }
  const { hostId, subject, body, audience } = options

  // AGL-1771: every optional id on `options` becomes a `.doc()` argument
  // below, and `.doc()` appends a SLASH-SEPARATED path rather than taking one
  // opaque id — so an unvalidated one names the nesting as well as the
  // document. `campaignId` is the one that matters most: it is WRITTEN at the
  // bottom of this function, so `a/b/c` filed the campaign at
  // `campaigns/a/b/c`, beneath a document that does not exist and therefore
  // invisible to the merchant's own campaigns list — and it is the same value
  // that comes back on every Resend tag days later (AGL-1768), which is why
  // tracing where an id was MINTED matters more than where it was last
  // handled. The rest are read-only, where the cost is a 500 dressed up as an
  // outage rather than a stray document; refused here so the caller is told
  // which id was wrong.
  //
  // `hostId` is deliberately NOT guarded here, and that is measured rather
  // than overlooked: both callers prove it first — the handler resolves the
  // host document and checks the caller's role on it before calling in, and
  // the scheduled processor passes `hostRef.id` off a document it just read. A
  // guard here could not fail today. A third caller would need to earn that.
  for (const [name, value] of [
    ['campaignId', options.campaignId],
    ['experimentId', options.experimentId],
    ['templateScreenId', options.templateScreenId],
    ['segmentId', options.segmentId],
    ['listId', options.listId],
  ] as const) {
    if (value && !isDocumentId(value)) {
      throw new CampaignSendError(`Invalid ${name}`, 400)
    }
  }

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    throw new CampaignSendError('Unknown site', 404)
  }

  // Audience resolution. Names ride along for merge tags (AGL-272).
  let recipients: string[] = []
  const names = new Map<string, string>()
  const collectName = (email: string, name: unknown) => {
    const cleaned = email.trim().toLowerCase()
    if (cleaned && typeof name === 'string' && name.trim()) {
      names.set(cleaned, name.trim())
    }
  }
  if (audience === 'leads') {
    const leads = await hostRef.collection('leads').limit(1000).get()
    recipients = leads.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      collectName(email, doc.get('name'))
      return email
    })
  } else if (audience === 'members') {
    const members = await hostRef.collection('siteMembers').limit(1000).get()
    recipients = members.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      collectName(email, doc.get('name'))
      return email
    })
  } else if (audience === 'segment') {
    // Contact segments (AGL-199): resolve the saved filter against the
    // contacts collection server-side.
    const segmentId = String(options.segmentId ?? '')
    const segmentSnapshot = segmentId
      ? await (await orgDataCollectionForHost(hostId, 'contactSegments')).doc(segmentId).get()
      : null
    // A doc get cannot carry the scope filter, so check after the read
    // (AGL-1039). Reported as "unknown" rather than "forbidden": whether a
    // segment exists in another site's scope is not this caller's business.
    if (
      !segmentSnapshot?.exists ||
      !visibleToHost(segmentSnapshot.get('visibleTo'), hostId)
    ) {
      throw new CampaignSendError('Unknown segment', 400)
    }
    const segment = {
      tags: segmentSnapshot.get('tags') ?? [],
      sources: segmentSnapshot.get('sources') ?? [],
    }
    // Scoped (AGL-1039): a campaign sent from one site must not reach
    // another site's audience — the agency case is a client's campaign
    // blasting the whole org's contact list.
    const contacts = await (
      await orgDataQueryForHost(hostId, 'contacts')
    ).query.limit(5000).get()
    recipients = contacts.docs
      .filter((doc) =>
        contactMatchesSegment(
          { tags: doc.get('tags') ?? [], sources: doc.get('sources') ?? {} },
          segment,
        ),
      )
      .map((doc) => {
        const email = String(doc.get('email') ?? '')
        collectName(email, doc.get('name'))
        return email
      })
  } else if (audience === 'list') {
    // Org lists (AGL-254): static audiences enrolled manually or by the
    // enrollList automation step.
    const listId = String(options.listId ?? '')
    const listRef = listId
      ? (await orgDataCollectionForHost(hostId, 'contacts')).parent
          ?.collection('lists')
          .doc(listId)
      : null
    if (!listRef) throw new CampaignSendError('Unknown list', 400)
    const members = await listRef.collection('members').limit(5000).get()
    recipients = members.docs.map((doc) => {
      const email = String(doc.get('email') ?? '')
      collectName(email, doc.get('name'))
      return email
    })
  } else {
    recipients = Array.isArray(options.emails)
      ? options.emails.map((value: unknown) => String(value))
      : []
  }
  recipients = [
    ...new Set(
      recipients
        .map((email) => email.trim().toLowerCase())
        .filter((email) => EMAIL_PATTERN.test(email)),
    ),
  ].slice(0, MAX_RECIPIENTS_PER_SEND)
  if (!recipients.length) {
    throw new CampaignSendError('The audience is empty', 400)
  }

  // Suppression list (unsubscribes).
  const suppressed = new Set<string>()
  const suppressions = await hostRef
    .collection('suppressions')
    .limit(5000)
    .get()
  for (const doc of suppressions.docs) suppressed.add(doc.id)
  const sendable = recipients.filter(
    (email) => !suppressed.has(suppressionId(email)),
  )
  if (!sendable.length) {
    throw new CampaignSendError('Every recipient has unsubscribed', 400)
  }

  // Monthly cap by the owning org's plan (dark-launch rule, AGL-238).
  //
  // A campaign is the ONLY send a quota may refuse (AGL-1438). It is
  // discretionary — the customer sees a clear message, and upgrades or waits —
  // where refusing a receipt or a password reset would convert a billing event
  // into an outage on their business. So this is measured against
  // `campaignEmailSends` and NOT against `emailSends`, which since AGL-1438
  // also carries every order confirmation, booking reminder and workflow
  // notification the site sent. Enforcing the campaign cap against that total
  // would refuse a campaign because the store had a busy week of orders.
  const monthKey = new Date().toISOString().slice(0, 7)
  {
    // Plan-less orgs resolve as free (AGL-247) — the cap always runs.
    const org = (await getOrgForHost(hostId))?.org
    const used = await campaignEmailSendsForMonth(hostRef, monthKey)
    const quota = checkQuota(
      org as any,
      'emailSendsPerMonth',
      used + sendable.length - 1,
    )
    if (!quota.allowed) {
      throw new CampaignSendError(
        `Monthly campaign email limit reached (${quota.limit}) — upgrade ` +
          'in Billing or shrink the audience. Transactional mail — receipts, ' +
          'booking reminders, password resets — keeps sending.',
        403,
      )
    }
  }

  /*
   * Recipient PREVIEW (AGL-2178). The campaign composer mockup shows
   * `Recipients 1,240` beside the audience picker, and the console had no
   * count before a send at all — the number appeared afterwards, in a
   * snackbar.
   *
   * It returns from HERE rather than from a counting function of its own,
   * and that is the whole point: the figure has already been through
   * audience resolution, normalisation, de-duplication, the
   * `MAX_RECIPIENTS_PER_SEND` cap, the suppression list and the monthly
   * quota. A second implementation would be a second set of rules to
   * drift, and the one number a merchant checks before pressing Send is
   * the worst possible place for an estimate that disagrees with what
   * happens.
   *
   * Nothing has been written above this line — every step so far is a
   * read — so an early return here leaves no campaign document, no
   * counter and no id behind.
   */
  if (options.dryRun) {
    return {
      campaignId: '',
      recipients: recipients.length,
      sendable: sendable.length,
      suppressed: recipients.length - sendable.length,
      sent: 0,
      dryRun: true,
    }
  }

  const subdomain = hostSnapshot.get('subdomain')
  const siteBase = hostSnapshot.get('cname')
    ? `https://${hostSnapshot.get('cname')}`
    : `https://${subdomain}.aglyn.app`

  // White-label sender identity (White-Label Phase 3): a campaign sent from a
  // white-label store reads as that store's brand. Resolved once for the whole
  // batch from the owning org doc through the one shared resolver.
  const branding = resolveBrandingProfile(
    (await getOrgForHost(hostId).catch(() => null))?.org as never,
  )

  const campaignId = options.campaignId || createResourceUid()

  // Designed email template (AGL-349): loaded once; rendered per
  // recipient with their merge values.
  const template = options.templateScreenId
    ? await loadEmailTemplate(hostId, options.templateScreenId)
    : null

  // Email A/B (AGL-255): each recipient deterministically lands in a
  // variant whose subject/body overrides apply; sends count as that
  // variant's exposures. A finished experiment sends the winner copy.
  const experimentId = String(options.experimentId ?? '')
  let experiment: (HostExperiment & { $id: string }) | null = null
  if (experimentId) {
    const experimentSnapshot = await hostRef
      .collection('experiments')
      .doc(experimentId)
      .get()
    const data = experimentSnapshot.data() as HostExperiment | undefined
    if (
      !experimentSnapshot.exists ||
      !data ||
      data.target !== 'email' ||
      (data.status !== 'running' && !data.winnerVariantId)
    ) {
      throw new CampaignSendError('Pick a running email experiment', 400)
    }
    experiment = { $id: experimentSnapshot.id, ...data }
  }
  const variantSends: Record<string, number> = {}
  let sent = 0
  for (const email of sendable) {
    const signature = unsubscribeSignature(hostId, email, unsubscribeSecret)
    const unsubscribeUrl =
      `${siteBase}/api/email/unsubscribe?hostId=${encodeURIComponent(hostId)}` +
      `&email=${encodeURIComponent(email)}&sig=${signature}`
    // Variant assignment keys on the recipient address (AGL-255) so a
    // re-send reaches the same variant.
    const variant = experiment
      ? assignExperimentVariant(experiment, experiment.$id, email)
      : null
    // Merge tags (AGL-272): personalize after the variant override so
    // variant copy can use tags too.
    const mergeRecipient = { email, name: names.get(email) }
    const recipientSubject = resolveMergeTags(
      variant?.subject?.trim() || subject || template?.subject || '',
      mergeRecipient,
    )
    const recipientBody = resolveMergeTags(
      variant?.body?.trim() || body,
      mergeRecipient,
    )
    // Designed emails render per recipient (AGL-349): merge tokens fill
    // from the contact, product links become absolute on the site base.
    let rendered: { html: string; text: string } | null = null
    if (template) {
      const name = names.get(email) ?? ''
      rendered = renderEmailHtml({
        nodes: template.nodes,
        // Besigner maps are rooted at '_@_', not renderEmailHtml's default
        // 'root' (AGL-765). Without this the renderer finds no root and emits
        // an empty 600px shell — for BOTH storage forms, so every designed
        // campaign shipped a blank body regardless of how it was stored. The
        // other two send paths, renderLoadedSystemEmail and
        // renderLoadedHostEmail, have always passed it; this one never did.
        rootId: EMAIL_NODE_ROOT_ID,
        subject: recipientSubject,
        preheader: template.preheader,
        // An image the author picked is stored as a `media:` reference and
        // resolves site-RELATIVE; an inbox has no page to resolve it against,
        // so without an origin the renderer drops it (AGL-1224). `siteBase` is
        // this site's own origin, and the host id qualifies an `org:`-scoped
        // asset so the unauthenticated CDN will serve it.
        mediaOrigin: siteBase,
        mediaHostId: hostId,
        merge: {
          'contact.email': email,
          'contact.name': name,
          'contact.firstName': name.split(/\s+/)[0] ?? '',
          'site.url': siteBase,
          unsubscribeUrl,
        },
        products: Object.fromEntries(
          Object.entries(template.products).map(([id, product]) => [
            id,
            {
              ...product,
              url: product.url?.startsWith('/')
                ? `${siteBase}${product.url}`
                : product.url,
            },
          ]),
        ),
      })
    }
    const result = await sendEmail({
      to: email,
      subject: recipientSubject,
      ...(rendered ? { html: rendered.html } : {}),
      text: rendered
        ? `${rendered.text}\n\n—\nUnsubscribe: ${unsubscribeUrl}`
        : `${recipientBody}\n\n—\nUnsubscribe: ${unsubscribeUrl}`,
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      fromName: branding.fromName,
      // Event attribution (AGL-268): the opens/clicks webhook maps
      // deliveries back to the campaign (and experiment) via tags.
      tags: [
        { name: 'hostId', value: hostId },
        { name: 'campaignId', value: campaignId },
        ...(experiment
          ? [{ name: 'experimentId', value: experiment.$id }]
          : []),
      ],
      context: 'campaign',
    })
    if (result.sent) {
      sent += 1
      if (variant) {
        variantSends[variant.id] = (variantSends[variant.id] ?? 0) + 1
      }
    }
  }
  // Both meters, from one call, on the DELIVERED count (AGL-1438). Ahead of
  // the `recordCampaign` early return below, because a test send is a real
  // email with a real cost even though it writes no campaign record — and
  // ahead of nothing else that writes `emailSends`, so a campaign reaches the
  // cost meter exactly once. This sender used to increment that counter
  // itself, which is how a counter named for all email came to hold campaign
  // sends alone.
  await meterHostEmail(hostId, sent, 'campaign')

  // Sends are the email variant's exposures (AGL-255).
  if (experiment && experiment.status === 'running') {
    for (const [variantId, count] of Object.entries(variantSends)) {
      // AGL-1771: `variant.id` is MERCHANT-AUTHORED — `validateExperiment`
      // checks the ids are unique and nothing about their shape — and it is a
      // path component here. The same third instance `d51e23df4` found on the
      // conversion write in `email-events.ts`, on the exposure write that
      // pairs with it. This one stays a merge-set and stays a create: the
      // first send for a variant has no stats document, the experiment was
      // just read, and the emails really went out.
      if (!isDocumentId(variantId)) continue
      await hostRef
        .collection('experiments')
        .doc(experiment.$id)
        .collection('stats')
        .doc(variantId)
        .set(
          {
            exposures: firebaseAdmin.firestore.FieldValue.increment(count),
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined)
    }
  }

  if (options.recordCampaign === false) {
    return { campaignId, recipients: sendable.length, sent }
  }
  await hostRef.collection('campaigns').doc(campaignId).set(
    {
      subject,
      body,
      audience,
      ...(options.templateScreenId
        ? { templateScreenId: options.templateScreenId }
        : {}),
      ...(experiment ? { experimentId: experiment.$id } : {}),
      stats: {
        recipients: sendable.length,
        sent,
        ...(Object.keys(variantSends).length ? { variantSends } : {}),
      },
      status: 'sent',
      sentAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      sentBy: options.senderUid,
    },
    { merge: true },
  )
  return { campaignId, recipients: sendable.length, sent }
}

/**
 * Campaign API (AGL-161/272): `action` picks the operation —
 * `send` (default) delivers now, `schedule` stores the campaign with a
 * `sendAtMs` for the processor, `cancel` withdraws a scheduled campaign.
 * All three require a site admin/editor.
 */
export const campaignSendHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const hostId = String(req.body?.hostId ?? '')
  const action = String(req.body?.action ?? 'send')
  const subject = String(req.body?.subject ?? '')
    .trim()
    .slice(0, 150)
  const body = String(req.body?.body ?? '')
    .trim()
    .slice(0, 20000)
  const audience = String(req.body?.audience ?? 'leads')
  const templateScreenId = String(req.body?.templateScreenId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  // Designed emails carry their content in the template; plain sends
  // still need subject + body.
  if (action !== 'cancel' && !templateScreenId && (!subject || !body)) {
    return res.status(400).json({ error: 'Missing subject or body' })
  }
  if (!['leads', 'members', 'manual', 'segment', 'list'].includes(audience)) {
    return res.status(400).json({ error: 'Unknown audience' })
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
      return res.status(403).json({ error: 'Not a site admin' })
    }

    if (action === 'test') {
      // Test send (AGL-349): delivers to the requesting user only, with
      // no campaign record — proofing designed emails before a real send.
      const testEmail = String(decoded.email ?? '')
      if (!testEmail) {
        return res
          .status(400)
          .json({ error: 'Your account has no email address for tests' })
      }
      const result = await performCampaignSend({
        hostId,
        subject,
        body: body || 'Test send',
        audience: 'manual',
        emails: [testEmail],
        templateScreenId: templateScreenId || undefined,
        recordCampaign: false,
        senderUid: decoded.uid,
      })
      return res.status(200).json({ ...result, test: true })
    }

    if (action === 'preview') {
      // Read-only, and it needs the same admin/editor role as a send: the
      // audience size of someone else's site is not public information.
      const result = await performCampaignSend({
        hostId,
        subject: subject || 'preview',
        body: body || 'preview',
        audience,
        segmentId: String(req.body?.segmentId ?? ''),
        listId: String(req.body?.listId ?? ''),
        emails: Array.isArray(req.body?.emails)
          ? req.body.emails.map(String)
          : undefined,
        templateScreenId: templateScreenId || undefined,
        senderUid: decoded.uid,
        dryRun: true,
      })
      return res.status(200).json(result)
    }

    if (action === 'schedule') {
      // Scheduling (AGL-272): store the full send config; the
      // process-scheduled cron delivers it through performCampaignSend.
      const sendAtMs = Number(req.body?.sendAtMs ?? 0)
      if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) {
        return res.status(400).json({ error: 'Pick a future send time' })
      }
      const campaignId =
        String(req.body?.campaignId ?? '') || createResourceUid()
      // AGL-1771: this branch WRITES, and it is the only campaign write that
      // does not go through `performCampaignSend`'s guard. A `campaignId` of
      // `a/b/c` scheduled the campaign at `campaigns/a/b/c` — which the
      // scheduled-campaign processor would then pick up by `collectionGroup`
      // and send, from a document the merchant can neither see in their
      // campaigns list nor cancel.
      if (!isDocumentId(campaignId)) {
        return res.status(400).json({ error: 'Invalid campaignId' })
      }
      await hostRef.collection('campaigns').doc(campaignId).set(
        {
          subject,
          body,
          audience,
          ...(req.body?.segmentId
            ? { segmentId: String(req.body.segmentId) }
            : {}),
          ...(req.body?.listId ? { listId: String(req.body.listId) } : {}),
          ...(Array.isArray(req.body?.emails)
            ? { emails: req.body.emails.map(String).slice(0, 500) }
            : {}),
          ...(req.body?.experimentId
            ? { experimentId: String(req.body.experimentId) }
            : {}),
          ...(templateScreenId ? { templateScreenId } : {}),
          status: 'scheduled',
          sendAtMs,
          scheduledAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          scheduledBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ campaignId, status: 'scheduled' })
    }

    if (action === 'cancel') {
      const campaignId = String(req.body?.campaignId ?? '')
      // AGL-1771: the ref used to be built one line ABOVE the `campaignId ?`
      // check below, which defeated that check — `.doc('')` throws on an empty
      // path segment, so the 400 this branch intends became a 500. Guarding
      // first is what lets the ref be built at all.
      if (!isDocumentId(campaignId)) {
        return res.status(400).json({ error: 'Not a scheduled campaign' })
      }
      const campaignRef = hostRef.collection('campaigns').doc(campaignId)
      const campaignSnapshot = await campaignRef.get()
      if (
        !campaignSnapshot?.exists ||
        campaignSnapshot.get('status') !== 'scheduled'
      ) {
        return res.status(400).json({ error: 'Not a scheduled campaign' })
      }
      await campaignRef.set(
        {
          status: 'canceled',
          canceledAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          canceledBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ campaignId, status: 'canceled' })
    }

    const result = await performCampaignSend({
      hostId,
      subject,
      body,
      audience,
      segmentId: String(req.body?.segmentId ?? ''),
      listId: String(req.body?.listId ?? ''),
      emails: Array.isArray(req.body?.emails) ? req.body.emails : undefined,
      campaignId: String(req.body?.campaignId ?? ''),
      experimentId: String(req.body?.experimentId ?? ''),
      templateScreenId: templateScreenId || undefined,
      senderUid: decoded.uid,
    })
    return res.status(200).json(result)
  } catch (error) {
    if (error instanceof CampaignSendError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error(error)
    return res.status(500).json({ error: 'Campaign send failed' })
  }
}
