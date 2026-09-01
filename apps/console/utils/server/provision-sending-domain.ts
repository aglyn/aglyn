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
 * PROVISIONING A SITE'S SENDING DOMAIN — the two vendor writes, joined.
 *
 * A claim exists (`ensureHostSendingDomain` made it, from anywhere, with no
 * credential). This turns it into a domain that can actually send:
 *
 *   1. Ask the mail provider for a signing key.
 *   2. Write the records it issued into our own DNS zone.
 *
 * Verification is nobody's job here. The re-check sweep already reads live DNS
 * and moves `records-issued` to `verified`, and it is the right owner: DNS
 * propagation is not instant, so a provisioner that waited would be holding a
 * request open on a timer it cannot predict.
 *
 * ## Two vendors, one recoverable state machine
 *
 * The failure that matters is a partial one — a Resend domain created and no
 * DNS written, or DNS written for a domain that was never created. The order
 * below makes every partial state one the next sweep run finishes:
 *
 *   `requested`       nothing at either vendor, or a Resend domain whose key
 *                     we failed to store. Retrying calls Resend again, which
 *                     answers `422`, which `adoptExisting` resolves to the
 *                     SAME domain's real key — never a second domain.
 *   `records-issued`  the key is stored. Retrying skips the provider entirely
 *                     (`issueSendingDomainRecords` returns early on a stored
 *                     key) and re-attempts only the zone write, which skips
 *                     records already present.
 *   `verified`        done, and this function will not touch it.
 *
 * So a retry from any state is safe, and no state needs a compensating undo.
 * The half-state that would need one — a key issued at the provider and lost
 * before storage — is exactly the one Resend's duplicate handling repairs,
 * which is why `adoptExisting` matches the domain name at both steps rather
 * than trusting the `422`.
 *
 * ## The ceiling is real and it is low
 *
 * Resend caps DOMAINS PER ACCOUNT by plan: 3 on Free, 10 on Pro, 1,000 on
 * Scale, plus a purchasable +100. Subdomains are not exempt — each one is its
 * own domain object with its own quota slot — and there is no wildcard.
 *
 * One domain per site therefore has a hard ceiling that is a plan away from
 * being reached, and the failure at the ceiling is a provider `4xx` in a sweep
 * nobody is watching. {@link sendingDomainCapacity} makes it a number this
 * deployment knows, so the refusal happens HERE, with a message naming the
 * cause, rather than as an opaque vendor error. It is deliberately a
 * configured value and not a probe: the plan is not readable from the API, and
 * a ceiling that guesses is a ceiling that is wrong in whichever direction
 * costs more.
 */

import {
  isPlatformSendingDomain,
  platformZoneNamesFor,
  platformZoneRecords,
  sendingDomainPublishableRecords,
  sendingDomainTeardownRefusal,
  tenantWebApex,
  type SendingDomainRecord,
} from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  listPendingSendingDomains,
  readSendingDomainRecord,
  recordSendingDomainIssueFailure,
  SENDING_DOMAINS_COLLECTION,
  sendingDomainLabel,
  type HostSendingDomainTeardown,
} from '@aglyn/tenant-data-admin'
import { issueSendingDomainRecords } from './issue-sending-domain'
import { sendingDomainProvider } from './sending-domain-provider'
import { sendingZoneProvider } from './sending-zone-provider'

/**
 * How many sending domains this deployment may hold at the mail provider.
 *
 * Default 10 — the Pro allowance, and the lowest paid tier's number, so a
 * deployment that has not been told its plan refuses BEFORE the vendor does
 * rather than after. Raising it is a deliberate act by somebody who has
 * checked the plan, which is the correct shape for a limit whose true value
 * lives in a billing system this code cannot read.
 *
 * `-1` disables the check for an operator whose provider has no such limit.
 *
 * ## A DOMAIN IS A QUOTA, NOT A LINE ITEM
 *
 * Nothing about this ceiling is a per-domain price, and reading it as one
 * leads to the expensive answer. Resend bills a tier plus per-email volume;
 * the domain count is a bundled allowance inside the tier — Free 3, Pro 10,
 * Scale 1,000 — with no per-domain meter anywhere. The marginal cost of the
 * eleventh tenant domain on a Scale plan is zero.
 *
 * So one provider domain per site is not the cost driver it looks like, and
 * the shape of the fix when this ceiling is reached is NOT "move up a tier".
 * Resend sells a flat add-on: $20/mo adds 100 domains on top of whatever the
 * plan includes, available on Pro and Scale, and it changes neither the email
 * quota nor the contact limit nor the rate limit. Pro plus the add-on is 110
 * domains for $40/mo. Pro to Scale for the same relief is $90/mo before the
 * add-on — the same domains, $70 a month more, bought by misreading a quota
 * as a price.
 *
 * The tier is therefore chosen by SEND VOLUME and this number is raised to
 * match whatever allowance that tier plus its add-ons actually carries.
 */
export function sendingDomainCapacity(): number {
  const raw = String(process.env.AGLYN_SENDING_DOMAIN_CAPACITY ?? '').trim()
  if (!raw) return 10
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 10
}

export type ProvisionOutcome =
  /** The domain now has a key and its records are in the zone. */
  | 'provisioned'
  /** Nothing to do — already issued and already in the zone. */
  | 'unchanged'
  /** No credential for one half. The claim stands and waits. */
  | 'skipped'
  /** The account is at its domain ceiling. */
  | 'at-capacity'
  | 'failed'

export interface ProvisionResult {
  domain: string
  outcome: ProvisionOutcome
  /** A short code, safe to store, log and show. Null when nothing failed. */
  detail: string | null
}

/**
 * Take one claimed domain from `requested` to records-in-the-zone.
 *
 * Never throws — the caller is a sweep across many sites.
 */
export async function provisionSendingDomain(options: {
  orgId: string
  record: SendingDomainRecord
}): Promise<ProvisionResult> {
  const record = options?.record
  const domain = String(record?.domain ?? '')

  /*
   * The zone guard, asked FIRST and asked of the domain rather than of the
   * caller's intent. Everything below writes DNS, and the one thing that must
   * be impossible is writing DNS for a name we do not own — a customer's
   * domain is records we print for them to publish, and reaching into their
   * zone would be both a failure and a trespass.
   */
  if (!domain || !isPlatformSendingDomain(domain)) {
    return { domain, outcome: 'skipped', detail: 'not-our-zone' }
  }
  if (record.status === 'verified') {
    return { domain, outcome: 'unchanged', detail: null }
  }

  const mail = sendingDomainProvider()
  const zone = sendingZoneProvider()
  if (!mail.configured() || !zone.configured()) {
    return { domain, outcome: 'skipped', detail: 'unconfigured' }
  }

  /*
   * The ceiling, checked only when a NEW domain would be created.
   *
   * A record that already holds a key has already spent its slot, so counting
   * it against the ceiling would strand exactly the domains that are mid-way
   * through provisioning — the ones a sweep exists to finish.
   */
  if (!String(record.dkimPublicKey ?? '').trim()) {
    const capacity = sendingDomainCapacity()
    if (capacity >= 0) {
      const held = await countProvisionedDomains()
      if (held >= capacity) {
        await recordSendingDomainIssueFailure({
          orgId: options.orgId,
          domain,
          detail: 'at-capacity',
        })
        /*
         * Addressed to an OPERATOR, and it names the levers an operator has.
         * None of them is a customer plan change: the site refused here keeps
         * sending on the shared pool, so this is a shortage of ours and not
         * something the merchant can buy their way out of.
         *
         * The two levers pull on different resources and the message keeps
         * them apart, because conflating them is how the expensive answer
         * gets chosen. The ADD-ON is what raises the count. Moving merchants
         * onto domains they own spends a provider slot just the same, but
         * costs nothing in our zone and nothing in the sweep we run against
         * it, so it is what stops the demand for platform subdomains growing
         * with every paying site.
         */
        console.error(
          `[provision-sending-domain] at the sending-domain ceiling ` +
            `(${held}/${capacity}) — ${domain} cannot be provisioned. The ` +
            'site keeps sending on the shared pool meanwhile, so this is ' +
            'degraded delivery reputation and not stopped mail. To raise ' +
            'the count, buy the provider domain add-on (Resend: $20/mo for ' +
            '100 more domains, on Pro or Scale) and set ' +
            'AGLYN_SENDING_DOMAIN_CAPACITY to the new allowance — a tier ' +
            'upgrade buys the same domains for more, because the tier is ' +
            'for send volume. To stop the demand growing, move merchants ' +
            'onto domains they own: those cost no records in our zone and ' +
            'no place in our re-verification sweep.',
        )
        return { domain, outcome: 'at-capacity', detail: 'at-capacity' }
      }
    }
  }

  // Step 1. Idempotent by our OWN record before it is idempotent by the
  // provider's duplicate handling: a stored key means no network call at all.
  const issued = await issueSendingDomainRecords({
    orgId: options.orgId,
    record,
  })
  if (issued.outcome === 'failed') {
    return { domain, outcome: 'failed', detail: issued.detail }
  }
  if (issued.outcome === 'skipped') {
    return { domain, outcome: 'skipped', detail: issued.detail }
  }

  /*
   * Step 2. The records the customer would otherwise publish, addressed the
   * way an API to our own zone addresses them. Same generator the verifier
   * compares against, so what is written is what is looked for.
   *
   * PUBLISHABLE, not merely required. The two differ by the click-tracking
   * host, which verification must not wait on and which there is nobody to
   * ask about here — this is our zone. Writing only the required set is what
   * left every platform subdomain measuring a structural 0% click rate:
   * one flag was answering two questions, and the conservative answer to
   * "does verification wait on this" silently decided "do we publish it".
   */
  const publishable = sendingDomainPublishableRecords(issued.record)
  const zoned = platformZoneRecords(publishable, tenantWebApex())
  if (!zoned.length) {
    await recordSendingDomainIssueFailure({
      orgId: options.orgId,
      domain,
      detail: 'no-zone-records',
    })
    return { domain, outcome: 'failed', detail: 'no-zone-records' }
  }

  const written = await zone.write(zoned)
  if (written.outcome === 'skipped') {
    return { domain, outcome: 'skipped', detail: written.detail }
  }
  if (written.outcome === 'failed') {
    /*
     * The key is stored and the zone is not written. Recorded as a REASON on a
     * record that stays at `records-issued`, which is the honest state: the
     * records exist and are not published. The next sweep run re-attempts only
     * the zone write, and skips the records it already created.
     */
    await recordSendingDomainIssueFailure({
      orgId: options.orgId,
      domain,
      detail: `zone-${written.detail || 'failed'}`,
    })
    return { domain, outcome: 'failed', detail: written.detail }
  }

  return {
    domain,
    outcome: written.created ? 'provisioned' : 'unchanged',
    detail: null,
  }
}

/**
 * How many domains this deployment has taken a provider slot for.
 *
 * Counted from OUR records — every domain carrying an issued key — rather than
 * from the provider's list. Two reasons, and the second is the one that
 * decides it: a list call spends a round trip on every sweep iteration, and
 * more importantly the provider's list includes `aglyn.com`, which this
 * deployment did not provision and must not be able to release. Counting what
 * we created keeps the ceiling about the thing we control.
 *
 * It therefore UNDER-counts by the domains an operator added by hand, which is
 * the safe direction only if the configured capacity leaves room for them —
 * hence the default sitting a tier below the real allowance.
 */
async function countProvisionedDomains(): Promise<number> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collectionGroup(SENDING_DOMAINS_COLLECTION)
    .where('status', 'in', ['records-issued', 'verified'])
    .count()
    .get()
  return Number(snapshot.data().count) || 0
}

/**
 * The share of the ceiling that has to be spent before an operator is warned.
 *
 * A ceiling reported only as a boolean is one that is first observed at the
 * moment it has already cost something, and the remedy — buy the provider's
 * domain add-on, then set the new allowance and deploy — is hours of billing
 * and configuration work, not minutes. So the warning has to arrive with
 * enough headroom left to complete it.
 *
 * A share rather than a fixed number of domains because deployments differ by
 * two orders of magnitude: 20 spare would be most of a default self-host
 * allowance of 10 and almost nothing against a 1,100 self-serve ceiling.
 * {@link SendingDomainCapacityReport.remaining} carries the absolute figure
 * beside it, so a reader never has to do the arithmetic to know what "80%"
 * leaves.
 */
const CAPACITY_WARNING_SHARE = 0.8

/** Where this deployment stands against its sending-domain ceiling. */
export interface SendingDomainCapacityReport {
  held: number
  capacity: number
  /**
   * Slots left before a new domain is refused, or `null` when there is no
   * ceiling to count against.
   *
   * NULL RATHER THAN A LARGE NUMBER, and never `Infinity`. An uncapped
   * deployment has no headroom figure — it has no ceiling — and
   * `JSON.stringify(Infinity)` is `null` anyway, which a reader would then
   * have to interpret without being told which of the two it meant.
   */
  remaining: number | null
  /**
   * How much of the ceiling is spent, `0`–`1`, or `null` when uncapped.
   *
   * The fraction is what makes the ceiling watchable rather than merely
   * discoverable: an operator reading `0.62` knows they have time, and one
   * reading `0.94` knows they do not, without holding either number in their
   * head from the last time they looked.
   */
  used: number | null
  /** True once a new domain would be refused. `capacity: -1` is never true. */
  atCapacity: boolean
  /**
   * True inside the warning band and not yet at the ceiling.
   *
   * Deliberately false once `atCapacity` is true. The two are different
   * events with different remedies — one is "buy headroom soon", the other is
   * "merchants are being pooled right now" — and a surface that showed both
   * would be showing the milder one at the moment it stopped being true.
   */
  low: boolean
}

/**
 * The ceiling as a READ, for a report rather than for a decision.
 *
 * The dry run's whole job is to answer "what would this sweep do" without
 * doing it, and a sweep at the ceiling does nothing at all — so a dry run that
 * printed only the pending count would report a queue and no reason it was not
 * moving. That is the same silence the loud log exists to break, arriving at
 * the one surface an operator visits on purpose.
 *
 * Every derived field is `null` for a negative capacity, which is the
 * configured way to switch the check off, and for a count that could not be
 * read. Both are the same claim: there is no ceiling here to be a fraction of,
 * and a `0` in that position would read as an empty account rather than as an
 * absent limit.
 */
export async function readSendingDomainCapacity(): Promise<SendingDomainCapacityReport> {
  const capacity = sendingDomainCapacity()
  const held = await countProvisionedDomains().catch(() => -1)
  const bounded = capacity > 0 && held >= 0
  const remaining = bounded ? Math.max(0, capacity - held) : null
  const atCapacity = capacity >= 0 && held >= 0 && held >= capacity
  return {
    held,
    capacity,
    remaining,
    // Clamped at 1 so an account carrying hand-added domains past the
    // configured ceiling reports a full bar rather than "112% used", which
    // reads as a bug in the meter rather than as a real state.
    used: bounded ? Math.min(1, held / capacity) : null,
    atCapacity,
    low: bounded && !atCapacity && held / capacity >= CAPACITY_WARNING_SHARE,
  }
}

export interface ProvisionSweepSummary {
  checked: number
  provisioned: number
  failed: number
  atCapacity: number
}

/**
 * Provision every claim waiting for vendor work, oldest first.
 *
 * Bounded by a batch size rather than by time: the beat runs again, and a
 * sweep that tried to drain an arbitrary queue inside one invocation is a
 * sweep that gets killed halfway with no record of where it was.
 *
 * Stops early at the ceiling. Once one domain has been refused for capacity
 * every other domain in the batch will be too, and continuing would spend a
 * provider call per site to collect the same answer — and would bury the one
 * log line an operator needs under a batch of identical ones.
 */
export async function provisionPendingSendingDomains(
  batch = 10,
): Promise<ProvisionSweepSummary> {
  const pending = await listPendingSendingDomains(batch)
  const summary: ProvisionSweepSummary = {
    checked: 0,
    provisioned: 0,
    failed: 0,
    atCapacity: 0,
  }

  for (const entry of pending) {
    summary.checked += 1
    const result = await provisionSendingDomain(entry)
    if (result.outcome === 'provisioned') summary.provisioned += 1
    if (result.outcome === 'failed') summary.failed += 1
    if (result.outcome === 'at-capacity') {
      summary.atCapacity += 1
      break
    }
  }

  return summary
}

/*==========================================
  Taking one apart
==========================================*/

export interface TeardownResult {
  outcome: 'removed' | 'skipped' | 'failed'
  detail: string | null
}

/**
 * Remove a site's sending domain from both vendors.
 *
 * Ordered provider-then-zone, and the order matters. Releasing the provider
 * domain first frees the quota slot — the scarce resource — and leaves at
 * worst a set of DNS records that authenticate nothing, because the key they
 * carry no longer signs anything. The other order would leave a live domain at
 * the provider with no records, which still holds a slot.
 *
 * The caller deletes OUR record last, via `releaseHostSendingDomain`, so a
 * teardown that dies partway is still findable and still finishable. Releasing
 * the label before the vendors are clean would strand both with nothing
 * pointing at them, and a future site claiming that label would inherit a
 * stranger's DKIM key — a working signature for a domain somebody else's mail
 * leaves on.
 */
export async function teardownSendingDomain(
  teardown: HostSendingDomainTeardown,
): Promise<TeardownResult> {
  const domain = String(teardown?.domain ?? '')

  /*==========================================
   * ⛔ THE ONE NAME THIS FUNCTION MAY NEVER BE POINTED AT.
   *
   * `shared1.mail.aglyn.app` … `shared4` are live, verified, and carry the
   * transactional mail of every site with no domain of its own. Releasing one
   * stops a quarter of the platform's receipts and password resets, and stops
   * them silently — a domain that is merely no longer verified raises nothing.
   *
   * The refusal is asked of the LABEL as well as the domain, and that is what
   * closes the hole below it: `sendingDomainLabel` refuses to derive a label
   * for a reserved name, so a pool member arrives here with an empty derived
   * label — and the `|| teardown.label` fallback would then hand the zone
   * deletion the caller's own spelling of `shared3` and remove the pool
   * member's records.
   *=========================================*/
  const refusal = sendingDomainTeardownRefusal(domain, teardown?.label)
  if (refusal === 'shared-pool') {
    console.error(
      '[provision-sending-domain] REFUSED to tear down shared pool member',
      domain,
      '— the pool belongs to the platform, not to any site.',
    )
    return { outcome: 'skipped', detail: 'shared-pool' }
  }
  if (refusal) return { outcome: 'skipped', detail: 'not-our-zone' }

  const label = sendingDomainLabel(domain) || teardown.label
  if (!label) return { outcome: 'skipped', detail: 'no-label' }

  const released = await releaseProviderDomain(teardown.providerDomainId)
  if (released === 'failed') {
    // Left for the next pass rather than proceeding: deleting the records
    // while the provider still holds the domain leaves a slot spent on a
    // domain that can never verify again, which is the expensive half.
    return { outcome: 'failed', detail: 'provider-release' }
  }

  /*
   * Every name this domain owns inside the zone, derived from the configured
   * apex rather than assembled here. The DKIM name needs the SELECTOR the
   * provider actually signs under — `sendingDkimSelector` only proposes one
   * and `recordIssuedSendingDomain` overwrites it — so a teardown with no
   * selector leaves the signing key in the zone rather than deleting nothing
   * and reporting success.
   */
  const zone = sendingZoneProvider()
  const names = platformZoneNamesFor(label, teardown.dkimSelector)
  if (!teardown.dkimSelector) {
    console.error(
      '[provision-sending-domain] no selector recorded for',
      domain,
      '— the DKIM record stays in the zone and needs removing by hand',
    )
  }

  const removed = await zone.remove(names)
  if (removed.outcome === 'failed') {
    return { outcome: 'failed', detail: removed.detail }
  }

  return { outcome: 'removed', detail: null }
}

/** Release the provider's domain object, freeing its quota slot. */
async function releaseProviderDomain(
  providerDomainId: string | null,
): Promise<'released' | 'skipped' | 'failed'> {
  // No id means the domain was never created at the provider — a claim that
  // died before step 1. There is no slot to free, and the teardown continues.
  if (!providerDomainId) return 'skipped'
  const provider = sendingDomainProvider()
  if (!provider.configured()) return 'skipped'
  return (await provider.release(providerDomainId)) ? 'released' : 'failed'
}

/** Re-read one record, for a caller that holds only ids. */
export async function readProvisionedRecord(
  orgId: string,
  domain: string,
): Promise<SendingDomainRecord | null> {
  return readSendingDomainRecord(
    await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection(SENDING_DOMAINS_COLLECTION)
      .doc(domain)
      .get(),
  )
}
