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
 * THE PER-SITE SENDING DOMAIN — the claim, and nothing else.
 *
 * Provisioning a site's sending domain is two writes to two vendors and one
 * write of our own. This module owns only the third: the LABEL CLAIM and the
 * record that says a domain has been asked for. It calls no vendor, reads no
 * credential, and is safe for the tenant runtime to import — which matters,
 * because the tenant runtime is where a site first discovers it needs to send.
 *
 * The vendor half lives in the console (`provision-sending-domain.ts`), for
 * the same structural reason `sending-domain-provider.ts` does: the keys that
 * create a Resend domain and write our DNS zone must not be reachable from a
 * process that serves published sites.
 *
 * ## Request here, issue there
 *
 * That split is what makes provisioning ON DEMAND possible at all. Anything —
 * including the tenant runtime, at the moment a site first tries to send —
 * may call {@link ensureHostSendingDomain}, which is a cheap Firestore write
 * with no credential behind it. The console-side sweep picks the claim up and
 * does the vendor work. The existing re-check sweep then moves the domain to
 * `verified` on its own.
 *
 * So a site is never blocked waiting on a credential it cannot hold, and the
 * credential is never held by a process that should not have it.
 *
 * ## The label is pinned, and a rename does not move it
 *
 * `hosts/{hostId}.sendingLabel` is written ONCE and never rewritten. A site's
 * `subdomain` is mutable — the rename route rewrites that field in place — and
 * a sending domain derived from it would move every time a merchant renamed
 * their site, discarding the accumulated sending reputation that is the whole
 * point of having a domain per tenant, and stranding the return path that mail
 * already in flight will bounce to.
 *
 * The web address follows the slug. The sending identity does not. A merchant
 * who genuinely wants a different sending name gets
 * {@link restartHostSendingDomain}, which says plainly that it starts
 * reputation over — never a silent side effect of renaming.
 */

import {
  isPlatformSendingDomain,
  mailLabelCandidate,
  normalizeSendingDomain,
  platformSendingApex,
  platformSendingDomainFor,
  platformSendingLabel,
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'
import { planHoldsDedicatedSendingDomain } from '@aglyn/aglyn/app-utils/dedicated-sending-domain'
import firebaseAdmin from './firebase-admin'
import { SENDING_DOMAINS_COLLECTION, readSendingDomainRecord } from './sending-domains'

const firestore = () => firebaseAdmin.app().firestore()

/**
 * Whether this org's sites may hold a dedicated domain, from the stored plan.
 *
 * One read, and only ever on a CLAIM path — never on a send. A site that does
 * not qualify has a sending identity regardless (the shared pool), so nothing
 * here is on the critical path of a message.
 *
 * Fails closed on a read error, and that is the safe direction: the cost of
 * answering `false` wrongly is that a domain is claimed on the next sweep
 * instead of this one, while the cost of answering `true` wrongly is a zone
 * record and a provider slot spent on a site that cannot use them.
 */
export async function orgHoldsDedicatedSendingDomain(
  orgId: string | null | undefined,
): Promise<boolean> {
  const id = String(orgId ?? '').trim()
  if (!id) return false
  const snapshot = await firestore()
    .collection('orgs')
    .doc(id)
    .get()
    .catch(() => null)
  return snapshot?.exists
    ? planHoldsDedicatedSendingDomain(snapshot.get('plan'))
    : false
}

/**
 * The uniqueness index for pinned mail labels.
 *
 * A root collection with the LABEL as the document id, which is what makes the
 * claim atomic: Firestore's `create` fails when the document exists, so two
 * sites racing for one label produce one winner and one retry rather than two
 * winners. This is the same technique the web-subdomain index uses, kept
 * separate from it on purpose — see `platform-sending-domain.ts` for why the
 * two namespaces do not share a claim.
 */
export const SENDING_LABELS_COLLECTION = 'sendingLabels'

/** How many labels to try before giving up on a site's name. */
const MAX_LABEL_ATTEMPTS = 12

const labelRef = (label: string) =>
  firestore().collection(SENDING_LABELS_COLLECTION).doc(label)

export interface SendingLabelClaim {
  label: string
  hostId: string
  orgId: string
  domain: string
  claimedAtMs: number
}

export interface HostSendingDomainResult {
  /** The site's sending domain, or null when none could be provisioned. */
  domain: string | null
  label: string | null
  /** True when this call created the claim rather than finding one. */
  created: boolean
  /** Why nothing could be claimed. Null on success. */
  error: string | null
}

/**
 * Give a site a sending domain, or return the one it already has.
 *
 * Idempotent in the way that matters for a two-vendor provisioning flow: it is
 * the FIRST of the three writes, and it is the one that decides the name. Once
 * it has returned a domain, every retry — of this function, of the Resend
 * call, of the DNS write — resolves against the same name. A retry can
 * therefore never produce a second Resend domain or a second record set,
 * because there is no second name for them to be created under.
 *
 * The three writes it makes are ordered so that a crash between any two leaves
 * a state the sweep can finish rather than one it must untangle:
 *
 * 1. Claim the label. Fails closed on a race; nothing else has happened yet.
 * 2. Create the domain record at `requested`. This is what the console sweep
 *    looks for, so a crash after this point still gets picked up.
 * 3. Point the host at it. A crash before this leaves an unreferenced record
 *    that the sweep will provision and the next call will attach.
 *
 * Step 3 is deliberately last and deliberately non-destructive: a host that
 * already carries a `sendingLabel` returns early at the top and never reaches
 * any of this.
 */
export async function ensureHostSendingDomain(options: {
  hostId: string
  orgId: string
  /** The site's CURRENT subdomain. Read once, to propose a label. */
  subdomain: string
}): Promise<HostSendingDomainResult> {
  const hostId = String(options?.hostId ?? '').trim()
  const orgId = String(options?.orgId ?? '').trim()
  if (!hostId || !orgId) {
    return { domain: null, label: null, created: false, error: 'missing-host' }
  }

  const hostRef = firestore().collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return { domain: null, label: null, created: false, error: 'no-host' }
  }

  /*
   * ALREADY PINNED — the rename guarantee, and the idempotency guarantee, are
   * the same early return.
   *
   * Read from the stored label rather than from the stored domain so the apex
   * remains a configuration value: an operator who moves the mail namespace
   * gets existing sites rebuilt onto the new apex under their existing labels,
   * rather than sites pinned to an apex they have left.
   */
  const pinned = String(hostSnapshot.get('sendingLabel') ?? '').trim()
  if (pinned) {
    const domain = platformSendingDomainFor(pinned)
    return {
      domain: domain || null,
      label: pinned,
      created: false,
      // A pinned label that no longer builds a domain means the apex changed
      // to something the label cannot live under, or the label was written by
      // hand. Naming it is the only useful thing to do — silently re-pinning
      // would move a site's mail, which is the one thing this must not do.
      error: domain ? null : 'pinned-label-unusable',
    }
  }

  /*
   * THE PLAN GATE, AT THE ONLY WRITER.
   *
   * Below the pinned-label early return on purpose: a site that already HAS a
   * domain keeps it through a downgrade. Taking one away would move that site's
   * mail onto a cold pooled identity and throw away whatever reputation the
   * name had earned, which is a punishment the merchant did not agree to and
   * which we would be inflicting silently. Reclaiming a downgraded site's
   * domain is a teardown decision with its own surface, not a side effect of
   * the next sweep.
   *
   * Here rather than only at the callers because this is the ONE function that
   * creates a claim — `claimHostForOrg` at creation, the console sweep, the
   * identity route and `restartHostSendingDomain` all funnel through it. A gate
   * at four call sites is a gate the fifth one skips, and the fifth one costs a
   * zone record that nothing reclaims.
   *
   * The callers still filter before calling. Not redundancy: this read is per
   * host, and a sweep that reached it for every free site on the platform would
   * pay for the answer it could have got from a field it already held.
   */
  if (!(await orgHoldsDedicatedSendingDomain(orgId))) {
    return {
      domain: null,
      label: null,
      created: false,
      error: 'plan-no-dedicated-domain',
    }
  }

  const subdomain = String(
    options?.subdomain || hostSnapshot.get('subdomain') || '',
  ).trim()

  for (let attempt = 1; attempt <= MAX_LABEL_ATTEMPTS; attempt += 1) {
    const label = mailLabelCandidate(subdomain, attempt)
    if (!label) continue
    const domain = platformSendingDomainFor(label)
    if (!domain) continue

    const claim: SendingLabelClaim = {
      label,
      hostId,
      orgId,
      domain,
      claimedAtMs: Date.now(),
    }

    try {
      // `create`, not `set`. An existing document is a claim by somebody else
      // — possibly this same host on a previous run, which the early return
      // above has already excluded — and overwriting it would hand two sites
      // one mail domain.
      await labelRef(label).create(claim)
    } catch {
      continue
    }

    const record: SendingDomainRecord = {
      domain,
      status: 'requested',
      // Proposed only. Resend signs on a selector of its own choosing and
      // `recordIssuedSendingDomain` overwrites this with what it returns.
      dkimSelector: 'aglyn',
      dkimPublicKey: null,
      returnPathHost: null,
      createdAtMs: Date.now(),
    }
    await firestore()
      .collection('orgs')
      .doc(orgId)
      .collection(SENDING_DOMAINS_COLLECTION)
      .doc(domain)
      .set(record, { merge: true })

    await hostRef.set(
      { sendingLabel: label, sendingDomain: domain },
      { merge: true },
    )

    return { domain, label, created: true, error: null }
  }

  return { domain: null, label: null, created: false, error: 'no-label' }
}

/**
 * Everything provisioned for one site, for a caller that must take it apart.
 *
 * Returned as data rather than acted on, because the acting needs vendor
 * credentials this module must not hold. The console's cleanup path takes this
 * and makes the calls.
 */
export interface HostSendingDomainTeardown {
  hostId: string
  orgId: string | null
  label: string | null
  domain: string | null
  /** The provider's id for the domain object, when one was recorded. */
  providerDomainId: string | null
  /**
   * The selector the provider signs under, needed to name the DKIM record for
   * deletion. Read from the record rather than assumed: the provider chooses
   * it, and a guessed selector deletes nothing while reporting success — which
   * would leave a live signing key in the zone for a site that no longer
   * exists, ready to be inherited by whoever claims the label next.
   */
  dkimSelector: string | null
}

/**
 * What a host's deletion has to clean up, read before anything is deleted.
 *
 * Split from the deletion itself so the caller can do the vendor work FIRST
 * and delete our records only once it has succeeded. The other order loses the
 * name of the thing it still has to remove: a zone accumulating records for
 * sites that no longer exist is bad on its own, and a future site reusing the
 * label would inherit a stranger's DKIM key — which is a working signature for
 * a domain somebody else's mail leaves on.
 */
export async function readHostSendingTeardown(
  hostId: string,
): Promise<HostSendingDomainTeardown | null> {
  const id = String(hostId ?? '').trim()
  if (!id) return null

  const snapshot = await firestore().collection('hosts').doc(id).get()
  if (!snapshot.exists) return null

  const label = String(snapshot.get('sendingLabel') ?? '').trim() || null
  const domain =
    normalizeSendingDomain(String(snapshot.get('sendingDomain') ?? '')) || null
  if (!label && !domain) return null

  // The claim carries the org, so a host document that has lost its org
  // pointer can still be torn down.
  const claim = label ? await labelRef(label).get() : null
  const orgId = String(claim?.get('orgId') ?? '').trim() || null

  let providerDomainId: string | null = null
  let dkimSelector: string | null = null
  if (orgId && domain) {
    const record = readSendingDomainRecord(
      await firestore()
        .collection('orgs')
        .doc(orgId)
        .collection(SENDING_DOMAINS_COLLECTION)
        .doc(domain)
        .get(),
    )
    providerDomainId = record?.providerDomainId ?? null
    dkimSelector = String(record?.dkimSelector ?? '').trim() || null
  }

  return { hostId: id, orgId, label, domain, providerDomainId, dkimSelector }
}

/**
 * Drop our own record of a site's sending domain, once the vendors are clean.
 *
 * Releasing the label LAST is deliberate. The label is what makes the domain
 * findable; while it exists, a half-finished teardown is a thing the sweep can
 * find and finish. Released first, a crash mid-teardown would leave a Resend
 * domain and a set of DNS records that nothing points at and nothing will ever
 * look for again.
 *
 * The release is real rather than a tombstone. Once the DKIM record is gone
 * from the zone and the domain object is gone from the account, a future site
 * claiming the label inherits nothing — no key, no records, no reputation. A
 * permanent reservation would only be needed if teardown were unreliable, and
 * the answer to unreliable teardown is to fix it, not to leak a name for every
 * site ever deleted.
 */
export async function releaseHostSendingDomain(
  teardown: HostSendingDomainTeardown,
): Promise<void> {
  if (!teardown) return

  if (teardown.orgId && teardown.domain) {
    await firestore()
      .collection('orgs')
      .doc(teardown.orgId)
      .collection(SENDING_DOMAINS_COLLECTION)
      .doc(teardown.domain)
      .delete()
      .catch(() => undefined)
  }

  await firestore()
    .collection('hosts')
    .doc(teardown.hostId)
    .set(
      {
        sendingLabel: firebaseAdmin.firestore.FieldValue.delete(),
        sendingDomain: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    .catch(() => undefined)

  if (teardown.label) {
    /*
     * Only if it still names THIS host. A label released by a teardown that
     * raced a re-provision would otherwise delete the claim the new domain
     * depends on, and the next site to ask for that name would be handed one
     * that is already live.
     */
    const ref = labelRef(teardown.label)
    await firestore()
      .runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        if (String(snapshot.get('hostId') ?? '') !== teardown.hostId) return
        transaction.delete(ref)
      })
      .catch(() => undefined)
  }
}

/**
 * Give a site a NEW sending domain, abandoning the one it has.
 *
 * The explicit action behind "I want my mail to come from a different name".
 * It exists so that renaming a site can stay free of side effects: a merchant
 * who wants the sending name to follow the rename asks for it here, and is
 * told what it costs.
 *
 * What it costs is the reputation. A sending domain's value is its age and its
 * history with the receiving networks; a new one starts at zero and is treated
 * with more suspicion than the old one, for weeks. That is why this is not
 * what a rename does, and why the caller is expected to have said so out loud
 * before getting here.
 *
 * Returns the teardown for the OLD domain. The caller must complete the vendor
 * cleanup for it, exactly as for a deleted host — the old Resend domain and
 * its zone records are no more welcome to linger here than there.
 */
export async function restartHostSendingDomain(options: {
  hostId: string
  orgId: string
  subdomain: string
}): Promise<{
  teardown: HostSendingDomainTeardown | null
  provisioned: HostSendingDomainResult
}> {
  const teardown = await readHostSendingTeardown(options?.hostId)
  if (teardown) await releaseHostSendingDomain(teardown)
  return { teardown, provisioned: await ensureHostSendingDomain(options) }
}

/*==========================================
  What the console sweep picks up
==========================================*/

export interface PendingSendingDomain {
  orgId: string
  record: SendingDomainRecord
}

/**
 * Platform sending domains that still need vendor work, oldest first.
 *
 * A collection-group query over every org's `sendingDomains`, filtered to the
 * ones inside our own mail apex — a customer's own domain is records they
 * publish, and this sweep must never try to write to a zone we do not own.
 *
 * `orderBy` on the creation time, and not merely `limit`. A `limit()` with no
 * `orderBy` returns documents in ID order, which is a stable arbitrary sample
 * rather than a queue: the same handful of domains would be returned on every
 * run and anything sorting after them would never be provisioned at all.
 *
 * Ordering on a field means a document missing that field is dropped by the
 * query. That is acceptable here and nowhere else in this file, because
 * `ensureHostSendingDomain` is the only writer and it always sets
 * `createdAtMs`.
 */
export async function listPendingSendingDomains(
  limit = 25,
): Promise<PendingSendingDomain[]> {
  const snapshot = await firestore()
    .collectionGroup(SENDING_DOMAINS_COLLECTION)
    .where('status', '==', 'requested')
    .orderBy('createdAtMs', 'asc')
    .limit(Math.max(1, limit))
    .get()

  const pending: PendingSendingDomain[] = []
  for (const doc of snapshot.docs) {
    const record = readSendingDomainRecord(doc)
    if (!record) continue
    // Ours to provision, or the customer's to publish. Only the first kind.
    if (!isPlatformSendingDomain(record.domain)) continue
    const orgId = doc.ref.parent.parent?.id
    if (!orgId) continue
    pending.push({ orgId, record })
  }
  return pending
}

/**
 * The label a platform domain belongs to, for a caller assembling zone record
 * names. Re-derived rather than read off the host, so a cleanup can name the
 * records for a host document that is already gone.
 */
export function sendingDomainLabel(domain: string): string {
  return platformSendingLabel(domain, platformSendingApex())
}

/**
 * Claim a dedicated sending domain for every site of ONE org. The upgrade path.
 *
 * A plan change is the moment a site becomes able to hold a domain of its own,
 * and it is observable — the billing webhook already detects the transition, so
 * this hangs off a signal that exists rather than inventing one.
 *
 * ## Why the sweep is not enough on its own
 *
 * {@link claimUnprovisionedHosts} reads a BOUNDED PAGE of `hosts` with no
 * ordering and no cursor. Past a few hundred sites it examines the same
 * arbitrary page on every run — document-id order, which is a stable sample and
 * not a queue — so an org that upgraded would wait forever for a sweep that is
 * never going to reach it. The sweep is a backstop for a claim that was missed,
 * which is what a backstop should be; it is not a schedule.
 *
 * Bounded anyway, because an agency org can hold many sites and a webhook has a
 * deadline. Whatever this run does not reach, the sweep or the next plan event
 * finishes — every step is idempotent, so being interrupted costs nothing.
 *
 * Never throws. A billing webhook that failed because mail provisioning did
 * would be retried by the payment provider and would re-run the billing
 * mirror — so a failure here must be a log line, not an exception.
 */
export async function claimOrgSendingDomains(
  orgId: string | null | undefined,
  limit = 25,
): Promise<{ scanned: number; claimed: number }> {
  const id = String(orgId ?? '').trim()
  if (!id) return { scanned: 0, claimed: 0 }
  if (!(await orgHoldsDedicatedSendingDomain(id))) return { scanned: 0, claimed: 0 }

  const snapshot = await firestore()
    .collection('hosts')
    .where('orgId', '==', id)
    .limit(Math.max(1, limit))
    .get()
    .catch(() => null)
  if (!snapshot) return { scanned: 0, claimed: 0 }

  let claimed = 0
  for (const doc of snapshot.docs) {
    if (String(doc.get('sendingLabel') ?? '').trim()) continue
    const subdomain = String(doc.get('subdomain') ?? '').trim()
    if (!subdomain) continue
    const result = await ensureHostSendingDomain({
      hostId: doc.id,
      orgId: id,
      subdomain,
    }).catch(() => null)
    if (result?.created) claimed += 1
  }

  return { scanned: snapshot.docs.length, claimed }
}

/**
 * Claim a dedicated sending domain for any ENTITLED site that has none.
 *
 * The backstop, not the schedule. {@link claimOrgSendingDomains} runs at the
 * plan transition and is what makes an upgrade take effect; this catches the
 * cases that signal cannot: a webhook that was dropped, a plan set by hand, a
 * site created under an org that was already paying.
 *
 * ## It claims by NEED, not by existence
 *
 * It used to claim for every host it saw. That is what made provider spend
 * scale with signups rather than with revenue — and it was worse than a cost
 * problem, because most of those sites could not send at all. A free site has
 * no storefront, no bookings and a campaign quota of zero; the one message it
 * can originate is a reply to a form submission, and that leaves on the shared
 * pool like every other site's transactional mail. Provisioning it a domain
 * bought a zone record, a provider slot and a permanent place in the re-check
 * sweep, in exchange for nothing.
 *
 * So the plan is checked FIRST, from the host document's own `orgId` against
 * the org — and `ensureHostSendingDomain` checks it again, because this filter
 * is here to save reads and that one is there to be correct.
 *
 * ## The filter is in memory, and deliberately
 *
 * "Has no `sendingLabel`" is not a Firestore query. `orderBy('sendingLabel')`
 * would DROP exactly the documents being looked for — a field-absent document
 * does not appear in an ordered result — so the query that looks like the
 * right one returns the empty set forever. This reads a bounded page of hosts
 * and filters here, matching the SSO re-verify sweep: no index to be missing,
 * and no ordering to silently exclude the target.
 *
 * ## Known limitation, and why it is acceptable NOW
 *
 * That bounded page has no cursor, so past a few hundred hosts this examines
 * the same arbitrary slice every run. That was a silent correctness bug while
 * this was the ONLY claim path — sites outside the first page were never
 * provisioned and nobody could see why. It is merely a slow backstop now that
 * the plan transition claims eagerly, which is the order these two should have
 * been built in.
 */
export async function claimUnprovisionedHosts(
  limit = 25,
): Promise<{ scanned: number; claimed: number; skippedUnentitled: number }> {
  const snapshot = await firestore()
    .collection('hosts')
    .limit(Math.max(1, limit))
    .get()

  let claimed = 0
  let skippedUnentitled = 0
  // One answer per org, not per host: an agency's twelve sites share a plan,
  // and a sweep that asked twelve times would pay for eleven reads it already
  // had the answer to.
  const entitled = new Map<string, boolean>()

  for (const doc of snapshot.docs) {
    if (String(doc.get('sendingLabel') ?? '').trim()) continue
    const orgId = String(doc.get('orgId') ?? '').trim()
    /*
     * A host with no subdomain has no name to build a label from, and the
     * check is here rather than left to the callee because the callee would
     * RE-READ the host document before reaching the same conclusion. On a
     * sweep across every site that is a read per unusable host per run.
     *
     * There is deliberately no `!orgId` check beside it: that one the callee
     * makes before any read at all, so duplicating it would cost nothing and
     * save nothing — a guard that cannot change an outcome or a cost reads as
     * though it protects something.
     */
    const subdomain = String(doc.get('subdomain') ?? '').trim()
    if (!subdomain) continue

    if (!entitled.has(orgId)) {
      entitled.set(orgId, await orgHoldsDedicatedSendingDomain(orgId))
    }
    if (!entitled.get(orgId)) {
      skippedUnentitled += 1
      continue
    }

    const result = await ensureHostSendingDomain({
      hostId: doc.id,
      orgId,
      subdomain,
    }).catch(() => null)
    if (result?.created) claimed += 1
  }

  return { scanned: snapshot.docs.length, claimed, skippedUnentitled }
}
