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
  normalizeLocalPart,
  normalizeSendingDomain,
  platformSendingDomainFor,
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'
import { DEDICATED_SENDING_DOMAIN_MIN_PLAN } from '@aglyn/aglyn/app-utils/dedicated-sending-domain'
import {
  PLAN_LABELS,
  planLabelGrantingFeature,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

export const dynamic = 'force-dynamic'

/** The mailbox a site sends as when it has never chosen one. */
const DEFAULT_LOCAL_PART = 'hello'

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
    DEFAULT_LOCAL_PART

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
  const nextLocalPart =
    normalizeLocalPart(String(body?.['localPart'] ?? '')) || DEFAULT_LOCAL_PART

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
          error: dedicatedDomainPlan
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

    await hostRef.set(
      {
        sendingDomain: provisioned.domain,
        sendingLocalPart: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    // `from` as well as its two halves, matching the selection branch below,
    // so a surface reporting the new address reads one field rather than
    // assembling one — and cannot assemble a different address from the one
    // the send path will use.
    return Response.json({
      selected: provisioned.domain,
      localPart: DEFAULT_LOCAL_PART,
      from: `${DEFAULT_LOCAL_PART}@${provisioned.domain}`,
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
    { sendingDomain: domain, sendingLocalPart: nextLocalPart },
    { merge: true },
  )
  return Response.json({
    selected: domain,
    localPart: nextLocalPart,
    from: `${nextLocalPart}@${domain}`,
  })
}

export { handler as GET, handler as POST }
