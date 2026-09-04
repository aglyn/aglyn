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

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listSendingDomains,
  lockdownRefusal,
  readDmarcPolicy,
  readTrackingCaaNeed,
  releaseSendingDomain,
  requestSendingDomain,
  verifySendingDomain,
} from '@aglyn/tenant-data-admin'
import {
  dmarcRecommendation,
  formatSendingRecord,
  sendingDnsRecords,
  sendingTrackingCertAuthority,
  type SendingDnsRecord,
} from '@aglyn/shared-util-email'
import { issueSendingDomainRecords } from '../../../../utils/server/issue-sending-domain'

export const dynamic = 'force-dynamic'

/**
 * The records for one domain, with the CAA shown only to a domain that needs
 * it.
 *
 * `sendingDnsRecords` is pure and cannot ask DNS anything, so the decision
 * lives here beside the DMARC read — the same shape, for the same reason: a
 * fact about the customer's live zone that changes what we tell them, and
 * that a pure generator must not pretend to know.
 *
 * ⚠️ The CAA is the one record in the set that can BREAK something. It
 * restricts which authorities may issue a certificate for a name, and the
 * lookup stops at the first name in the tree publishing any — so a domain
 * with none needs nothing, and pasting one in would be the change that starts
 * restricting whatever else renews there. Shipping it with a cautionary note
 * and hoping it is read is not the same as not shipping it: the record is
 * dropped outright unless the zone already publishes CAA that would refuse
 * the tracking host's certificate.
 *
 * An unreachable lookup drops it too. "We could not tell" must resolve toward
 * the instruction that cannot hurt.
 */
async function recordsFor(
  record: Parameters<typeof sendingDnsRecords>[0],
): Promise<SendingDnsRecord[]> {
  const records = sendingDnsRecords(record)
  if (!records.some((entry) => entry.purpose === 'tracking-caa')) return records
  const need = await readTrackingCaaNeed(
    record.domain,
    sendingTrackingCertAuthority(),
  )
  if (need === 'must-add') return records
  return records.filter((entry) => entry.purpose !== 'tracking-caa')
}

/**
 * The records a customer must publish to send as their own domain, and the
 * check that decides whether they did.
 *
 * ## The records are shown, never guessed at
 *
 * `GET` returns the exact SPF, DKIM and return-path records for the domain,
 * built by `sendingDnsRecords` — the same function the verifier compares
 * against, so what a customer is told to publish and what we accept cannot
 * drift. `tenant-dns.ts` documents what the alternative cost for site domains:
 * a wizard printing one target while the route checked another produced a
 * check that could not fail, then one that could not pass.
 *
 * DMARC is returned as a READ, plus a suggestion for a domain that has none.
 * A customer's DMARC policy is theirs; we must know it, because it decides
 * whether unauthenticated mail is filed as spam or refused outright, and we
 * must never ask them to weaken it.
 *
 * ## Org-scoped, and gated on `customSendingDomain`
 *
 * Its own entitlement rather than `whiteLabel`, which replaces the Aglyn brand
 * across every surface: sending as your own name is one narrow consequence of
 * white-labeling, and a shared flag would drag the whole of it down the ladder
 * behind this one capability. `customDomain` is the SITE's public web address
 * and authorizes nothing about mail.
 *
 * It sits at Pro because that is where campaign email starts, and because a
 * domain the CUSTOMER owns is the option that costs this platform nothing in
 * its own zone — the records are published in theirs. The subdomain a site is
 * issued costs a provider slot, three records here and a permanent place in
 * the re-verification sweep, so it is the one that has to be rationed.
 *
 * ## What a `verified` here does and does not mean
 *
 * It means a lookup saw the records. It does not schedule anything: nothing
 * re-checks a domain after this route flips it, so a customer who removes
 * their DKIM record months later keeps sending until someone verifies again.
 * The re-check sweep is specified in `docs/design/email-sending-domains.md`
 * and is deliberately not implemented here rather than half-implemented.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body } = await pluginRequestFromWeb(request)
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
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

  const orgId = String(query['orgId'] ?? body?.['orgId'] ?? '').trim()
  if (!orgId) {
    return Response.json({ error: 'Missing orgId' }, { status: 400 })
  }

  const firestore = firebaseAdmin.app().firestore()
  const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
  if (!orgSnapshot.exists) {
    return Response.json({ error: 'Unknown organization' }, { status: 404 })
  }

  // Owner or admin only. A sending domain decides what every recipient of
  // this org's mail sees in the `From:` line, which is not an editor's call.
  const memberSnapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(decoded.uid)
    .get()
  const role = String(memberSnapshot.get('role') ?? '')
  if (role !== 'owner' && role !== 'admin' && decoded['staff'] !== true) {
    return Response.json({ error: 'Not an organization admin' }, { status: 403 })
  }

  // Passing `request` derives the intent from the verb, so a read-only lock
  // still answers the GET while a full lock refuses everything.
  const locked = await lockdownRefusal({
    request,
    staff: decoded['staff'] === true,
    uid: decoded.uid,
    org: orgSnapshot.data() as never,
  })
  if (locked) return locked

  if (!checkEntitlement(orgSnapshot.data() as never, 'customSendingDomain')) {
    return Response.json(
      {
        error:
          'Sending as your own domain starts on the Pro plan. Until then this ' +
          'site sends on a shared Aglyn address, whose delivery reputation is ' +
          'pooled with the other sites on it.',
      },
      { status: 403 },
    )
  }

  if (method === 'GET') {
    const domains = await listSendingDomains(orgId)
    return Response.json({
      domains: await Promise.all(
        domains.map(async (record) => {
          const records = await recordsFor(record)
          return {
            ...record,
            records,
            /** Copy-paste lines, so a surface never re-derives the format. */
            lines: records.map(formatSendingRecord),
            dmarc: await readDmarcPolicy(record.domain),
            dmarcSuggestion: dmarcRecommendation(record.domain),
          }
        }),
      ),
    })
  }

  if (method === 'DELETE') {
    const domain = String(query['domain'] ?? body?.['domain'] ?? '')
    await releaseSendingDomain(orgId, domain)
    return Response.json({ released: true })
  }

  const action = String(body?.['action'] ?? 'request')
  const domain = String(body?.['domain'] ?? '')

  if (action === 'verify') {
    const result = await verifySendingDomain(orgId, domain)
    if (result.error) {
      return Response.json({ error: result.error }, { status: 404 })
    }
    /*
     * A lookup nobody answered is a 503, not a verification failure.
     *
     * Answering 200 with `verified: false` would tell a customer whose DNS is
     * correct that their records are missing, and send them to edit a zone
     * that has nothing wrong with it. The status says "ask again", which is
     * the truthful answer and the one their next click acts on.
     */
    if (result.inconclusive) {
      return Response.json(
        {
          error:
            'We could not reach DNS to check those records. Nothing has ' +
            'changed — try again in a few minutes.',
          status: result.record?.status ?? null,
        },
        { status: 503 },
      )
    }
    return Response.json({
      domain: result.record?.domain ?? null,
      status: result.record?.status ?? null,
      verified: result.record?.status === 'verified',
      missing: result.missing,
      records: result.record ? await recordsFor(result.record) : [],
      dmarc: await readDmarcPolicy(domain),
    })
  }

  const result = await requestSendingDomain({ orgId, domain })
  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  /*
   * Ask the mail provider for a signing key, if this deployment has a
   * credential that can create one.
   *
   * After the claim, never instead of it. The claim is what makes the request
   * idempotent and what a failure has somewhere to be recorded against; the
   * issuing call is allowed to do nothing at all — an unconfigured deployment,
   * or a provider that refused — and the domain then stays at `requested`,
   * which is exactly what `pendingProvider` below reports.
   */
  const issued = await issueSendingDomainRecords({ orgId, record: result.record })
  const records = await recordsFor(issued.record)
  return Response.json(
    {
      ...issued.record,
      records,
      lines: records.map(formatSendingRecord),
      dmarc: await readDmarcPolicy(issued.record.domain),
      dmarcSuggestion: dmarcRecommendation(issued.record.domain),
      /*
       * A domain that has no DKIM key yet cannot be published or verified.
       * Said plainly rather than shown as an empty record, because a blank
       * value in a records table reads as our bug — which, from the
       * customer's side, it is.
       */
      pendingProvider: issued.record.status === 'requested',
      /*
       * A code, never a provider's prose and never a credential — see
       * `KNOWN_PROVIDER_ERRORS`. It is the difference between "this
       * deployment cannot issue keys" and "the provider refused this domain",
       * which are two different people's problems.
       */
      providerDetail: issued.detail ?? null,
    },
    { status: result.status },
  )
}

export { handler as GET, handler as POST, handler as DELETE }
