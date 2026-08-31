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
 * WHICH VERIFIED IDENTITY ONE SITE SENDS AS — the per-host half of the model.
 *
 * `sending-domains/route.ts` owns the other half: which domains the ORG has
 * proved. Proving a zone is a property of the org that proved it, so an
 * agency publishes the DKIM record for `client.com` once; choosing what a
 * given site's recipients see in the `From:` line is a property of the SITE,
 * because the brand on the mail belongs to the site and not to the agency.
 *
 * Two routes rather than one because they are scoped to different documents
 * and answer to different readers — and because this one has to be READABLE
 * by somebody who may not write it.
 *
 * ## The two gates, and why they are not the same gate
 *
 * `GET` is admin-or-editor **on the site**, matching `campaignSendHandler`
 * exactly. Anyone who may compose a campaign has to be able to see which
 * address it will leave on, and refusing them that read would put the
 * composer's identity readout behind a permission the composer itself does
 * not require — a merchant would meet an empty box where the answer goes.
 *
 * `POST` is `org.settings`, matching the domains route. Writing this key
 * decides what every recipient of this site's mail sees in the `From:` line,
 * and a site `admin` is not necessarily an org member at all: a site-scoped
 * COLLABORATOR carries a host role and no org standing. Gating the write on
 * the host role would let a collaborator on one client's site move that
 * site's mail onto another client's verified domain.
 *
 * ## A selection is only accepted for a VERIFIED domain
 *
 * Not because the send would otherwise be wrong — it would be refused, which
 * is correct and is proved elsewhere — but because a selection that refuses
 * every send is not a state worth being able to enter. The refusal names the
 * records instead, which is the sentence the person can act on.
 *
 * The reverse is deliberately NOT true: releasing a domain does not clear the
 * selections pointing at it, and this route does not repair them either. A
 * site configured to send as a domain nothing has verified must refuse rather
 * than quietly revert to the shared domain — see `releaseSendingDomain`.
 *
 * ## The DOMAIN is proved; the MAILBOX is chosen
 *
 * DMARC on the sending apex is published with `adkim=s`, so the `From:`
 * domain has to be exactly the domain whose DKIM key signed the message.
 * Nothing a merchant sends here can move it. What they can choose is the part
 * in front of the `@` — and a display name and a reply address to go with it,
 * which is what "send as a person" is made of.
 *
 * The mailbox is CONFIGURED here rather than typed per send, because it
 * addresses a real mailbox: it is where a bounce returns and where a client
 * that ignores `Reply-To:` will answer. `campaign-send.ts` states the same
 * boundary from the other end — a sending identity named in a send request is
 * read by nothing — and a per-send local part would reopen exactly that path.
 *
 * It is also the reason the two writes have different gates. Deciding which
 * addresses this site's mail may leave on is an `org.settings` decision, and
 * the composer, which is admin-or-editor, may only pick among them.
 *
 * ## SEVERAL senders, chosen by id
 *
 * A site holds a list — `hosts/{hostId}/senders/{senderId}` — and a campaign
 * names one. That does not reopen the closed path: a sender id is a key into a
 * set an org admin already approved, so the addresses a send can reach are
 * still only addresses that were validated once and are actually served. A
 * `senderId` naming a sender this site does not hold is REFUSED rather than
 * defaulted, which is the same rule the mailbox validation keeps — a value
 * somebody chose is never answered with a different one they did not.
 *
 * The list belongs to the SITE and not to the org, even though the domain
 * behind it is org-level, and for the reason the domain OPTIONS are scoped the
 * same way: offering every site the whole org's set would let an editor on one
 * client's site send as another client's — cross-site reach arriving through
 * the `From:` line.
 *
 * ## The default is the PROJECTION, so nothing needed backfilling
 *
 * `hosts/{hostId}.sendingLocalPart`, `.sendingFromName` and `.sendingReplyTo`
 * predate the collection and are what `resolveHostSendingIdentity` reads on
 * every tenant send. They stay, as the default sender's projection: the read
 * below synthesizes a default row from them while the subcollection is empty,
 * the first write materializes that row, and every later change to the default
 * writes both. A site already sending as `test@` cannot revert to `hello@`
 * because a collection it never had holds nothing.
 *
 * ## The dedicated subdomain is asked for HERE, and nowhere else
 *
 * `action: 'request-dedicated'` is the only path in the product that claims a
 * platform sending subdomain. It is the one shape of sending identity that
 * draws on a resource the platform cannot grow without buying more of it —
 * a provider domain slot, three records in our own zone, and a permanent place
 * in the re-verification sweep — while the shared pool is flat at any scale
 * and a customer's own domain costs our zone nothing.
 *
 * So it is offered rather than issued. The `GET` reports it as an offer under
 * `dedicated` for an entitled site that has none, which is what stops the
 * option being invisible to the merchant who needs it: the marketing refusal
 * names this screen, and this screen is where the two ways out of it live.
 *
 * It is one of the four `action` values this route dispatches on, and the only
 * one about the DOMAIN — the other three manage the sender list. They are read
 * together, above the branch that treats a body naming no domain as a sender
 * edit, because every one of them names no domain and would otherwise be
 * swallowed by it.
 */

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  listSendingDomains,
  lockdownRefusal,
  memberHasOrgPermission,
  orgHoldsDedicatedSendingDomain,
  requestHostSendingDomain,
  resolveHostSendingIdentity,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  defaultHostSender,
  DEFAULT_HOST_SENDER_ID,
  DEFAULT_SENDING_LOCAL_PART,
  headerSafeText,
  HOST_SENDER_LIMIT,
  HOST_SENDERS_COLLECTION,
  hostSenderAddress,
  mailLabelCandidate,
  normalizeLocalPart,
  normalizeSendingDomain,
  platformSendingDomainFor,
  readHostSender,
  SENDING_FROM_NAME_MAX,
  SENDING_REPLY_TO_MAX,
  validateSendingLocalPart,
  type HostSenderRecord,
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'
// The LEAF module rather than the barrel, for the reason that module states:
// it imports nothing, and a barrel import would pull ~35 server modules in
// behind a predicate about one path component.
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { DEDICATED_SENDING_DOMAIN_MIN_PLAN } from '@aglyn/aglyn/app-utils/dedicated-sending-domain'
import {
  PLAN_LABELS,
  planLabelGrantingFeature,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

export const dynamic = 'force-dynamic'

/**
 * A reply address has to be one a person can actually write back to, so it is
 * checked as an address and not merely as header-safe text.
 *
 * The loose shape the members route uses, deliberately: this field is the one
 * place a merchant may legitimately name a mailbox on a domain nothing here
 * controls — a personal account, a shared inbox at their own company — and a
 * stricter pattern would be this surface guessing at somebody else's mail
 * provider. What it must not admit is a value with whitespace or a second
 * address in it, which is what the anchors and the `\s` exclusions cover.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * One choice in the composer's identity control.
 *
 * `from` is the whole address so a surface never assembles one. A composer
 * that built `${localPart}@${domain}` itself would be a second place the
 * address is derived, and the two would disagree the first time either
 * changed.
 */
interface IdentityOption {
  /** The domain. Always a real one — there is no reserved `platform` value. */
  value: string
  from: string | null
  /** False for a domain whose DNS is unfinished — offered, never selectable. */
  selectable: boolean
  status: SendingDomainRecord['status']
}

async function handler(request: Request): Promise<Response> {
  const { method, query, body } = await pluginRequestFromWeb(request)
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let decoded: Record<string, unknown> & { uid: string; email_verified?: boolean }
  try {
    decoded = (await firebaseAdmin.app().auth().verifyIdToken(idToken)) as never
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded as never)) {
    return emailUnverifiedResponse()
  }

  const hostId = String(query['hostId'] ?? body?.['hostId'] ?? '').trim()
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return Response.json({ error: 'Unknown site' }, { status: 404 })
  }

  const staff = decoded['staff'] === true
  const hostRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (!staff && hostRole !== 'admin' && hostRole !== 'editor') {
    return Response.json(
      { error: 'Not a site admin or editor' },
      { status: 403 },
    )
  }

  const orgForHost = await getOrgForHost(hostId).catch(() => null)
  const orgId = String(orgForHost?.orgId ?? '')
  const org = (orgForHost?.org ?? null) as Record<string, unknown> | null

  const locked = await lockdownRefusal({
    request,
    staff,
    uid: decoded.uid,
    org: org as never,
  })
  if (locked) return locked

  /*
   * Whether this caller may CHANGE the selection, resolved for both verbs.
   *
   * The GET reports it so the card can render its controls disabled with a
   * reason rather than offering an action that 403s — and the POST enforces
   * it, because a disabled control is a courtesy and not a gate.
   */
  const membership = orgId
    ? await resolveOrgMembership(decoded.uid, orgId).catch(() => null)
    : null
  const canManage =
    staff ||
    (Boolean(orgId) &&
      (await memberHasOrgPermission(
        orgId,
        membership?.member,
        'org.settings',
      ).catch(() => false)))
  // Same entitlement as the domains route, and for the same reason: this is
  // the per-site half of one capability, so a site could otherwise be offered
  // a selection the org may not claim a domain to fill.
  const entitled =
    Boolean(org) && checkEntitlement(org as never, 'customSendingDomain')
  /*
   * THE TWO PLAN NAMES THIS SURFACE QUOTES, DERIVED RATHER THAN WRITTEN.
   *
   * A merchant without a sending domain of their own needs to be told which
   * plan carries one, and there are two answers to give: a subdomain the
   * platform provisions inside its own mail apex, and a domain the customer
   * owns. They happen to name the same tier today, and they are read
   * separately because they are decided separately — one by an entitlement
   * flag, one by a plan floor — so a re-cut of either moves its own sentence.
   *
   * `planGrantingFeature` walks `PLAN_ENTITLEMENTS` for the flag rather than
   * being told the answer. A tier name written into a surface is pricing copy
   * that keeps rendering after the gate beneath it moves, which is the failure
   * `planLabelGrantingFeature` exists to stop.
   *
   * `null` rather than a fallback name when no plan carries the gate: "upgrade
   * to undefined" is worse than a card that says only what it is sure of.
   */
  const customDomainPlan =
    planLabelGrantingFeature('customSendingDomain') ?? null
  const dedicatedDomainPlan =
    PLAN_LABELS[DEDICATED_SENDING_DOMAIN_MIN_PLAN] ?? null

  const selectedDomain = normalizeSendingDomain(
    String(hostSnapshot.get('sendingDomain') ?? ''),
  )
  const localPart =
    normalizeLocalPart(String(hostSnapshot.get('sendingLocalPart') ?? '')) ||
    DEFAULT_SENDING_LOCAL_PART
  /*
   * WHO THE SITE SENDS AS, as opposed to WHERE FROM.
   *
   * A display name and a reply address, stored per site so a merchant sets
   * "Jamie at Acme, replies to jamie@acme-corp.com" once rather than retyping
   * it into every campaign. The composer still owns the per-send values — it
   * has carried both fields since it shipped — and these are what it starts
   * from when a campaign has said nothing.
   *
   * Deliberately NOT read by the send path. A campaign records the values the
   * composer submitted, so what these do is decide what a person is shown
   * before they press send; a second reader inside the send would make the
   * stored report and the site setting two answers to one question.
   */
  const senderName = headerSafeText(
    hostSnapshot.get('sendingFromName'),
    SENDING_FROM_NAME_MAX,
  )
  const senderReplyTo = headerSafeText(
    hostSnapshot.get('sendingReplyTo'),
    SENDING_REPLY_TO_MAX,
  ).toLowerCase()

  const sendersRef = hostRef.collection(HOST_SENDERS_COLLECTION)
  /*
   * WHICH ROW IS THE DEFAULT, and the flag that says whether there are rows.
   *
   * Written only when the collection is materialized, so an empty value means
   * this site's senders are still the three fields above and nothing else —
   * which is what lets the mirror below cost no read at all on a site that has
   * never opened the sender list.
   */
  const defaultSenderId = String(hostSnapshot.get('defaultSenderId') ?? '')

  /**
   * The senders this site holds, or the one its host fields describe.
   *
   * An empty subcollection is not an absence of senders — it is a site with
   * exactly one, the one the host document has always carried. Synthesizing it
   * here rather than backfilling is what makes this change need no migration:
   * a site that never opens the list keeps sending exactly as it does today,
   * and the row it is shown is the row a send would use.
   *
   * `stored` distinguishes the two, because the writes below have to: patching
   * a synthesized row means writing the host fields, and patching a
   * materialized one means writing both.
   */
  const readSenders = async (): Promise<{
    senders: HostSenderRecord[]
    stored: boolean
  }> => {
    const snapshot = await sendersRef.limit(HOST_SENDER_LIMIT).get()
    const stored = (snapshot?.docs ?? [])
      .map((document: FirebaseFirestore.QueryDocumentSnapshot) =>
        readHostSender({
          id: document.id,
          data: document.data() as Record<string, unknown>,
          defaultSenderId,
        }),
      )
      /*
       * A row whose mailbox does not survive normalization is dropped rather
       * than rendered. It cannot be sent as — `readHostSender` normalizes with
       * the same function the send path does — so listing it would offer a
       * choice that refuses, which is the state the domain options already
       * refuse to enter.
       */
      .filter((sender: HostSenderRecord) => sender.localPart)
    if (stored.length) {
      const fallback = defaultHostSender(stored)
      return {
        senders: stored.map((sender: HostSenderRecord) => ({
          ...sender,
          isDefault: sender.id === fallback?.id,
        })),
        stored: true,
      }
    }
    return {
      senders: [
        {
          id: DEFAULT_HOST_SENDER_ID,
          localPart,
          fromName: senderName,
          replyTo: senderReplyTo,
          isDefault: true,
          createdAtMs: 0,
        },
      ],
      stored: false,
    }
  }

  if (method === 'GET') {
    const { senders } = await readSenders()
    const records = orgId ? await listSendingDomains(orgId) : []
    /*
     * The identity as the SEND PATH would resolve it, through the same
     * function the send calls. A surface that re-derived "are we verified"
     * from the record list would be a second opinion on the one question this
     * feature exists to answer, and the composer would eventually show a
     * green address for a send that 409s.
     */
    const resolved = await resolveHostSendingIdentity({
      orgId,
      hostId,
      selectedDomain,
      selectedLocalPart: localPart,
      poolMember: hostSnapshot.get('sendingPoolMember'),
    })

    /*
     * THE SHARED AGLYN DOMAIN IS NOT AN OPTION, and is not offered as one.
     *
     * It used to head this list. `USAGE_EMAIL_FROM` is an address on
     * `aglyn.com`, where the platform's own billing and account mail leaves
     * from, and a site sending there charges its list's complaint rate against
     * every other customer's password reset.
     *
     * What replaces it is the site's OWN provisioned domain, which is the
     * thing the removed row was actually standing in for: an address the
     * merchant does not have to do any DNS work for. It is offered under its
     * real name so a merchant can see what their recipients will see.
     */
    const platformDomain = platformSendingDomainFor(
      String(hostSnapshot.get('sendingLabel') ?? ''),
    )
    const platformRecord = platformDomain
      ? records.find((entry) => entry.domain === platformDomain)
      : null

    /*
     * THE DEDICATED SUBDOMAIN AS AN OFFER, NOT AS A FACT.
     *
     * A site is no longer issued one on upgrade, so a surface that only
     * reported the domain a site HAS would show an entitled workspace nothing
     * at all — and the merchant would meet the marketing refusal with no idea
     * that the thing it asks for is one click away on this screen.
     *
     * TWO FIELDS, and deliberately not a third saying whether the site has
     * one. `platformDomain` above already answers that, and a second key
     * carrying the same fact is a second place that decides what "has a
     * domain" means — which is how a card comes to offer one to a site that
     * already holds it.
     *
     * `proposed` is the name a request would MOST LIKELY take, derived the
     * same way the claim derives it. It is not a reservation: a label already
     * taken moves the claim to the next candidate, so the response to the
     * request is what names the domain the site actually got. Showing it
     * anyway is what lets somebody decide — an Aglyn-branded sending name is
     * the trade this option asks them to accept, and it cannot be weighed
     * unseen.
     */
    const dedicated = {
      available:
        !platformDomain && Boolean(orgId) && (await orgHoldsDedicatedSendingDomain(orgId)),
      proposed:
        platformSendingDomainFor(
          mailLabelCandidate(String(hostSnapshot.get('subdomain') ?? ''), 1),
        ) || null,
    }

    const options: IdentityOption[] = []
    if (platformDomain) {
      options.push({
        value: platformDomain,
        from: `${localPart}@${platformDomain}`,
        // Selectable only once it verifies, exactly like a customer's own
        // domain. Provisioning follows the request; it is not instant.
        selectable: platformRecord?.status === 'verified',
        status: platformRecord?.status ?? 'requested',
      })
    }
    /*
     * Only the domain THIS SITE has selected becomes an option, even though
     * the org may have proved several.
     *
     * Which of the org's identities a site may use is the per-host selection,
     * and that is a decision with an org-admin gate on it. Offering the whole
     * org's verified set in every site's composer would route around that
     * gate — in an agency org it would let an editor on one client's site
     * send as another client's domain, which is the cross-site reach the
     * scoping rules exist to prevent, arriving through the `From:` line.
     */
    const selectedRecord = records.find(
      (record) => record.domain === selectedDomain,
    )
    // `!== platformDomain` because the site's own provisioned domain is now
    // the DEFAULT selection, so it is ordinarily both — and listing it twice
    // would render a control offering the same address as two choices.
    if (selectedDomain && selectedDomain !== platformDomain) {
      options.push({
        value: selectedDomain,
        from: `${localPart}@${selectedDomain}`,
        selectable: selectedRecord?.status === 'verified',
        status: selectedRecord?.status ?? 'failed',
      })
    }

    return Response.json({
      orgId: orgId || null,
      /*
       * The chosen option's `value`, which is always a DOMAIN now.
       *
       * It used to be able to read `platform`, meaning the shared Aglyn
       * address. That is no longer a thing a site can be, so falling back to
       * the site's own provisioned domain is the honest answer for a site
       * that has made no explicit choice — it is what such a site sends as.
       */
      selected: selectedDomain || platformDomain || '',
      /*
       * The site's OWN provisioned domain, or `''` when it has none.
       *
       * Empty is the ordinary state below the dedicated tier, not a fault: a
       * site with no domain of its own sends its transactional mail on the
       * shared pool. The card needs the distinction to say which of the two
       * sentences applies, and deriving it there would mean a second place
       * that decides what "has a domain" means.
       */
      platformDomain: platformDomain || '',
      customDomainPlan,
      dedicatedDomainPlan,
      localPart,
      /*
       * WHETHER THE CHOSEN MAILBOX IS THE ONE BEING USED.
       *
       * A site with no domain of its own sends on a pooled Aglyn address, and
       * that address's mailbox is fixed — `resolveSendingIdentity` builds the
       * shared arm from the operator's `sharedTenantSendingFrom()` and never
       * consults the site's `localPart`. So the stored mailbox is real, it is
       * kept, and it is simply not in effect yet.
       *
       * Reported rather than hidden because the alternative is a settings
       * card showing `sales` beside mail that is going out as
       * `notifications@`. A stored value that is not the value in use is
       * exactly the case a surface has to say out loud.
       */
      localPartInUse: resolved.source === 'custom',
      fromName: senderName || null,
      replyTo: senderReplyTo || null,
      /*
       * THE SENDERS THIS SITE MAY SEND AS, with the address each one leaves
       * on already assembled.
       *
       * Reported on the READ gate rather than behind the write gate, for the
       * reason the identity itself is: the composer picks among these and is
       * admin-or-editor, so putting the list behind `org.settings` would leave
       * a merchant with a From control that had nothing in it.
       *
       * `from` is null for a row whose mailbox is not the one in use — a site
       * on the pooled address has one fixed mailbox shared with every other
       * site on it, so a stored mailbox there is real, kept, and simply not in
       * effect. `localPartInUse` above says which case this is.
       */
      senders: senders.map((sender) => ({
        id: sender.id,
        localPart: sender.localPart,
        fromName: sender.fromName || null,
        replyTo: sender.replyTo || null,
        isDefault: sender.isDefault,
        from:
          resolved.source === 'custom'
            ? hostSenderAddress(sender.localPart, resolved.domain)
            : sender.isDefault
              ? resolved.from
              : null,
      })),
      identity: resolved.summary,
      identitySource: resolved.source,
      refusal: resolved.refusal,
      options,
      // The org's whole set, for the card that manages them. The composer
      // uses `options`; these are what an admin picks a selection FROM.
      domains: records.map((record) => ({
        domain: record.domain,
        status: record.status,
        verifiedAtMs: record.verifiedAtMs ?? null,
        lastCheckedAtMs: record.lastCheckedAtMs ?? null,
      })),
      canManage,
      entitled,
      dedicated,
    })
  }

  if (!canManage) {
    return Response.json(
      {
        error:
          'Changing the address this site sends from needs the organization ' +
          'admin role.',
      },
      { status: 403 },
    )
  }
  const requested = String(body?.['domain'] ?? '').trim()

  /*
   * THE MAILBOX, THE NAME AND THE REPLY ADDRESS — each written only when the
   * body names it.
   *
   * Absent and blank are different requests, and reading them as one is what
   * made the old handler quietly wrong. Changing the domain and changing the
   * mailbox are separate decisions taken from separate controls, so a body
   * that names a domain and no mailbox must leave the mailbox alone rather
   * than resetting a site that sends as `jamie@` back to `hello@`.
   *
   * A field that is PRESENT and empty is a merchant clearing it, which is a
   * real instruction for a name and a reply address — both are optional — and
   * is not one for the mailbox, which every address needs.
   */
  const localPartGiven = body?.['localPart'] !== undefined
  const fromNameGiven = body?.['fromName'] !== undefined
  const replyToGiven = body?.['replyTo'] !== undefined

  /*
   * REFUSED WITH A SENTENCE RATHER THAN CORRECTED IN SILENCE.
   *
   * `normalizeLocalPart` answers the empty string for anything malformed, and
   * this used to be read through `|| DEFAULT_LOCAL_PART` — so a merchant who
   * typed `sales team!` was answered `hello`, a real address they had not
   * chosen, presented as the one they had just set. The value reaches an SMTP
   * envelope and a `From:` header, so it has to be validated either way; what
   * changes here is that the person is told which rule they met.
   */
  const mailbox = localPartGiven
    ? validateSendingLocalPart(body?.['localPart'])
    : null
  if (mailbox?.error) {
    return Response.json({ error: mailbox.error }, { status: 400 })
  }

  const nextFromName = headerSafeText(body?.['fromName'], SENDING_FROM_NAME_MAX)
  const nextReplyTo = headerSafeText(
    body?.['replyTo'],
    SENDING_REPLY_TO_MAX,
  ).toLowerCase()
  /*
   * THE ONE FIELD THAT MAY NAME A MAILBOX WE DO NOT SIGN FOR.
   *
   * DMARC on the sending apex is published `adkim=s`, so the `From:` domain
   * must be exactly the domain whose DKIM key signed the message and no
   * merchant input can move it. `Reply-To:` carries no such alignment: it is
   * where a person's answer goes, and pointing it at a personal or corporate
   * mailbox is the supported way to be reachable at an address this platform
   * has never verified.
   */
  if (replyToGiven && nextReplyTo && !EMAIL_PATTERN.test(nextReplyTo)) {
    return Response.json(
      {
        error:
          'Enter a reply address as a full email address, for example ' +
          'jamie@acme.com. Replies go there instead of to the sending ' +
          'address, and it does not have to be on a domain you have verified.',
      },
      { status: 400 },
    )
  }

  /**
   * The three sender fields as a Firestore merge patch.
   *
   * `deleteField` rather than `''` for a cleared name or reply address, so an
   * unset field is genuinely unset. A stored empty string would read as a
   * value on every surface that tests for presence, which is the shape that
   * makes an absent setting render as a real one.
   */
  const senderPatch = () => ({
    ...(mailbox?.localPart ? { sendingLocalPart: mailbox.localPart } : {}),
    ...(fromNameGiven
      ? {
          sendingFromName: nextFromName
            ? nextFromName
            : firebaseAdmin.firestore.FieldValue.delete(),
        }
      : {}),
    ...(replyToGiven
      ? {
          sendingReplyTo: nextReplyTo
            ? nextReplyTo
            : firebaseAdmin.firestore.FieldValue.delete(),
        }
      : {}),
  })

  /*
   * WHY A SITE ON THE POOLED ADDRESS CANNOT CHOOSE A MAILBOX.
   *
   * Three reasons, and the first is structural: the shared arm of
   * `resolveSendingIdentity` builds its address from the operator's
   * `sharedTenantSendingFrom()` and never reads the site's `localPart`, so
   * storing one for a pooled site stores a setting with no effect.
   *
   * The second is that the mailbox on a pooled member is not the site's to
   * name. Every site assigned to `shared{n}.mail.aglyn.app` shares it, and the
   * mailbox is where that member's bounces and complaints come back — one
   * operational address serving all of them, not a per-site brand.
   *
   * The third is what a recipient would read. `sales@shared3.mail.aglyn.app`
   * puts a merchant's own department name on a domain the merchant plainly
   * does not own, which is the shape a receiving filter is built to distrust
   * and a person is right to.
   *
   * So this is refused rather than stored. The name and the reply address are
   * not: both are honored on the pooled address exactly as they are on a
   * site's own domain, and they are the half of "send as a person" that does
   * not depend on owning a name.
   */
  const POOLED_MAILBOX_REFUSAL =
    'This site sends on a shared Aglyn address, whose mailbox is fixed and ' +
    'shared with the other sites on it, so it cannot be renamed. The sender ' +
    'name and reply address below still apply. Choosing the address itself ' +
    'needs a domain of this site’s own.'

  /*
   * `sendingLabel`, not `sendingDomain`. The label is the pinned claim and is
   * what makes a domain this site's own; the selection can be empty for a site
   * whose provisioning has not finished attaching it yet, and a mailbox stored
   * in that window is correct and simply not yet in use.
   */
  const hasOwnDomain =
    Boolean(selectedDomain) ||
    Boolean(String(hostSnapshot.get('sendingLabel') ?? '').trim())

  /**
   * The three host fields, rewritten from whichever sender is the default.
   *
   * The projection, and the only writer of it once the collection exists. The
   * send path reads `sendingLocalPart` and nothing else, so a default that
   * moved without this write would leave a site sending as the sender it used
   * to have — which is the silent disagreement the whole projection exists to
   * make impossible.
   */
  const projectDefaultSender = async (sender: HostSenderRecord) => {
    await hostRef.set(
      {
        defaultSenderId: sender.id,
        /*
         * The mailbox is projected only for a site that HAS a domain of its
         * own. On the shared pool the mailbox is fixed and is not one site's
         * to name — see `POOLED_MAILBOX_REFUSAL` above — so projecting one
         * here would store, by way of the default, the exact setting that
         * refusal exists to keep out.
         */
        ...(hasOwnDomain ? { sendingLocalPart: sender.localPart } : {}),
        sendingFromName:
          sender.fromName || firebaseAdmin.firestore.FieldValue.delete(),
        sendingReplyTo:
          sender.replyTo || firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
  }

  /**
   * The site's senders as DOCUMENTS, writing the first one if it has none.
   *
   * The half of "no backfill" that happens at write time. Everything a site
   * has ever sent as is already described by the host fields, so the row this
   * mints is not a new sender — it is the existing one, given an id so a
   * second can sit beside it.
   */
  const materializeSenders = async (): Promise<HostSenderRecord[]> => {
    const { senders, stored } = await readSenders()
    if (stored) return senders
    const seed = senders[0]
    await sendersRef.doc(DEFAULT_HOST_SENDER_ID).set(
      {
        localPart: seed.localPart,
        ...(seed.fromName ? { fromName: seed.fromName } : {}),
        ...(seed.replyTo ? { replyTo: seed.replyTo } : {}),
        createdAtMs: Date.now(),
      },
      { merge: true },
    )
    await hostRef.set(
      { defaultSenderId: DEFAULT_HOST_SENDER_ID },
      { merge: true },
    )
    return [{ ...seed, id: DEFAULT_HOST_SENDER_ID, isDefault: true }]
  }

  /**
   * Which sender a request is addressing, or the refusal.
   *
   * A `senderId` this site does not hold is REFUSED and never defaulted, which
   * is the same rule the mailbox validation keeps: answering a value somebody
   * chose with a different one they did not is how a merchant ends up told
   * their site sends as an address it does not.
   */
  const targetSender = (
    senders: HostSenderRecord[],
    id: unknown,
  ): HostSenderRecord | null =>
    isDocumentId(id)
      ? (senders.find((sender) => sender.id === id) ?? null)
      : null

  const UNKNOWN_SENDER_REFUSAL =
    'That sender is not one this site holds. Pick one from the sender list, ' +
    'or add it first.'

  /**
   * The DEFAULT sender's row, kept level with the host fields beside it.
   *
   * Every branch that writes `senderPatch()` — the domain actions and the
   * mailbox-only body alike — writes the three host fields directly, because
   * they predate the collection and are still the shape those controls post.
   * This carries the same change onto the row once one exists, so the two
   * cannot drift.
   *
   * Costs no read on a site that has never opened the sender list:
   * `defaultSenderId` is written only where a row is materialized, so an empty
   * one means the host fields are the whole of this site's senders.
   */
  const mirrorDefaultSender = async () => {
    if (!defaultSenderId) return
    const patch = {
      ...(mailbox?.localPart ? { localPart: mailbox.localPart } : {}),
      ...(fromNameGiven
        ? {
            fromName:
              nextFromName || firebaseAdmin.firestore.FieldValue.delete(),
          }
        : {}),
      ...(replyToGiven
        ? {
            replyTo: nextReplyTo || firebaseAdmin.firestore.FieldValue.delete(),
          }
        : {}),
    }
    if (!Object.keys(patch).length) return
    await sendersRef.doc(defaultSenderId).set(patch, { merge: true })
  }

  /*
   * THE FOUR ACTIONS THIS ROUTE DISPATCHES ON, READ TOGETHER AND READ FIRST.
   *
   * One claims the site a sending domain; the other three manage the list of
   * senders it may send AS. They are unrelated operations and they share this
   * dispatch for one reason: none of them names a `domain`, so every one of
   * them would be swallowed by the branch below that reads a body with no
   * `domain` key as a sender edit — stored, answered 200 with the selection
   * the site already had, and nothing done.
   *
   * That is why the unknown-action refusal sits at the BOTTOM of the dispatch
   * rather than after any one arm of it. A catch-all in the middle would turn
   * the arms under it into 400s, which is the same swallowing failure wearing
   * a different status code.
   */
  const action = String(body?.['action'] ?? '').trim()

  /*
   * ASK FOR A DEDICATED SENDING DOMAIN — the only way one is ever claimed.
   *
   * A separate action rather than a side effect of choosing an identity,
   * because it is the one operation on this route that spends a resource the
   * platform cannot buy back: a slot in the provider's account-wide domain
   * allowance, three records in our own zone, and a permanent place in the
   * re-verification sweep. Three code paths used to spend it without anybody
   * asking — site creation, the upgrade webhook and a sweep — which made the
   * platform's domain count grow with paying customers rather than with
   * anybody's decision.
   *
   * `requestedBy: 'merchant'` is honest for both callers reaching here. Staff
   * arrive through impersonation, acting as the workspace and recorded as that
   * session; a `staff` stamp here would name the role rather than the account,
   * which is the less useful of the two and the one the impersonation log
   * already carries.
   */
  if (action === 'request-dedicated') {
    const claim = await requestHostSendingDomain({
      hostId,
      orgId,
      subdomain: String(hostSnapshot.get('subdomain') ?? ''),
      requestedBy: 'merchant',
    }).catch(() => null)

    if (!claim?.domain) {
      /*
       * NAME THE REASON, WHICH IS ALMOST ALWAYS THE PLAN.
       *
       * `requestHostSendingDomain` refuses below the dedicated tier, so the
       * common case is a site that is not entitled to a domain of its own
       * rather than one whose provisioning is in flight. Telling such a
       * merchant to "try again shortly" sends them to wait for something that
       * is never coming, which is the shape of refusal this whole surface
       * exists to avoid — so the plan case is separated from every other,
       * which is ours and says so.
       *
       * Nothing about the site's mail is broken meanwhile: it keeps sending
       * its receipts on the shared address, which is what makes this a
       * refusal of a CHOICE rather than of a send.
       *
       * The tier is derived rather than written. A name typed into a refusal
       * is pricing copy that keeps rendering after the gate beneath it moves.
       */
      const planned = claim?.error === 'plan-no-dedicated-domain'
      return Response.json(
        {
          error: planned
            ? dedicatedDomainPlan
              ? `A sending domain of this site’s own comes with ${dedicatedDomainPlan}. ` +
                'Until then this site sends its receipts and account email on ' +
                'the shared address, and marketing email needs a domain of ' +
                'its own.'
              : 'This site’s plan does not carry a sending domain of its own. ' +
                'It sends its receipts and account email on the shared ' +
                'address meanwhile.'
            : 'We could not set up a sending domain for this site just now. ' +
              'Nothing has changed and account email is still sending — try ' +
              'again shortly.',
          reason: claim?.error ?? 'unknown',
        },
        { status: planned ? 403 : 409 },
      )
    }

    /*
     * The site is pointed at the new domain immediately, before any DNS
     * exists. That is safe rather than premature: an unverified domain the
     * PLATFORM issued resolves to the shared pool for transactional mail, so
     * the site keeps sending throughout, and the moment the sweep verifies it
     * the same field is already correct.
     *
     * A mailbox named in the same body is applied rather than refused. The
     * pooled refusal above exists because a shared member's address is not one
     * site's to name; this site now has a domain of its own, which is the
     * condition that refusal is about.
     */
    await hostRef.set(
      { sendingDomain: claim.domain, ...senderPatch() },
      { merge: true },
    )
    await mirrorDefaultSender()
    const claimedMailbox = mailbox?.localPart || localPart
    // `from` as well as its two halves, matching the selection branch below,
    // so a surface reporting the new address reads one field rather than
    // assembling one.
    return Response.json({
      selected: claim.domain,
      localPart: claimedMailbox,
      from: `${claimedMailbox}@${claim.domain}`,
      created: claim.created,
    })
  }

  if (action === 'createSender') {
    if (!mailbox?.localPart) {
      return Response.json(
        {
          error:
            'A sender needs a mailbox — the part of the address before the @.',
        },
        { status: 400 },
      )
    }
    /*
     * A pooled site has ONE sender and cannot be given a second, for the
     * reason it cannot rename the one it has: the mailbox on a shared member
     * is where every site on it gets its bounces back, so it is not one site's
     * to name — and a second sender that could not differ in the mailbox would
     * be the same address twice.
     */
    if (!hasOwnDomain) {
      return Response.json({ error: POOLED_MAILBOX_REFUSAL }, { status: 409 })
    }
    const senders = await materializeSenders()
    if (senders.length >= HOST_SENDER_LIMIT) {
      return Response.json(
        {
          error:
            `This site already has ${HOST_SENDER_LIMIT} senders, which is ` +
            'the most it can hold. Every one of them is a mailbox that ' +
            'receives bounces and replies. Remove one you no longer send as.',
        },
        { status: 409 },
      )
    }
    /*
     * Two senders on one mailbox would be the same address offered twice in
     * the composer, distinguishable only by a display name the recipient sees
     * and the person choosing does not.
     */
    if (senders.some((sender) => sender.localPart === mailbox.localPart)) {
      return Response.json(
        {
          error: `This site already sends as ${mailbox.localPart}@. Edit that sender instead.`,
        },
        { status: 409 },
      )
    }
    const senderId = createResourceUid()
    const created: HostSenderRecord = {
      id: senderId,
      localPart: mailbox.localPart,
      fromName: nextFromName,
      replyTo: nextReplyTo,
      isDefault: false,
      createdAtMs: Date.now(),
    }
    await sendersRef.doc(senderId).set({
      localPart: created.localPart,
      ...(created.fromName ? { fromName: created.fromName } : {}),
      ...(created.replyTo ? { replyTo: created.replyTo } : {}),
      createdAtMs: created.createdAtMs,
    })
    if (body?.['makeDefault'] === true) {
      await projectDefaultSender(created)
    }
    return Response.json({
      senderId,
      localPart: created.localPart,
      from: hostSenderAddress(created.localPart, selectedDomain),
    })
  }

  if (action === 'updateSender') {
    const senders = await materializeSenders()
    const target = targetSender(senders, body?.['senderId'])
    if (!target) {
      return Response.json({ error: UNKNOWN_SENDER_REFUSAL }, { status: 404 })
    }
    if (mailbox?.localPart && !hasOwnDomain) {
      return Response.json({ error: POOLED_MAILBOX_REFUSAL }, { status: 409 })
    }
    if (
      mailbox?.localPart &&
      senders.some(
        (sender) =>
          sender.id !== target.id && sender.localPart === mailbox.localPart,
      )
    ) {
      return Response.json(
        {
          error: `This site already sends as ${mailbox.localPart}@. Edit that sender instead.`,
        },
        { status: 409 },
      )
    }
    const next: HostSenderRecord = {
      ...target,
      ...(mailbox?.localPart ? { localPart: mailbox.localPart } : {}),
      ...(fromNameGiven ? { fromName: nextFromName } : {}),
      ...(replyToGiven ? { replyTo: nextReplyTo } : {}),
    }
    await sendersRef.doc(target.id).set(
      {
        ...(mailbox?.localPart ? { localPart: mailbox.localPart } : {}),
        ...(fromNameGiven
          ? {
              fromName:
                nextFromName || firebaseAdmin.firestore.FieldValue.delete(),
            }
          : {}),
        ...(replyToGiven
          ? {
              replyTo:
                nextReplyTo || firebaseAdmin.firestore.FieldValue.delete(),
            }
          : {}),
      },
      { merge: true },
    )
    if (target.isDefault) await projectDefaultSender(next)
    return Response.json({
      senderId: next.id,
      localPart: next.localPart,
      from: hostSenderAddress(next.localPart, selectedDomain),
    })
  }

  if (action === 'deleteSender') {
    const senders = await materializeSenders()
    const target = targetSender(senders, body?.['senderId'])
    if (!target) {
      return Response.json({ error: UNKNOWN_SENDER_REFUSAL }, { status: 404 })
    }
    /*
     * The default is removed by naming another one first, rather than by this
     * write choosing a replacement. Every site sends as something, and picking
     * the successor here would decide what a merchant's mail looks like from
     * an ordering they never saw.
     */
    if (target.isDefault) {
      return Response.json(
        {
          error:
            'This is the sender email goes out as when a campaign names no ' +
            'other. Make a different sender the default first, then remove ' +
            'this one.',
        },
        { status: 409 },
      )
    }
    await sendersRef.doc(target.id).delete()
    return Response.json({ senderId: target.id, deleted: true })
  }

  if (action === 'makeDefaultSender') {
    const senders = await materializeSenders()
    const target = targetSender(senders, body?.['senderId'])
    if (!target) {
      return Response.json({ error: UNKNOWN_SENDER_REFUSAL }, { status: 404 })
    }
    await projectDefaultSender(target)
    return Response.json({
      senderId: target.id,
      localPart: target.localPart,
      from: hostSenderAddress(target.localPart, selectedDomain),
    })
  }

  if (action) {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  /*
   * A BODY WITH NO `domain` KEY IS NOT A REQUEST TO CHANGE THE DOMAIN.
   *
   * Absent and empty part ways here. An empty `domain` has always meant "move
   * this site back to the one Aglyn issues it", and the drawer that sets who
   * the site sends AS must not be able to say that by accident: a site
   * sending as its own verified `acme.com` would have its selection reset the
   * first time somebody edited the sender name.
   *
   * BELOW THE WHOLE ACTION DISPATCH, and that order is load-bearing. Not one
   * of the four actions names a domain, so reaching this first would swallow
   * every one of them — the sender fields would be stored, a 200 returned
   * carrying the selection the site already had, and nothing claimed and no
   * sender written. An explicit action is not the same thing as a body that
   * did not mention the domain.
   */
  if (body?.['domain'] === undefined) {
    if (mailbox?.localPart && !hasOwnDomain) {
      return Response.json({ error: POOLED_MAILBOX_REFUSAL }, { status: 409 })
    }
    await hostRef.set(senderPatch(), { merge: true })
    await mirrorDefaultSender()
    return Response.json({
      selected: selectedDomain,
      localPart: mailbox?.localPart || localPart,
      fromName: fromNameGiven ? nextFromName || null : senderName || null,
      replyTo: replyToGiven ? nextReplyTo || null : senderReplyTo || null,
    })
  }

  /*
   * Clearing the selection moves this site to the domain it was ISSUED if it
   * has one, and to the shared pool if it has not. Never to `aglyn.com`.
   *
   * Sending as `aglyn.com` is what this whole feature exists to stop: a site's
   * list quality must not be charged against the domain the platform's own
   * billing and account mail depends on.
   *
   * WHICH OF THE TWO IS A READ, NOT A CLAIM. This branch used to call the
   * claim defensively, so a site with no issued domain got one here. That made
   * "stop using our own domain" the cheapest route to the provider's domain
   * ceiling, reached through a control whose label promises the opposite of
   * acquiring something — and it spent a slot and three zone records on a
   * merchant who had just said they wanted less, not more.
   *
   * Clearing to the pool is safe in a way it was not before: a site with no
   * sending domain sends its transactional mail pooled rather than refusing
   * everything, so an admin doing this cannot switch their receipts off.
   *
   * What they DO lose is marketing, and that must not be silent. The response
   * says so, and the identity summary the surface reloads says it again —
   * which is the difference between a demotion somebody chose and one that
   * happened to them. Getting it back is one request away, on this same route.
   */
  if (!requested || requested === 'platform') {
    const issued = platformSendingDomainFor(
      String(hostSnapshot.get('sendingLabel') ?? ''),
    )

    /*
     * A mailbox cannot be stored on the way to the pool, for the reason the
     * refusal itself gives: a shared member's address is where every site on
     * it gets its bounces back, so it is not one site's to name. Refused here
     * as well as at the mailbox-only branch, because a body that clears the
     * domain and sets a mailbox in one call reaches this one instead.
     */
    if (mailbox?.localPart && !issued) {
      return Response.json({ error: POOLED_MAILBOX_REFUSAL }, { status: 409 })
    }

    await hostRef.set(
      {
        sendingDomain: issued
          ? issued
          : firebaseAdmin.firestore.FieldValue.delete(),
        ...senderPatch(),
      },
      { merge: true },
    )
    await mirrorDefaultSender()
    const clearedMailbox = mailbox?.localPart || localPart
    return Response.json({
      selected: issued || '',
      localPart: clearedMailbox,
      ...(issued
        ? { from: `${clearedMailbox}@${issued}` }
        : {
            pooled: true,
            warning:
              'This site now sends on the shared Aglyn address. Receipts and ' +
              'account email keep going out; marketing email does not leave ' +
              'on that address, so campaigns are blocked until this site has ' +
              'a domain of its own again.',
          }),
    })
  }

  /*
   * THE PLAN GATE APPLIES TO A CUSTOM DOMAIN, AND ONLY TO ONE.
   *
   * It used to sit above the clear-the-selection branch too, which was
   * harmless while clearing meant "send as Aglyn" — the shared domain was
   * free to everyone. It is not harmless now: clearing means "send as your own
   * `{label}.mail.aglyn.app`", which is the PLATFORM DEFAULT, and a site that
   * cannot reach its default cannot send at all. Gating it would make an
   * un-entitled site's mail stop, which is worse than the shared-domain
   * behavior this replaced.
   *
   * Sending as a domain the CUSTOMER owns is the paid capability, and it
   * starts at Pro.
   */
  if (!entitled) {
    return Response.json(
      {
        error:
          (customDomainPlan
            ? `Sending as your own domain starts on the ${customDomainPlan} plan.`
            : 'Sending as your own domain is not available on this plan.') +
          ' This site keeps sending on the address Aglyn issues it either way.',
      },
      { status: 403 },
    )
  }

  const domain = normalizeSendingDomain(requested)
  const records = orgId ? await listSendingDomains(orgId) : []
  const record = records.find((entry) => entry.domain === domain)
  if (!record) {
    return Response.json(
      {
        error:
          `This workspace has not claimed ${domain}. Add it below, publish ` +
          `the records it gives you, and verify it first.`,
      },
      { status: 404 },
    )
  }
  if (record.status !== 'verified') {
    /*
     * Refused at the point of CHOICE rather than at the point of send.
     *
     * The send would refuse it too — that is the boundary and it is proved in
     * `campaign-send.spec.ts`. But a site left pointing at an unfinished
     * domain is a site whose every campaign fails until somebody notices, and
     * the person who could have fixed it was standing right here.
     */
    return Response.json(
      {
        error:
          `${domain} is not verified yet, so this site cannot send as it. ` +
          `Publish the records shown for it, verify, then choose it here.`,
        status: record.status,
      },
      { status: 409 },
    )
  }

  await hostRef.set(
    { sendingDomain: domain, ...senderPatch() },
    { merge: true },
  )
  await mirrorDefaultSender()
  const appliedLocalPart = mailbox?.localPart || localPart
  return Response.json({
    selected: domain,
    localPart: appliedLocalPart,
    from: `${appliedLocalPart}@${domain}`,
  })
}

export { handler as GET, handler as POST }
