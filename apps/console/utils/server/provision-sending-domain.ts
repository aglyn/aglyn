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
  sendingDomainRequiredRecords,
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
        console.error(
          `[provision-sending-domain] at the sending-domain ceiling ` +
            `(${held}/${capacity}) — ${domain} cannot be provisioned. Buy ` +
            'the provider domain add-on (Resend: $20/mo for 100 more ' +
            'domains, on Pro or Scale) and raise ' +
            'AGLYN_SENDING_DOMAIN_CAPACITY to the new allowance. A tier ' +
            'upgrade buys the same domains for more; the tier is for send ' +
            'volume.',
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

  // Step 2. The records the customer would otherwise publish, addressed the
  // way an API to our own zone addresses them. Same generator the verifier
  // compares against, so what is written is what is looked for.
  const required = sendingDomainRequiredRecords(issued.record)
  const zoned = platformZoneRecords(required, tenantWebApex())
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
  if (!domain || !isPlatformSendingDomain(domain)) {
    return { outcome: 'skipped', detail: 'not-our-zone' }
  }

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
