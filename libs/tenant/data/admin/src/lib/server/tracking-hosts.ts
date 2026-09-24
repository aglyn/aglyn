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
  readTrackingHostProbe,
  sendingTrackingHost,
  TRACKING_HOST_DETAIL,
  TRACKING_HOST_PROBE_PATH,
  trackingHostLinkOrigin,
  trackingHostTarget,
  validateTrackingHostDomain,
  type TrackingHostDetail,
  type TrackingHostRecord,
  type TrackingHostResult,
} from '@aglyn/shared-util-email'
import {
  domainProvider,
  domainStateServes,
  DOMAIN_PROVIDER_TIMEOUT_MS,
  type DomainProvider,
} from './domain-provider'
import { SENDING_DOMAINS_COLLECTION } from './sending-domains'

/**
 * CLICK-TRACKING HOSTS THIS DEPLOYMENT SERVES — durable half.
 *
 * The record, the driver calls and the probe. The decisions live in
 * `@aglyn/shared-util-email`'s `tracking-host.ts`; this module is the I/O
 * around them, the same split `sending-domains.ts` makes.
 *
 * ## Per org, per sending domain
 *
 * At `orgs/{orgId}/trackingHosts/{domain}`, beside `sendingDomains` and for
 * the same reason: the host is a fact about a domain the organization sends
 * as. The org's erasure and its personal-data export reach it through the
 * org's subtree like every other document under it. It is Admin SDK only —
 * `status` decides where a recipient's click goes, and no client may write
 * that.
 *
 * ## Why no claim across organizations
 *
 * The host is always `links.<the sending domain>`, and a caller only sets one
 * up for a domain it already sends as (Sequences asks for its own mailboxes'
 * domains). Two organizations sending as one domain both run on it
 * legitimately, and every link id resolves on its own document whichever
 * host carried it.
 *
 * ## The network never throws out of here
 *
 * The driver call and the probe are network calls a member is waiting on;
 * each failure is caught and becomes a stored detail the card can print. A
 * Firestore failure still propagates, as it does from every store.
 */

/** Subcollection under the owning org. */
export const TRACKING_HOSTS_COLLECTION = 'trackingHosts'

type Firestore = FirebaseFirestore.Firestore

const hostRef = (firestore: Firestore, orgId: string, domain: string) =>
  firestore.collection('orgs').doc(orgId).collection(TRACKING_HOSTS_COLLECTION).doc(domain)

/** One stored document as a record, or `null` for one that is not there. */
export function readTrackingHostRecord(
  snapshot: FirebaseFirestore.DocumentSnapshot | null | undefined,
): TrackingHostRecord | null {
  if (!snapshot?.exists) return null
  const data = snapshot.data() ?? {}
  const domain = String(data['domain'] ?? snapshot.id)
  return {
    domain,
    host: String(data['host'] ?? sendingTrackingHost(domain)),
    status: data['status'] ?? 'requested',
    target: data['target'] ?? null,
    provider: data['provider'] ?? null,
    verification: Array.isArray(data['verification']) ? data['verification'] : null,
    lastDetail: data['lastDetail'] ?? null,
    createdAtMs: Number(data['createdAtMs']) || null,
    verifiedAtMs: Number(data['verifiedAtMs']) || null,
    lastCheckedAtMs: Number(data['lastCheckedAtMs']) || null,
  }
}

export async function readTrackingHost(
  firestore: Firestore,
  orgId: string,
  domain: string,
): Promise<TrackingHostRecord | null> {
  const checked = validateTrackingHostDomain(domain)
  if (!checked.domain) return null
  return readTrackingHostRecord(await hostRef(firestore, orgId, checked.domain).get())
}

export async function listTrackingHosts(firestore: Firestore, orgId: string): Promise<TrackingHostRecord[]> {
  const snapshot = await firestore.collection('orgs').doc(orgId).collection(TRACKING_HOSTS_COLLECTION).get()
  return snapshot.docs
    .map((doc) => readTrackingHostRecord(doc))
    .filter((record): record is TrackingHostRecord => Boolean(record))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}

interface TrackingHostDeps {
  firestore: Firestore
  orgId: string
  domain: string
  nowMs: number
  /** The deployment's domain driver; {@link domainProvider} by default. */
  provider?: DomainProvider
}

/**
 * Whether campaign mail already owns `links.<domain>`: the org's sending
 * domain for it was issued a tracking target by the mail provider, whose
 * CNAME the customer publishes on the very same name.
 */
async function providerTracked(firestore: Firestore, orgId: string, domain: string): Promise<boolean> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(SENDING_DOMAINS_COLLECTION)
    .doc(domain)
    .get()
  return Boolean(snapshot.exists && String(snapshot.data()?.['trackingTarget'] ?? '').trim())
}

/**
 * Set up `links.<domain>`: attach it through the domain driver and record the
 * DNS to publish. Idempotent — attaching a name already attached is success,
 * and a verified record is left verified.
 */
export async function setUpTrackingHost(input: TrackingHostDeps): Promise<TrackingHostResult> {
  const checked = validateTrackingHostDomain(input.domain)
  if (!checked.domain) return { record: null, error: checked.error, status: 400 }
  const domain = checked.domain
  const host = sendingTrackingHost(domain)
  const ref = hostRef(input.firestore, input.orgId, domain)

  if (await providerTracked(input.firestore, input.orgId, domain)) {
    return { record: null, error: TRACKING_HOST_DETAIL['provider-tracked'], status: 409 }
  }

  const provider = input.provider ?? domainProvider()
  const existing = readTrackingHostRecord(await ref.get())
  const attached = await provider.attach('console', host).catch(() => ({ outcome: 'failed' as const, domain: host }))
  const failed = attached.outcome === 'failed'
  const record: TrackingHostRecord = {
    domain,
    host,
    status: existing?.status === 'verified' && !failed ? 'verified' : failed ? 'requested' : 'records-issued',
    target: trackingHostTarget(provider.id),
    provider: provider.id,
    verification: existing?.verification ?? null,
    lastDetail: failed ? 'attach-failed' : (existing?.status === 'verified' ? null : (existing?.lastDetail ?? null)),
    createdAtMs: existing?.createdAtMs ?? input.nowMs,
    verifiedAtMs: existing?.verifiedAtMs ?? null,
    lastCheckedAtMs: existing?.lastCheckedAtMs ?? null,
  }
  await ref.set(record, { merge: true })
  return { record, error: null, status: 200 }
}

/** The probe's fetch, injectable for specs. */
export type TrackingHostFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Ask the host whether it is live: the driver's status first (a name still
 * waiting on DNS or a certificate is not worth a request), then an HTTPS
 * request to the probe path, which only this app answers.
 *
 * A probe that cannot connect is `failed` with `unreachable` — except on a
 * record already verified, which keeps its status: one lost request must not
 * send every link back to the app address mid-sequence.
 */
export async function verifyTrackingHost(
  input: TrackingHostDeps & { fetch?: TrackingHostFetch },
): Promise<TrackingHostResult> {
  const checked = validateTrackingHostDomain(input.domain)
  if (!checked.domain) return { record: null, error: checked.error, status: 400 }
  const ref = hostRef(input.firestore, input.orgId, checked.domain)
  const existing = readTrackingHostRecord(await ref.get())
  if (!existing) {
    return { record: null, error: 'Set up the link domain before checking it.', status: 404 }
  }
  const provider = input.provider ?? domainProvider()
  const host = existing.host

  const state = await provider.status('console', host).catch(() => null)
  let status: TrackingHostRecord['status']
  let detail: TrackingHostDetail | null = null
  const verification = state?.verification?.length ? state.verification : null

  if (state && !domainStateServes(state.state)) {
    detail =
      state.state === 'ownership-pending' || state.state === 'certificate-pending' || state.state === 'dns-misconfigured'
        ? state.state
        : 'dns-misconfigured'
    status = existing.status === 'verified' ? 'verified' : state.state === 'dns-misconfigured' ? 'failed' : 'records-issued'
  } else {
    const answer = await probe(host, input.fetch ?? fetch)
    if (answer === 'ok') {
      status = 'verified'
    } else {
      detail = answer
      status = existing.status === 'verified' && answer === 'unreachable' ? 'verified' : 'failed'
    }
  }

  const record: TrackingHostRecord = {
    ...existing,
    status,
    verification,
    lastDetail: detail,
    lastCheckedAtMs: input.nowMs,
    verifiedAtMs: status === 'verified' ? (existing.status === 'verified' ? existing.verifiedAtMs : input.nowMs) : null,
  }
  await ref.set(record, { merge: true })
  return { record, error: null, status: 200 }
}

async function probe(host: string, fetchImpl: TrackingHostFetch): Promise<'ok' | 'unreachable' | 'not-this-app'> {
  let response: Response
  try {
    response = await fetchImpl(`https://${host}${TRACKING_HOST_PROBE_PATH}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: deadline(),
    })
  } catch {
    return 'unreachable'
  }
  if (!response.ok) return 'not-this-app'
  const body = await response.json().catch(() => null)
  return readTrackingHostProbe(body, host) ? 'ok' : 'not-this-app'
}

function deadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(DOMAIN_PROVIDER_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/**
 * Stop serving `links.<domain>`: detach it through the driver and delete the
 * record. Every link already sent on it stops working on the host (the same
 * ids keep answering on the app's own address), which the caller says before
 * asking.
 */
export async function removeTrackingHost(input: TrackingHostDeps): Promise<TrackingHostResult> {
  const checked = validateTrackingHostDomain(input.domain)
  if (!checked.domain) return { record: null, error: checked.error, status: 400 }
  const ref = hostRef(input.firestore, input.orgId, checked.domain)
  const existing = readTrackingHostRecord(await ref.get())
  if (!existing) return { record: null, error: null, status: 200 }
  const provider = input.provider ?? domainProvider()
  await provider.detach('console', existing.host).catch(() => null)
  await ref.delete()
  return { record: null, error: null, status: 200 }
}

/**
 * The origin tracked links in mail sent as `senderAddress` should use —
 * `https://links.<its domain>` once that host is verified — or `null` for
 * "the app's own address". One document read; never a network call, because
 * this is on the send path.
 */
export async function resolveTrackingLinkOrigin(
  firestore: Firestore,
  orgId: string,
  senderAddress: string,
): Promise<string | null> {
  const checked = validateTrackingHostDomain(senderAddress)
  if (!checked.domain) return null
  return trackingHostLinkOrigin(readTrackingHostRecord(await hostRef(firestore, orgId, checked.domain).get()))
}
