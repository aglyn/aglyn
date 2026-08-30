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

import * as Aglyn from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
} from '@aglyn/tenant-data-admin'
import {
  isDeferrableSendResult,
  isEmailConfigured,
  loadHostEmail,
  renderLoadedHostEmail,
  sendEmail,
  type LoadedHostEmail,
} from '@aglyn/shared-util-email'
import {
  type PluginApiHandler,
  type PluginJobHostGate,
  pluginJobHostGate,
} from '@aglyn/aglyn/server'

const REMIND_AFTER_MS = 60 * 60 * 1000
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** One pass over the open checkouts. Bounded (200) and idempotent. */
export interface AbandonedScanResult {
  scanned: number
  sent: number
  /** Rows left untouched because their site is locked (AGL-2495). */
  skippedLocked: number
}

/**
 * The abandoned-checkout pass itself, separated from its HTTP door (AGL-2227).
 *
 * It was only ever reachable through `processAbandonedHandler`, which is
 * `x-cron-secret`-gated — and **nothing has ever POSTed to it**. It is not in
 * `.github/workflows/scheduled-crons.yml`, there is no `crons` key in
 * `vercel.json`, and it was not a `registerPluginJob`. `server.ts` described
 * these as "the scheduler-driven jobs" in a comment, which is how a dead
 * feature stays invisible: the code asserted the wiring rather than having it.
 *
 * So `abandonedCart` — a Pro-tier entitlement, sold on /pricing, with a
 * console row added by AGL-2081 telling the merchant their template needs it —
 * had never sent one email. Exporting the scan lets `server.ts` register it on
 * the platform job beat (the every-minute `pluginJobsBeat` that AGL-2176
 * proved out) while the HTTP door stays for manual/ops invocation and for the
 * console's "send now" control.
 */
export async function scanAbandonedCheckouts(
  /**
   * The lockdown gate, injected by whoever drives the pass (AGL-2495). NOT
   * optional: a default would make "forgot to thread it" compile, which is
   * the whole failure this parameter exists to make impossible.
   */
  gate: PluginJobHostGate,
): Promise<AbandonedScanResult> {
  const firestore = firebaseAdmin.app().firestore()
  const now = Date.now()
  // Collection-group over every host's checkouts.
  const openCheckouts = await firestore
    .collectionGroup('checkouts')
    .where('status', '==', 'open')
    .limit(200)
    .get()
  let sent = 0
  const entitledHosts = new Map<string, boolean>()
  // White-label brand per host (White-Label Phase 3): resolved once per host
  // alongside the entitlement, from the same org doc, through the one shared
  // resolver — so the recovery email's sender reads as the store's brand.
  const brandingByHost = new Map<string, Aglyn.ResolvedBrandingProfile>()
  /** Each site's public origin, for the unsubscribe link on the reminder. */
  const siteBaseByHost = new Map<string, string>()
  // Resolve each host's designed template once per run (AGL-770).
  const templateCache = new Map<string, LoadedHostEmail | null>()
  let skippedLocked = 0
  for (const docSnapshot of openCheckouts.docs) {
    const data = docSnapshot.data() as any
    // `hosts/{hostId}/checkouts/{id}` — the grandparent is the host.
    const hostId = docSnapshot.ref.parent.parent?.id
    if (!hostId) continue
    // LOCKDOWN (AGL-2495), and it is the FIRST thing in the loop body rather
    // than sitting next to the email below, because the `status: 'expired'`
    // stamp further down is itself a write for this host. Reordered for that
    // reason: the cheap filters used to run first, and one of them wrote.
    //
    // SKIPPED, NOT DROPPED: `continue` leaves the checkout `open` and
    // unstamped, so the reminder is sent — or the row expired — on the first
    // beat after the lift. Nothing here marks a checkout done, so declining
    // to act IS leaving it for later.
    if (await gate.isLocked(hostId)) {
      skippedLocked += 1
      continue
    }
    const createdAtMs = Number(data.createdAtMs ?? 0)
    if (!data.email || data.remindedAtMs) continue
    if (now - createdAtMs < REMIND_AFTER_MS) continue
    if (now - createdAtMs > GIVE_UP_AFTER_MS) {
      await docSnapshot.ref
        .set({ status: 'expired' }, { merge: true })
        .catch(() => undefined)
      continue
    }
    if (!entitledHosts.has(hostId)) {
      const org = await getOrgForHost(hostId).catch(() => null)
      entitledHosts.set(
        hostId,
        Aglyn.checkEntitlement(org?.org as any, 'abandonedCart'),
      )
      brandingByHost.set(hostId, Aglyn.resolveBrandingProfile(org?.org as any))
      // The site's own origin, for the unsubscribe link. Resolved once per
      // host for the same reason the branding beside it is: this sweep is a
      // `collectionGroup` over every site's checkouts, and a read per
      // reminder would be a read per shopper.
      const hostSnapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .get()
        .catch(() => null)
      siteBaseByHost.set(
        hostId,
        Aglyn.hostPublicOrigin({
          cname: hostSnapshot?.get('cname'),
          subdomain: hostSnapshot?.get('subdomain'),
        }) ?? '',
      )
    }
    if (!entitledHosts.get(hostId)) continue
    let loaded = templateCache.get(hostId)
    if (loaded === undefined) {
      loaded = await loadHostEmail(firestore, hostId, 'abandoned-cart')
      templateCache.set(hostId, loaded)
    }
    const designed = loaded
      ? renderLoadedHostEmail(loaded, {
          'cart.url': String(data.resumeUrl ?? ''),
        })
      : null
    /*
     * MARKETING, and `'bulk'` priority, which this sweep is entitled to
     * precisely because it is resumable: a checkout left unstamped below is
     * re-scanned on the next beat, so a refusal means "not this hour" rather
     * than a reminder nobody ever gets.
     *
     * The gate adds the unsubscribe header pair and a visible link, checks
     * both suppression lists, and counts this against how much mail the
     * shopper has had from this site today.
     */
    const result = await sendEmail({
      to: String(data.email),
      subject: designed?.subject ?? 'You left something in your cart',
      text:
        designed?.text ||
        'Your cart is still waiting — pick up where you left off:\n\n' +
          `${data.resumeUrl ?? ''}\n\n` +
          'Your items are held but not reserved, so they may sell out.',
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: brandingByHost.get(hostId)?.fromName,
      context: 'abandoned cart',
      priority: 'bulk',
      marketing: { hostId, siteBase: siteBaseByHost.get(hostId) ?? '' },
    })
    /*
     * SKIPPED, NOT DROPPED — the lockdown rule above, applied to the two
     * refusals a later beat can pass.
     *
     * `remindedAtMs` is what retires a checkout from this sweep. Stamping it
     * after the hourly ceiling or the frequency cap refused would turn a
     * deferral into a reminder nobody ever gets; NOT stamping it after a
     * suppression or a rejection would re-read the same doomed row on every
     * beat until it crowded out the checkouts that could still be reminded.
     * `isDeferrableSendResult` is the one place that distinction is made.
     */
    if (isDeferrableSendResult(result)) continue
    // Cost meter (AGL-1438). One reminder per abandoned checkout, triggered
    // by that shopper's own action rather than composed as a broadcast, so
    // it counts toward cost without entering the campaign cap. On the
    // DELIVERED message only: a suppressed recipient produced no message, so
    // there is no cost to record.
    if (result.sent) await meterHostEmail(hostId)
    await docSnapshot.ref
      .set({ remindedAtMs: now }, { merge: true })
      .catch(() => undefined)
    if (result.sent) sent += 1
  }
  return { scanned: openCheckouts.size, sent, skippedLocked }
}

/**
 * HTTP door for the pass above (AGL-323). Kept `x-cron-secret`-gated so an
 * external scheduler or an operator can still drive it; the job registration
 * in `server.ts` is what makes it actually run.
 */
export const processAbandonedHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(501).json({ error: 'Not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!isEmailConfigured()) {
    return res.status(501).json({ error: 'Email is not configured.' })
  }
  try {
    // The manual door asks the same question the beat does (AGL-2495): a
    // forced pass is still a pass, and `x-cron-secret` is not an argument
    // for mailing a suspended site's shoppers.
    return res.status(200).json(await scanAbandonedCheckouts(pluginJobHostGate()))
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Processing failed' })
  }
}
