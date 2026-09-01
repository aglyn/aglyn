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
 * A SENDING DOMAIN OUTLIVING ITS OWNER — the debt, and who settles it.
 *
 * A site's dedicated sending domain is three resources at three different
 * lifetimes: a domain object at the mail provider (one of a small, plan-capped
 * number of account slots), three records in our own DNS zone, and our
 * Firestore state. Destroying the site destroys none of them. Until this
 * module existed only `/api/hosts/delete` ever released them, so every other
 * way a site could stop existing — an org erasure, a host erasure inside one —
 * spent a provider slot forever and left a live DKIM key in the zone for a
 * name a future site could claim.
 *
 * ## Erasure must not be able to fail because a vendor is down
 *
 * An erasure is a legal obligation with a clock on it. A provider outage, a
 * revoked token or an unconfigured self-host must not stop it, must not leave
 * it half-done, and must not silently drop a slot on the floor either.
 *
 * So the vendor work is ATTEMPTED and the outcome is either settled or
 * RECORDED AS A DEBT. The erasure then proceeds regardless, and a sweep
 * collects the debt later. Nothing here throws.
 *
 * ## The tombstone is the label claim, which is why there is no new collection
 *
 * `sendingLabels/{label}` is a ROOT document created at the moment a site
 * claims its name. Nothing destroys it implicitly: it is outside
 * `recursiveDelete(hosts/{hostId})` and outside `recursiveDelete(orgs/{orgId})`,
 * so it is the ONE record of a site's sending domain that survives both an
 * erased host and an erased workspace. `orgs/{orgId}/sendingDomains/{domain}`,
 * which is where the provider's id and the DKIM selector live, does not — an
 * org erasure destroys it, and with it the only handle on the slot to release.
 *
 * That makes the claim the natural tombstone rather than a designed one, and
 * `releaseHostSendingDomain` already says so in as many words: while the claim
 * exists, a half-finished teardown is a thing a sweep can find and finish. All
 * this adds is the two facts the claim did not carry — the provider's domain
 * id and the selector — copied onto it BEFORE the record holding them goes
 * away, plus a mark saying the owner is gone.
 *
 * A separate `sendingDomainDebts` collection would have needed its own rules,
 * its own index and its own reconciliation with the claim it duplicates, and
 * would have introduced the state this design cannot produce: a debt whose
 * label claim was already released, naming a name a new site can take.
 *
 * ## What the reaper is FORBIDDEN to touch
 *
 * The four shared pool domains (`shared1.mail.aglyn.app` …) are owned by no
 * host by design, so "nothing points at this" describes them exactly. They
 * have no label claim — pool labels are reserved against tenants and
 * `ensureHostSendingDomain` is the only writer of that collection — so a sweep
 * over `sendingLabels` cannot reach one by construction. Every path here still
 * asks {@link sendingDomainTeardownRefusal} before acting, because a guard
 * that rests only on a scan's starting point is a guard the next scan loses.
 */

import {
  platformSendingDomainFor,
  sendingDomainTeardownRefusal,
} from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import {
  SENDING_LABELS_COLLECTION,
  releaseHostSendingDomain,
  type HostSendingDomainTeardown,
} from './host-sending-domain'
import { SENDING_DOMAINS_COLLECTION, readSendingDomainRecord } from './sending-domains'

const firestore = () => firebaseAdmin.app().firestore()

/**
 * The console-side teardown, injected rather than imported.
 *
 * Releasing the provider's domain object needs a full-access mail credential
 * and removing the zone records needs a DNS token, and neither may be
 * reachable from the tenant runtime — which is what makes them live in
 * `apps/console` and makes this library structurally unable to import them
 * (`sending-domain-credential-isolation.spec.ts` sweeps the tree for it).
 *
 * A caller that HAS those credentials passes the driver in and the domain is
 * released inline. A caller that does not — the tenant runtime, an operator
 * script, a self-host with no provider configured — records the debt and the
 * console's reaper settles it. Both are correct; only the latency differs.
 */
export type TeardownSendingDomainDriver = (
  teardown: HostSendingDomainTeardown,
) => Promise<{ outcome: 'removed' | 'skipped' | 'failed'; detail: string | null }>

/** What became of one site's dedicated sending domain. */
export type SendingDomainDisposition =
  /** The site had no dedicated domain of its own. Nothing to release. */
  | 'none'
  /** Provider slot freed, zone records removed, our records dropped. */
  | 'released'
  /** The debt is recorded on the label claim; the reaper owes it a visit. */
  | 'deferred'
  /** A shared pool member. Never torn down, by anything, ever. */
  | 'protected'

export interface SendingDomainDebtRecord {
  /** The claimed label, and the id of the claim document. */
  label: string
  hostId: string | null
  orgId: string | null
  domain: string | null
  claimedAtMs: number | null
  /** Set when a teardown could not be completed. Null on a healthy claim. */
  orphanedAtMs: number | null
  /** A short code naming what refused, safe to store, log and show. */
  teardownDetail: string | null
  /** How many passes have tried and failed to settle this. */
  teardownAttempts: number
  providerDomainId: string | null
  dkimSelector: string | null
}

const labelRef = (label: string) =>
  firestore().collection(SENDING_LABELS_COLLECTION).doc(label)

/** One claim document as a debt record. */
export function readSendingDomainDebt(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): SendingDomainDebtRecord | null {
  if (!snapshot?.exists) return null
  const data = snapshot.data() ?? {}
  return {
    // The document id IS the label — that is what makes the claim atomic — so
    // it is authoritative over the denormalised field beside it, and it is
    // what a paging cursor has to be built from.
    label: String(snapshot.id || data.label || ''),
    hostId: String(data.hostId ?? '').trim() || null,
    orgId: String(data.orgId ?? '').trim() || null,
    domain: String(data.domain ?? '').trim() || null,
    claimedAtMs: Number(data.claimedAtMs) || null,
    orphanedAtMs: Number(data.orphanedAtMs) || null,
    teardownDetail: String(data.teardownDetail ?? '').trim() || null,
    teardownAttempts: Number(data.teardownAttempts) || 0,
    providerDomainId: String(data.providerDomainId ?? '').trim() || null,
    dkimSelector: String(data.dkimSelector ?? '').trim() || null,
  }
}

/**
 * Everything needed to release one PINNED label's domain, read by label.
 *
 * Keyed on the label and never on `hosts/{hostId}.sendingDomain`, and the
 * difference is not cosmetic. That field is the site's CURRENT SELECTION and a
 * site may point it at the org's own verified domain through the sending
 * identity surface — a name this deployment did not provision, holds no
 * provider slot for, and whose record belongs to the ORG and is shared with
 * every other site of theirs. A teardown that read the selection would release
 * an agency's verified domain because one of its sites was deleted.
 *
 * The label is the thing this deployment actually created, it is written once
 * and never rewritten, and {@link platformSendingDomainFor} re-derives the
 * domain from it under the current apex and the current reserved set.
 *
 * Works for a host that no longer exists: the claim carries the org, and the
 * provider id and selector are copied onto the claim before an erasure
 * destroys the record they came from.
 */
export async function readSendingDomainTeardownByLabel(
  label: string | null | undefined,
): Promise<HostSendingDomainTeardown | null> {
  const name = String(label ?? '').trim()
  if (!name) return null

  const claim = await labelRef(name)
    .get()
    .catch(() => null)
  const debt = claim ? readSendingDomainDebt(claim) : null
  if (!debt) return null

  const domain = platformSendingDomainFor(name) || debt.domain
  if (!domain) return null

  let providerDomainId = debt.providerDomainId
  let dkimSelector = debt.dkimSelector
  let trackingTarget: string | null = null
  if (debt.orgId && (!providerDomainId || !dkimSelector)) {
    const record = readSendingDomainRecord(
      await firestore()
        .collection('orgs')
        .doc(debt.orgId)
        .collection(SENDING_DOMAINS_COLLECTION)
        .doc(domain)
        .get()
        .catch(() => null as never),
    )
    providerDomainId = providerDomainId ?? record?.providerDomainId ?? null
    dkimSelector = dkimSelector ?? (String(record?.dkimSelector ?? '').trim() || null)
    trackingTarget = String(record?.trackingTarget ?? '').trim() || null
  }

  return {
    hostId: debt.hostId ?? '',
    orgId: debt.orgId,
    label: name,
    domain,
    providerDomainId,
    dkimSelector,
    trackingTarget,
  }
}

/**
 * Copy the vendor handles onto the claim and mark the owner gone.
 *
 * Written with `merge` onto a document that already exists, so it adds the
 * debt to the claim rather than replacing it — the `hostId` the claim carries
 * is what `releaseHostSendingDomain` matches on before deleting it, and losing
 * that would strand the claim permanently.
 *
 * `teardownAttempts` increments so a debt that cannot be settled — a provider
 * that has forgotten the domain, a token that was never restored — is visible
 * as a number climbing rather than as a row that looks the same every day.
 */
export async function recordSendingDomainDebt(
  teardown: HostSendingDomainTeardown,
  detail: string | null,
): Promise<void> {
  const label = String(teardown?.label ?? '').trim()
  if (!label) return
  const ref = labelRef(label)
  await firestore()
    .runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return
      const attempts = Number(snapshot.get('teardownAttempts')) || 0
      transaction.set(
        ref,
        {
          orphanedAtMs: Number(snapshot.get('orphanedAtMs')) || Date.now(),
          teardownDetail: String(detail ?? 'unknown'),
          teardownAttempts: attempts + 1,
          providerDomainId: teardown.providerDomainId ?? null,
          dkimSelector: teardown.dkimSelector ?? null,
          domain: teardown.domain ?? null,
        },
        { merge: true },
      )
    })
    .catch(() => undefined)
}

/**
 * Release one site's dedicated sending domain, or record what is still owed.
 *
 * The single entry point for every path that destroys a site. It never throws
 * and it never blocks its caller on a vendor: the worst outcome is a debt on
 * the label claim and a loud line naming the domain.
 *
 * Ordered provider → zone → our records by the driver it calls, for the reason
 * stated there: the provider slot is the scarce resource, and our own record
 * is what keeps a half-finished teardown findable.
 */
export async function disposeHostSendingDomain(options: {
  /** The site being destroyed. Its `sendingLabel` is read before it goes. */
  hostId?: string | null
  /** Pre-read teardown, for a caller that has already lost the host document. */
  teardown?: HostSendingDomainTeardown | null
  tearDown?: TeardownSendingDomainDriver | null
}): Promise<SendingDomainDisposition> {
  const teardown = options?.teardown ?? (await readPinnedTeardown(options?.hostId))
  if (!teardown || !teardown.label || !teardown.domain) return 'none'

  /*==========================================
   * ⛔ THE POOL IS NEVER TORN DOWN.
   *
   * A pool member has no label claim, so nothing should ever reach here
   * naming one — which is exactly why the check is here rather than trusted
   * to the caller's starting point. `shared1.mail.aglyn.app` through
   * `shared4` carry the transactional mail of every site with no domain of
   * its own; releasing one stops a quarter of the platform's receipts and
   * password resets, and stops them silently.
   *=========================================*/
  const refusal = sendingDomainTeardownRefusal(teardown.domain, teardown.label)
  if (refusal === 'shared-pool') {
    console.error(
      '[sending-domain-debt] REFUSED to tear down the shared pool member',
      teardown.domain,
      '— a pool member belongs to the platform, not to a site, and nothing',
      'may release it. Something is pointing a host at a reserved label.',
    )
    return 'protected'
  }
  if (refusal === 'not-our-zone') return 'none'

  if (!options?.tearDown) {
    // No credential in this process. The debt is the honest state: the
    // domain still exists at both vendors and something else must settle it.
    await recordSendingDomainDebt(teardown, 'no-teardown-driver')
    return 'deferred'
  }

  const result = await options
    .tearDown(teardown)
    .catch(() => ({ outcome: 'failed' as const, detail: 'threw' }))

  /*
   * `skipped` with nothing ever created at the provider is a real release.
   *
   * The driver skips when no credential is configured — a self-host with no
   * mail provider, or a token that has been withdrawn. When the record never
   * carried a provider id there is nothing at either vendor to leak: the id
   * and the DKIM key are stored by the same write, and the zone records are
   * only written once a key exists. Deferring that forever would hold a name
   * out of circulation for a domain that was never created.
   */
  const nothingProvisioned =
    result.outcome === 'skipped' && !teardown.providerDomainId
  if (result.outcome === 'removed' || nothingProvisioned) {
    await releaseHostSendingDomain(teardown)
    return 'released'
  }

  await recordSendingDomainDebt(teardown, result.detail || result.outcome)
  console.error(
    '[sending-domain-debt] sending domain not released for',
    teardown.domain,
    `(${result.detail || result.outcome}) — the provider slot and the zone`,
    'records are still held; the reap-sending-domains sweep will retry.',
  )
  return 'deferred'
}

/** The teardown for a host that still exists, taken from its pinned label. */
async function readPinnedTeardown(
  hostId: string | null | undefined,
): Promise<HostSendingDomainTeardown | null> {
  const id = String(hostId ?? '').trim()
  if (!id) return null
  const host = await firestore()
    .collection('hosts')
    .doc(id)
    .get()
    .catch(() => null)
  if (!host?.exists) return null
  const teardown = await readSendingDomainTeardownByLabel(
    String(host.get('sendingLabel') ?? '').trim(),
  )
  // The claim may name a host that has since been re-pointed; the site being
  // destroyed is the one the caller named.
  return teardown ? { ...teardown, hostId: id } : null
}

/**
 * Every label claim, oldest first, for the orphan sweep.
 *
 * Ordered by document id rather than by a field, and paged with a cursor. A
 * `limit()` with no ordering returns an arbitrary but STABLE sample — the same
 * handful every run — and ordering on `claimedAtMs` would silently DROP any
 * claim written before that field existed, which for a reaper means an orphan
 * it can never see. `__name__` is present on every document by definition.
 */
export async function listSendingLabelClaims(options: {
  limit: number
  after?: string | null
}): Promise<SendingDomainDebtRecord[]> {
  const base = firestore()
    .collection(SENDING_LABELS_COLLECTION)
    .orderBy('__name__')
    .limit(Math.max(1, options?.limit ?? 100))
  const after = String(options?.after ?? '').trim()
  const query = after
    ? base.startAfter(
        firestore().collection(SENDING_LABELS_COLLECTION).doc(after),
      )
    : base
  const snapshot = await query.get()
  const rows: SendingDomainDebtRecord[] = []
  for (const doc of snapshot.docs) {
    const debt = readSendingDomainDebt(doc)
    if (debt) rows.push(debt)
  }
  return rows
}
