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
 * The mailbox is stored per site rather than taken per send, because it
 * addresses a real mailbox: it is where a bounce returns and where a client
 * that ignores `Reply-To:` will answer. `campaign-send.ts` states the same
 * boundary from the other end — the sending identity named in a send request
 * is read by nothing — and a per-send mailbox would reopen exactly that path.
 *
 * It is also the reason the two writes have different gates. Choosing the
 * address every recipient of this site's mail sees is an `org.settings`
 * decision, and the composer, which is admin-or-editor, may only choose the
 * name in front of it.
 */

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  ensureHostSendingDomain,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  listSendingDomains,
  lockdownRefusal,
  memberHasOrgPermission,
  resolveHostSendingIdentity,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  DEFAULT_SENDING_LOCAL_PART,
  headerSafeText,
  normalizeLocalPart,
  normalizeSendingDomain,
  platformSendingDomainFor,
  SENDING_FROM_NAME_MAX,
  SENDING_REPLY_TO_MAX,
  validateSendingLocalPart,
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'
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

  if (method === 'GET') {
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

    const options: IdentityOption[] = []
    if (platformDomain) {
      options.push({
        value: platformDomain,
        from: `${localPart}@${platformDomain}`,
        // Selectable only once it verifies, exactly like a customer's own
        // domain. Provisioning is automatic, not instantaneous.
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
   * A BODY WITH NO `domain` KEY IS NOT A REQUEST TO CHANGE THE DOMAIN.
   *
   * Absent and empty part ways here. An empty `domain` has always meant "move
   * this site back to the one Aglyn issues it", and the drawer that sets who
   * the site sends AS must not be able to say that by accident: a site
   * sending as its own verified `acme.com` would have its selection reset the
   * first time somebody edited the sender name.
   */
  if (body?.['domain'] === undefined) {
    /*
     * `sendingLabel`, not `sendingDomain`. The label is the pinned claim and
     * is what makes a domain this site's own; the selection can be empty for
     * a site whose provisioning has not finished attaching it yet, and a
     * mailbox stored in that window is correct and simply not yet in use.
     */
    const hasOwnDomain =
      Boolean(selectedDomain) ||
      Boolean(String(hostSnapshot.get('sendingLabel') ?? '').trim())
    if (mailbox?.localPart && !hasOwnDomain) {
      return Response.json({ error: POOLED_MAILBOX_REFUSAL }, { status: 409 })
    }
    await hostRef.set(senderPatch(), { merge: true })
    return Response.json({
      selected: selectedDomain,
      localPart: mailbox?.localPart || localPart,
      fromName: fromNameGiven ? nextFromName || null : senderName || null,
      replyTo: replyToGiven ? nextReplyTo || null : senderReplyTo || null,
    })
  }

  /*
   * Clearing the selection moves this site back to ITS OWN provisioned
   * domain — `{label}.mail.aglyn.app` — and never to the shared Aglyn one.
   *
   * Sending as `aglyn.com` is what this whole feature exists to stop: a
   * site's list quality must not be charged against the domain the platform's
   * own billing and account mail depends on.
   *
   * Clearing to the shared pool instead would be a quiet demotion. The pool
   * carries transactional mail only, so a site moved there stops being able
   * to send campaigns — which is not what "stop using our own domain" asks
   * for, and not something to do to a site whose plan entitles it to a name
   * of its own.
   *
   * `ensureHostSendingDomain` rather than a bare read, so a site that somehow
   * has no claim gets one here instead of being left on the pool. It is
   * idempotent, so a site that already has one keeps exactly the name it has,
   * and it refuses below the dedicated tier — which the 409 below explains.
   */
  if (!requested || requested === 'platform') {
    const provisioned = await ensureHostSendingDomain({
      hostId,
      orgId,
      subdomain: String(hostSnapshot.get('subdomain') ?? ''),
    }).catch(() => null)

    if (!provisioned?.domain) {
      /*
       * NAME THE REASON, WHICH IS ALMOST ALWAYS THE PLAN.
       *
       * `ensureHostSendingDomain` refuses below the dedicated tier, so the
       * common case here is a site that is not entitled to a domain of its
       * own rather than one whose provisioning is in flight. Telling such a
       * merchant to "try again shortly" sends them to wait for something that
       * is never coming, which is the shape of refusal this whole surface
       * exists to avoid.
       *
       * Nothing about the site's mail is broken meanwhile: it keeps sending
       * its receipts on the shared address, which is what makes this a
       * refusal of a CHOICE rather than of a send.
       */
      return Response.json(
        {
          /*
           * A chosen mailbox is refused for its own reason, which is about
           * the pool rather than the plan: the address on a shared member is
           * where every site on it gets its bounces back, so it is not one
           * site's to name. Everything else answers with the plan that
           * carries a domain of the site's own.
           */
          error: mailbox?.localPart
            ? POOLED_MAILBOX_REFUSAL
            : dedicatedDomainPlan
              ? `A sending domain of this site’s own comes with ${dedicatedDomainPlan}. ` +
                'Until then this site sends its receipts and account email on ' +
                'the shared address, and marketing email needs a domain ' +
                'of its own.'
              : 'This site does not have a sending domain of its own, so it ' +
                'cannot be moved back to one. It sends its receipts and ' +
                'account email on the shared address meanwhile.',
        },
        { status: 409 },
      )
    }

    /*
     * The mailbox SURVIVES a change of domain, and is only rewritten when the
     * body names one.
     *
     * It used to be deleted here, which made "stop using our own domain" also
     * mean "and go back to sending as hello@" — two decisions taken by one
     * control, one of them silently. Which mailbox a site sends as and which
     * domain it sends on are set from different places and answer different
     * questions, so moving one leaves the other where its owner put it.
     */
    await hostRef.set(
      { sendingDomain: provisioned.domain, ...senderPatch() },
      { merge: true },
    )
    // `from` as well as its two halves, matching the selection branch below,
    // so a surface reporting the new address reads one field rather than
    // assembling one — and cannot assemble a different address from the one
    // the send path will use.
    return Response.json({
      selected: provisioned.domain,
      localPart: mailbox?.localPart || localPart,
      from: `${mailbox?.localPart || localPart}@${provisioned.domain}`,
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
  const appliedLocalPart = mailbox?.localPart || localPart
  return Response.json({
    selected: domain,
    localPart: appliedLocalPart,
    from: `${appliedLocalPart}@${domain}`,
  })
}

export { handler as GET, handler as POST }
