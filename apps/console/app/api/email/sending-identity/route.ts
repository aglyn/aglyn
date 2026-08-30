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
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'

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
  /** `platform`, or the domain. Sent back as `sendingIdentity` on a send. */
  value: string
  from: string | null
  /** False for a domain whose DNS is unfinished — offered, never selectable. */
  selectable: boolean
  status: SendingDomainRecord['status'] | 'platform'
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
  // Same entitlement as the domains route: sending as your own domain IS
  // white-labeling the mail.
  const entitled = Boolean(org) && checkEntitlement(org as never, 'whiteLabel')

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
      selectedDomain,
      selectedLocalPart: localPart,
    })

    const options: IdentityOption[] = [
      {
        value: 'platform',
        from: process.env.USAGE_EMAIL_FROM || null,
        // The shared domain is always selectable when it is configured at
        // all. `platform-unconfigured` is an operator's problem, and it
        // surfaces as the refusal on `resolved` rather than as a missing row.
        selectable: Boolean(process.env.USAGE_EMAIL_FROM),
        status: 'platform',
      },
    ]
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
    if (selectedDomain) {
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
       * What the composer sends back, and it is NOT the domain: the send path
       * accepts the reserved `platform` or nothing at all. Reported as the
       * chosen option's `value` so the control has one identifier, and read
       * on the way in as the two-valued thing it is.
       */
      selected: selectedDomain || 'platform',
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
  if (!entitled) {
    return Response.json(
      { error: 'Custom sending domains require the Agency plan' },
      { status: 403 },
    )
  }

  const requested = String(body?.['domain'] ?? '').trim()
  const nextLocalPart =
    normalizeLocalPart(String(body?.['localPart'] ?? '')) || DEFAULT_LOCAL_PART

  /*
   * Clearing the selection moves this site back to the shared domain, and it
   * is an explicit act rather than the absence of one.
   *
   * Distinct from the fallback this feature forbids: nothing here happens
   * because a verification failed. An admin said "send as Aglyn again", which
   * they are entitled to say.
   */
  if (!requested || requested === 'platform') {
    await hostRef.set(
      {
        sendingDomain: firebaseAdmin.firestore.FieldValue.delete(),
        sendingLocalPart: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    return Response.json({ selected: 'platform', localPart: DEFAULT_LOCAL_PART })
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
