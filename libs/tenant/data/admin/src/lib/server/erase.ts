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

import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import { deleteHostProjectionForAllMembers } from './host-memberships'
import { detachWorkspaceDomain } from './workspace-domains'
import {
  CONSOLE_DOMAINS_COLLECTION,
  releaseConsoleDomain,
} from './console-domains'
import { authForPool, findUserByUidAcrossPools } from './auth-pools'
import { removeOrgMember } from './organizations'
import { isBillingSubscription } from '@aglyn/aglyn/server'
import { readOrgBilling } from './org-billing'

/** The reversible hold before a requested erasure is executed (AGL-485). */
export const ERASURE_HOLD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The admin app is initialized without a default storageBucket, so every
 * bucket access must name it explicitly (same as the media routes). Falls
 * through to the admin default if the env is somehow unset.
 */
function storageBucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  return firebaseAdmin.app().storage().bucket(name || undefined)
}

/**
 * Permanently erase a single site and everything it owns (AGL-488).
 * Unlike deleting the host doc alone (which orphans data), this cleans up
 * every trailing reference:
 *   - Storage objects under `hosts/{hostId}/` (media, CDN variants),
 *   - the `hostIndex/{hostId}` routing entry (subdomain/cname resolution),
 *   - the owning org's `hosts` routing-map entry, and
 *   - the host's Firestore tree (screens, layouts, versions, counters, …)
 *     via `recursiveDelete`.
 *
 * Shared by the self-serve delete-site route and the org-erasure pipeline
 * (AGL-487). Fail-soft on Storage/index cleanup so a partial failure never
 * blocks the Firestore delete; safe to re-run.
 */
export async function eraseHost(hostId: string): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  const orgId = hostSnapshot.get('orgId') as string | undefined

  // Storage first (best-effort — the object tree is derived, regenerable).
  try {
    await storageBucket().deleteFiles({ prefix: `hosts/${hostId}/` })
  } catch (error) {
    console.error(`eraseHost: storage cleanup failed for ${hostId}`, error)
  }

  // Routing: the middleware resolves a request to a host via hostIndex and
  // the owning org's hosts map — drop both so the subdomain/cname 404s.
  await firestore
    .collection('hostIndex')
    .doc(hostId)
    .delete()
    .catch(() => undefined)
  if (orgId) {
    // The routing entry and the site's POS register seats go in the SAME
    // write (AGL-1775). `registerAllocations[hostId]` is capacity the org has
    // paid for and assigned here; a deleted site must return it to the pool
    // or the org keeps paying $89/mo for a seat pinned to a site that no
    // longer exists and cannot be reassigned from any surface. Releasing it
    // by deleting the key rather than by decrementing a counter means the
    // pool is `purchased - sum(allocations)` by arithmetic and has nothing to
    // drift out of step with.
    await firestore
      .collection('orgs')
      .doc(orgId)
      .set(
        {
          hosts: { [hostId]: FieldValue.delete() },
          registerAllocations: { [hostId]: FieldValue.delete() },
        },
        { merge: true },
      )
      .catch(() => undefined)
    // Drop every member's reverse-index row for this host (AGL-844); the
    // members still exist here (recursiveDelete of the org, if any, is later).
    await deleteHostProjectionForAllMembers(orgId, hostId).catch(() => undefined)
  }

  // The host document tree (screens/layouts/versions/counters/products/…).
  await firestore.recursiveDelete(hostRef)
}

/**
 * Delete a single resource document *and everything under it* (AGL-945).
 *
 * Firestore does not cascade: deleting `orgs/{o}/datasets/{d}` leaves every
 * `records/{r}` beneath it alive but unreachable from the console — still
 * billed, still matched by the rules (which match subcollection paths
 * independently of the parent), and resurrected wholesale if the parent id
 * is ever reused. Only the Admin SDK has `recursiveDelete`, so the console
 * cards route their deletes through /api/resources/erase, which lands here.
 *
 * Authorization belongs to the caller — this only walks the tree.
 */
export async function eraseSubtree(
  path: readonly [string, string, string, string],
): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const [scope, scopeId, kind, id] = path
  await firestore.recursiveDelete(
    firestore.collection(scope).doc(scopeId).collection(kind).doc(id),
  )
}

/** Best-effort Stripe customer deletion — PII lives at the processor too. */
async function deleteStripeCustomer(customerId?: string): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !customerId) return
  try {
    await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch (error) {
    console.error(`eraseOrg: Stripe customer ${customerId} delete failed`, error)
  }
}

/**
 * Delete every API credential the org owns (AGL-1444).
 *
 * `apiKeys` is a TOP-LEVEL collection keyed by the SHA-256 of the token and
 * carrying `orgId` as a FIELD, so `recursiveDelete(orgRef)` cannot see it —
 * a path-scoped cascade is structurally blind to anything not under the path.
 * The credential therefore outlived the workspace: `verifyApiKey` kept
 * resolving the token to a live principal naming an org that no longer
 * existed. `authenticateApiV1` happens to refuse it (it reads the org doc and
 * 401s), but that is a gate one layer above the credential, and a key whose
 * revocation depends on every future caller repeating a lookup is not
 * revoked. The document is also a small record of the erased workspace in its
 * own right — a human-authored label, the creating uid, the granted scopes.
 *
 * Bounded by the `orgId` field, never a collection sweep: this collection
 * holds every other customer's integration credentials too.
 *
 * Returns the number destroyed, for the audit row — an erasure trail that
 * understates what it removed is the one record that has to be right.
 */
async function eraseOrgApiKeys(orgId: string, dryRun = false): Promise<number> {
  return deleteDocsByOrgId('apiKeys', orgId, dryRun)
}

/**
 * Delete every document in a TOP-LEVEL collection that names this org in its
 * `orgId` FIELD (AGL-1444/AGL-1448).
 *
 * The shared mechanism behind every collection a path-scoped cascade cannot
 * see. Two properties are the whole point, and neither is optional:
 *
 *   - **Bounded by the field, never a collection sweep.** Every one of these
 *     collections holds other customers' credentials, routing and billing
 *     correlations. A `collection(name).get()` here would erase the estate.
 *   - **Chunked**, because a batch caps at 500 writes and nothing bounds an
 *     org's row count below that.
 *
 * Returns the number destroyed, for the audit row — an erasure trail that
 * understates what it removed is the one record that has to be right.
 *
 * `dryRun` runs the query and skips the commit (AGL-1481), so a plan counts
 * rows through the SAME function that deletes them. A separate counting pass
 * would be a second enumeration of the sweep list, which is precisely the
 * divergence AGL-1481 exists to remove.
 *
 * **`platformRevenue` must NEVER be added to this sweep (AGL-1811).** It is
 * org-keyed by field — exactly the shape this mechanism eats — and that is
 * the trap: those rows are per-transaction TAX FILING RECORDS (gross, tax,
 * jurisdiction) with a statutory retention obligation, and the quarterly
 * Texas return is their sum. GDPR Art. 17(3)(b) exempts them: erasure does
 * not extend to records retained for compliance with a legal obligation. An
 * erased org's rows deliberately outlive it — the
 * `erase-org-tax-retention.emulator.spec` pins survival, so an over-eager
 * future sweep fails a test instead of un-filing a tax period.
 *
 * **`storefrontTaxCollected` must NEVER be added either (AGL-1904).** Same
 * shape, same trap, same reason: it carries `orgId` as a field, and its rows
 * are the record of sales tax charged to shoppers on that org's storefront —
 * including the tax a `mode: 'stripe'` store collects under AGLYN's own
 * Texas registration, which Aglyn must be able to account for long after the
 * merchant has gone.
 */
async function deleteDocsByOrgId(
  collection: string,
  orgId: string,
  dryRun = false,
): Promise<number> {
  if (!orgId) return 0
  const firestore = firebaseAdmin.app().firestore()
  const rows = await firestore
    .collection(collection)
    .where('orgId', '==', orgId)
    .get()
  if (dryRun) return rows.size
  for (let index = 0; index < rows.docs.length; index += 400) {
    const batch = firestore.batch()
    for (const doc of rows.docs.slice(index, index + 400)) batch.delete(doc.ref)
    await batch.commit()
  }
  return rows.size
}

/**
 * Drop the org's public SSO routing documents (AGL-1448).
 *
 * `ssoDomains/{domain}` is keyed by the DOMAIN and carries `orgId` as a field,
 * so `recursiveDelete(orgRef)` never reaches it. The org's own claims under
 * `orgs/{orgId}/ssoDomains/{domain}` do die with the tree; the public routing
 * doc — the one that decides where a sign-in goes — does not.
 *
 * **`unpublishSsoDomains` is not the fix, though it looks like it.** That
 * function is the reversible half of the console's SSO toggle: it sets
 * `active: false` and leaves the document standing precisely so re-enabling
 * restores the same pool and the same uids. Applied to an erasure it would
 * leave behind a record naming the deleted org, its GCIP tenant and provider
 * ids, its IdP display name and the customer's email domain — and, worse, a
 * live reservation: `issueDomainClaim` refuses a domain whose `ssoDomains` doc
 * belongs to another org REGARDLESS of `active`, so a ghost would hold a real
 * customer's domain against them with no way to appeal. Absence is the only
 * state that both stops the routing and releases the name.
 *
 * Deleting is safe on the read side: `/api/auth/sso-lookup` already treats a
 * missing doc and an inactive one identically (`{ ssoEnabled: false }`).
 */
async function eraseOrgSsoDomains(
  orgId: string,
  dryRun = false,
): Promise<number> {
  return deleteDocsByOrgId('ssoDomains', orgId, dryRun)
}

/**
 * Release every custom console domain the org holds (AGL-1448).
 *
 * `releaseConsoleDomain` already does exactly the right thing and was called
 * from nothing but its own spec. It is wired rather than reimplemented, and
 * the ordering it enforces is the reason: Vercel detach FIRST, documents
 * second, and the claim KEPT if a detach fails. `resolveConsoleDomain`'s
 * `unknown` verdict — the one that lets localhost, previews and self-hosted
 * installs work — is only safe while every name the console project still
 * answers for has a document (AGL-1430). Deleting the claim here directly
 * would break that correspondence and hand the name to the next org that
 * claims it, with Vercel's `already-exists` reading as health.
 *
 * It takes one domain, so the org-bounded query is the part that was missing.
 * Every name in a claim set — the primary and its `www` twin — carries the
 * same `orgId` and the same `primaryHost`, so releasing once per distinct
 * primary covers the set exactly, without a second pass over the twins.
 *
 * Best-effort, like every other external cleanup here: an erasure must not
 * fail because Vercel did. A name that could not be detached keeps its claim
 * and is reported in the audit row as un-released.
 */
async function releaseOrgConsoleDomains(
  orgId: string,
  dryRun = false,
): Promise<number> {
  const firestore = firebaseAdmin.app().firestore()
  const claims = await firestore
    .collection(CONSOLE_DOMAINS_COLLECTION)
    .where('orgId', '==', orgId)
    .get()
  const primaries = new Set(
    claims.docs.map((doc) => (doc.get('primaryHost') as string) || doc.id),
  )
  // A plan counts the claim sets it WOULD release. `releaseConsoleDomain`
  // detaches at Vercel, so it must not run for a dry run (AGL-1481).
  if (dryRun) return primaries.size
  let released = 0
  for (const domain of primaries) {
    const result = await releaseConsoleDomain({ orgId, domain }).catch(
      (error) => {
        console.error(`eraseOrg: console domain ${domain} release failed`, error)
        return { released: false }
      },
    )
    if (result.released) released += 1
  }
  return released
}

/**
 * Drop the local Stripe reverse index (AGL-1448, AGL-1028).
 *
 * `stripeCustomers/{stripeCustomerId} -> { orgId }` exists because AGL-1028
 * moved `stripeCustomerId` off the org doc into a manager-gated subcollection,
 * which broke the webhook's `where('stripeCustomerId', '==', …)` lookup. It is
 * denied to every client for one reason, stated in the rules: readable, it
 * maps a billing identity back to a workspace.
 *
 * The erasure had this exactly inverted. It deleted the customer AT STRIPE and
 * kept the local index — so the artefact that survived was the correlation the
 * whole issue existed to prevent, now pointing at an org that no longer exists
 * to be gated on. This deletes the local rows. The Stripe-side delete is
 * unchanged and still runs: PII lives at the processor too, and one is not a
 * substitute for the other.
 *
 * Bounded by the `orgId` field rather than by the org's CURRENT customer id,
 * because nothing cleans up the index when a customer id changes — an org that
 * was re-created in Stripe has more than one row pointing at it.
 */
async function eraseOrgStripeIndex(
  orgId: string,
  dryRun = false,
): Promise<number> {
  return deleteDocsByOrgId('stripeCustomers', orgId, dryRun)
}

/**
 * Drop the org's REST API replay keys (AGL-1448).
 *
 * `apiIdempotency/{sha256(orgId:key)}` dedupes `POST`s by `Idempotency-Key`
 * (AGL-618). Low severity — a replay key names an org and a record id and
 * authorises nothing — but it does NOT age out on its own, which is the part
 * worth writing down because the assumption runs the other way: the only TTL
 * policy on the database is `rateLimits.expiresAt`
 * (`docs/FIRESTORE_MANUAL_CONFIG.md`), and these documents carry no expiry
 * field for a policy to key on. Left alone they accumulate against a dead org
 * indefinitely.
 *
 * Taken with the credentials rather than at the end: the record ids they carry
 * point into the org tree that step 4 destroys.
 */
async function eraseOrgIdempotencyKeys(
  orgId: string,
  dryRun = false,
): Promise<number> {
  return deleteDocsByOrgId('apiIdempotency', orgId, dryRun)
}

/**
 * Release every slug the org has EVER held (AGL-1448).
 *
 * The erasure deleted `orgSlugs/{org.slug}` — the current name only. But
 * `changeOrgSlug` leaves a tombstone at the previous slug (`{ orgId, movedTo,
 * renamedAt }`) so old workspace URLs keep redirecting (AGL-585/AGL-236), and
 * nothing ever collected them. Every historical name an org held therefore
 * survived its erasure, in the one collection the rules make
 * `allow read: if true` — public because it doubles as the pre-auth health
 * probe. An erased workspace's naming history stayed world-readable, each
 * tombstone still naming the dead org id.
 *
 * Bounded by the `orgId` field, which is exactly the right boundary here and
 * not merely the safe one: claiming a tombstoned slug FULL-REPLACES the
 * document with the new owner's `{ orgId }`, so a name this org renamed away
 * from and somebody else has since taken does not match — and must not be
 * swept, because it is now a live tenant's reservation.
 *
 * The current slug is unioned in rather than assumed present: an org whose
 * reservation was lost to a legacy write would otherwise keep its workspace
 * subdomain attached to the project.
 *
 * Each name's `{slug}.aglyn.com` is detached too. `changeOrgSlug` deliberately
 * KEEPS the old subdomain attached so the tombstone's 308 has a hostname to
 * run on; once the tombstone goes, the attachment is a name resolving to a
 * console for an org that does not exist. Best-effort, like every other
 * external cleanup here: an erasure must not fail because a DNS API did.
 */
async function eraseOrgSlugs(
  orgId: string,
  currentSlug?: string,
  dryRun = false,
): Promise<number> {
  const firestore = firebaseAdmin.app().firestore()
  const held = await firestore
    .collection('orgSlugs')
    .where('orgId', '==', orgId)
    .get()
  const slugs = new Set(held.docs.map((doc) => doc.id))
  if (currentSlug) slugs.add(currentSlug)
  // `detachWorkspaceDomain` calls a live DNS API — never on a plan (AGL-1481).
  if (dryRun) return slugs.size
  for (const slug of slugs) {
    await firestore.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    await detachWorkspaceDomain(slug).catch(() => undefined)
  }
  return slugs.size
}

/**
 * What an erasure did with `publisherProfiles/{orgId}` (AGL-1970).
 *
 * Three outcomes rather than a boolean, because the third one is a decision
 * the audit row has to be able to state: a listing the erased org published
 * can outlive it, and a listing whose publisher document is simply gone is
 * unattributable in a way nobody chose.
 */
export type PublisherProfileDisposition = 'absent' | 'deleted' | 'tombstoned'

/**
 * Drop the org's PUBLIC marketplace identity — the profile and every handle
 * it reserved (AGL-1970).
 *
 * Both survived every erasure until now, and both are `allow read: if true`
 * (`cloud/firebase-firestore.rules`, `match /publisherProfiles/{orgId}`). This
 * is the AGL-1448 shape with one twist that is the whole reason it was missed:
 * `publisherProfiles` is keyed by the org id **as the document id**, so it is
 * invisible to `deleteDocsByOrgId` *and* to a reader scanning this file for
 * the field-keyed sweep list. Nothing prompts you to notice it.
 *
 * What survived is not cosmetic. `stripeAccountId` is a **payout
 * destination** — written server-side only after Connect onboarding/KYC and
 * trusted by every checkout path — so an erased org stayed world-readable with
 * a live payment-account identifier attached to a dead identity. That is the
 * `stripeCustomers` correlation AGL-1448 removed, pointing the other way.
 *
 * `publisherHandles` is the easy half and goes unconditionally: it carries
 * `orgId` as a FIELD, so `deleteDocsByOrgId` fits exactly, and it is a **live
 * reservation** — `claimPublisherHandle` refuses a handle another org's row
 * names, so a ghost holds a marketplace name against a real customer with no
 * way to appeal. That is the `ssoDomains` argument verbatim, and absence is
 * again the only state that both stops the read and releases the name. Rename
 * tombstones (`{ orgId, movedTo }`) carry the same `orgId` and go with it, and
 * the field bound is what makes that safe: re-claiming a tombstone FULL-
 * REPLACES it with the new owner's `{ orgId }`, so a handle this org renamed
 * away from and somebody else has since taken does not match the query.
 *
 * **The profile is the half with a genuine tension, and it is resolved here
 * rather than deferred.** `marketplaceListings` outlives an erasure — that is
 * AGL-1448's parked Tier 3 product decision, an erased org's listing being
 * something buyers paid for — so deleting the publisher document outright can
 * leave a listing attributed to nothing. So:
 *
 *   - **No surviving listing** → `recursiveDelete` the profile. `deleted`.
 *     `recursiveDelete` and not `delete`: `publish-plugin` keeps its daily
 *     publish-rate window at `publisherProfiles/{orgId}/meta/publishWindow`,
 *     and a document delete would orphan it under a path with no owner.
 *   - **A listing survives** → the same `recursiveDelete`, then a minimal
 *     `{ erased: true, erasedAt }` in its place. `tombstoned`. The tombstone
 *     carries no `handle`, no `displayName`, no `bio`/`avatarUrl`/`website`,
 *     no `publisherAgreement` and — the point — no `stripeAccountId`. It is
 *     "an internal record that the erasure happened", which is exactly what
 *     the Privacy Policy §5 sentence reserves; every byte the sentence calls
 *     content is gone either way. Readers already handle it: with no `handle`,
 *     `resolvePublisherProfile` returns `null`, which is the pre-existing
 *     "this org has no profile" path.
 *
 * The count of surviving listings is returned either way, so an erasure that
 * left something standing SAYS SO in its audit row instead of reporting a
 * clean success — the Tier 3 decision is still open, and an erasure is the
 * one place its cost is measurable.
 */
async function eraseOrgPublisherIdentity(
  orgId: string,
  dryRun = false,
): Promise<{
  handles: number
  profile: PublisherProfileDisposition
  listingsRetained: number
}> {
  const firestore = firebaseAdmin.app().firestore()
  const handles = await deleteDocsByOrgId('publisherHandles', orgId, dryRun)
  const profileRef = firestore.collection('publisherProfiles').doc(orgId)
  const [profileSnapshot, listings] = await Promise.all([
    profileRef.get(),
    // `profileId` is the listing's publishing-org id (AGL-652) — the same
    // value as this profile's document id, under the older field name.
    firestore.collection('marketplaceListings').where('profileId', '==', orgId).get(),
  ])
  const listingsRetained = listings.size
  if (!profileSnapshot.exists) {
    return { handles, profile: 'absent', listingsRetained }
  }
  if (dryRun) {
    return {
      handles,
      profile: listingsRetained ? 'tombstoned' : 'deleted',
      listingsRetained,
    }
  }
  await firestore.recursiveDelete(profileRef)
  if (!listingsRetained) return { handles, profile: 'deleted', listingsRetained }
  await profileRef.set({ erased: true, erasedAt: FieldValue.serverTimestamp() })
  return { handles, profile: 'tombstoned', listingsRetained }
}

/**
 * The steps of `eraseOrg` after the hold check, named so a failed attempt can
 * say WHERE it stopped (AGL-1455).
 *
 * `export` used to lead this list, and its removal is the AGL-1443 change: an
 * erasure no longer writes anything before it starts deleting, so there is no
 * longer a step whose meaning is "nothing is gone yet". `credentials` is now
 * the first thing that can fail, and it destroys as it goes.
 */
type EraseStep =
  | 'credentials'
  | 'hosts'
  | 'org-storage'
  | 'stripe'
  | 'members'
  | 'org-tree'
  | 'slugs'

/**
 * The two things an OPERATOR needs that a served caller does not (AGL-1481).
 *
 * `tools/scripts/erase-tenant.mjs` is the manual path staff reach for when the
 * cron is stuck. It used to be a second implementation of this function, and it
 * drifted: by the time AGL-1481 was filed it was missing four sweeps added that
 * week and still wrote a complete dump of the workspace to the operator's
 * working directory. The fix is that it CALLS this function — which means the
 * capabilities it had and this function lacked have to live here instead.
 *
 * Neither is a hold bypass, deliberately. The script refused to run before the
 * 7-day hold elapsed and this function refuses too; an `ignoreHold` flag would
 * have been the easy way to keep the two paths identical and is the one
 * difference worth preserving as a refusal on both.
 */
export interface EraseOrgOptions {
  /**
   * Count what an erasure WOULD destroy and destroy nothing. Every sweep runs
   * its query and skips its write, so the plan is produced by the same list of
   * sweeps that the erasure is — a separate counting pass would be exactly the
   * second enumeration this issue removed. Nothing external is touched (no
   * Storage, no Stripe, no Vercel, no DNS) and no audit row is written.
   *
   * Returns `ok: false` with `skippedReason: 'dry-run'`: `ok` means the org was
   * erased, and a plan did not erase it. A caller that treats a plan as an
   * erasure is the one mistake this shape has to make impossible.
   */
  dryRun?: boolean
  /**
   * Who is answerable for this erasure, for the audit row. Defaults to the
   * cron. A staff member running the script by hand is not the scheduler, and
   * an erasure trail that says otherwise names the wrong actor for the single
   * most irreversible action the platform performs.
   */
  actorUid?: string
}

export interface EraseOrgResult {
  ok: boolean
  /**
   * Set when the org was NOT erased (flag missing, hold not elapsed, gone) —
   * and `'dry-run'` when nothing was erased because nothing was meant to be.
   */
  skippedReason?: string
  hosts?: number
  /** Member back-references cleaned up — reported so a plan can show them. */
  members?: number
  /** API credentials destroyed (AGL-1444) — outside the org path. */
  apiKeys?: number
  /** Public SSO routing docs destroyed (AGL-1448) — outside the org path. */
  ssoDomains?: number
  /** Custom console domains released (AGL-1448) — outside the org path. */
  consoleDomains?: number
  /** REST API replay keys destroyed (AGL-1448) — no TTL reaps these. */
  apiIdempotency?: number
  /** Local Stripe reverse-index rows destroyed (AGL-1448/AGL-1028). */
  stripeIndex?: number
  /** Slugs released — the current one AND every tombstone (AGL-1448). */
  slugs?: number
  /** Marketplace handle reservations released (AGL-1970) — id-keyed, public. */
  publisherHandles?: number
  /** What became of the org's public publisher profile (AGL-1970). */
  publisherProfile?: PublisherProfileDisposition
  /**
   * Marketplace listings that OUTLIVE this erasure and still name the org
   * (AGL-1970/AGL-1448 Tier 3). Reported rather than deleted: an erasure that
   * leaves something standing has to say so, and this is the number that makes
   * the parked listing-survival decision cost something measurable.
   */
  listingsRetained?: number
}

/**
 * What an in-flight erasure has destroyed so far — counts only.
 *
 * `members` is excluded: the inventory already reports it as `before.members`
 * on both audit rows, and a second copy under `after` would say the same
 * number twice.
 */
type EraseProgress = Omit<EraseOrgResult, 'ok' | 'skippedReason' | 'members'>

/**
 * A stable label for an error, carrying no free text (AGL-1455).
 *
 * The class name and the SDK's error code are enough to tell a Firestore
 * permission denial from a deadline exceeded from an out-of-memory kill. The
 * MESSAGE is deliberately not stored: a Firestore or Storage error quotes the
 * path — and sometimes the payload — it choked on, and this row lands in a
 * collection that must not become a second copy of what the erasure failed to
 * delete (AGL-1443). The full error still goes to `console.error`, which is
 * the log, not the record.
 */
function errorLabel(error: unknown): string {
  const source = (error ?? {}) as { name?: unknown; code?: unknown }
  const parts = [source.name, source.code].filter(
    (part) => typeof part === 'string' || typeof part === 'number',
  )
  return parts.length ? parts.join(':') : 'unknown'
}

/**
 * Record a failed erasure attempt where somebody will actually find it
 * (AGL-1455).
 *
 * Aborting when the export cannot be written is correct and stays — the bug
 * was that the abort was invisible. `skippedReason` reached exactly one
 * place, the cron endpoint's HTTP response body, and nobody reads a
 * scheduler's 200. Meanwhile `erasureRequestedAt` stays set, so the same org
 * is retried on the next run and fails the same way indefinitely, and the
 * customer who requested the erasure is told nothing.
 *
 * An `adminAudit` row is the cheapest durable form and the one the success
 * path already uses, so the two read as a pair: same `actorUid`, same
 * `target`, same `before` inventory, and `after` carrying what actually
 * happened. Staff can find every stuck erasure by filtering the audit log on
 * the action, which is exactly the search that was impossible before.
 *
 * `after.exportWritten`/`after.exportPath` used to be the fields that
 * mattered here: they named the complete dump of a still-existing workspace
 * that a post-export failure left in the bucket. AGL-1443 removed the write,
 * so that state is no longer reachable and the fields no longer exist. What
 * replaces them is `after.requestedAt` — WHICH erasure request is stuck,
 * which the object's name used to be the only record of.
 *
 * Ids, counts, a step name and a timestamp. Never customer data.
 *
 * Best-effort and never throws: this runs while an erasure is already
 * failing, and losing the original error to a bookkeeping write would be
 * worse than losing the row.
 */
async function recordErasureFailure(entry: {
  orgId: string
  step: EraseStep
  error: unknown
  /** Whoever asked for the erasure — the cron, or a named operator. */
  actorUid: string
  /** Millis of the `erasureRequestedAt` this attempt was fulfilling. */
  requestedAt: number
  before: { hosts: number; members: number }
  after: Record<string, unknown>
}): Promise<void> {
  await firebaseAdmin
    .app()
    .firestore()
    .collection('adminAudit')
    .add({
      actorUid: entry.actorUid,
      action: 'org.erase-failed',
      target: `orgs/${entry.orgId}`,
      before: entry.before,
      after: {
        failedStep: entry.step,
        error: errorLabel(entry.error),
        requestedAt: entry.requestedAt,
        ...entry.after,
      },
      at: FieldValue.serverTimestamp(),
    })
    .catch((auditError) => {
      console.error(
        `eraseOrg: could not record the failed attempt for ${entry.orgId}`,
        auditError,
      )
    })
}

/**
 * Permanently erase an organization once its 7-day hold has elapsed
 * (AGL-485/487). Runs from the automated cron and the manual staff path.
 *
 * **Both of those are literally this function (AGL-1481).** The manual path,
 * `tools/scripts/erase-tenant.mjs`, used to be a second implementation, and a
 * second implementation of a cascade delete is a divergence with a schedule:
 * within a week of `eraseOrgApiKeys`, the SSO/console-domain release and the
 * org-keyed index sweeps landing here, the script was missing all four and
 * reporting success without them — leaving a live API credential, live domain
 * reservations, `orgSlugs` tombstones and the `stripeCustomers` reverse index
 * behind an erasure a human had been told was complete. The script now calls
 * this, and `EraseOrgOptions` is where the two capabilities it had and this
 * did not (a plan, and a named actor) live instead.
 *
 * Order matters and every step is defensive:
 *   1. Re-read the org and re-verify erasureRequestedAt + hold — never
 *      delete on a stale/cancelled request.
 *   2. Nothing is written. This step used to persist a final JSON export of
 *      the org and host trees to `erasures/{orgId}/…` and abort if it could
 *      not — see the note below for why it is gone (AGL-1443).
 *   3. Revoke the org's API credentials (AGL-1444), its public routing — SSO
 *      domains and custom console domains (AGL-1448) — and its public
 *      marketplace identity: the publisher profile and every handle it
 *      reserved (AGL-1970). All of them are top-level collections keyed by
 *      something other than a path under the org, so the org-tree delete
 *      cannot reach them; doing them before the content delete also closes
 *      the mid-erasure window, in which a credential, a domain or a public
 *      publisher page still resolves to a half-deleted workspace.
 *   4. Delete each host (eraseHost), org-level Storage, the Stripe customer
 *      AND its local reverse index, member back-references, then the org tree
 *      and every slug the org ever held — tombstones included (AGL-1448).
 *   5. Audit.
 *
 * Every ending is audited, not just the successful one (AGL-1455). A throw
 * from any step writes an `org.erase-failed` row before re-throwing, because
 * `erasureRequestedAt` stays set on a failure: without a record the org is
 * retried and fails identically on every subsequent run, forever, and nothing
 * anywhere says so.
 *
 * **The erasure writes no copy of the workspace (AGL-1443).** It used to
 * persist `erasures/{orgId}/{requestedMs}.json` — and "export" understated
 * it: `exportDocTree` recursed `listCollections()` with no bound and copied
 * `snapshot.data()` wholesale, so the object was a complete verbatim copy of
 * the org tree and every host tree, carrying `webhooks.secret` (a plaintext
 * HMAC key), `orders.paymentLinkUrl` (a live bearer URL that lets its holder
 * pay), `screens.protection.passwordHash` and `ssoDomains.token`. It landed
 * on a prefix this function's own storage sweep does not cover, in a bucket
 * with no lifecycle rule, so the most sensitive object the platform can
 * produce outlived the request that deleted everything else — indefinitely,
 * unread, and belonging to a customer who had been told their workspace was
 * gone. Four facts decided it, and none of them is about tidiness:
 *
 *   - **Nothing read it.** One producer, zero consumers in the repo; the
 *     owner's confirmation email never mentioned it.
 *   - **A governed full copy already exists.** Firestore backups run weekly
 *     with 14-week retention (AGL-871), so the dump added no recoverability —
 *     only a second, ungoverned place the data lived.
 *   - **The minimum that proves an erasure was already being written.** The
 *     `adminAudit` row below is ids and counts, in a collection with a
 *     retention policy. The one thing the object's NAME carried that the row
 *     did not — which request this run fulfilled — is now `after.requestedAt`.
 *   - **The DPA commits to "a limited period, after which deleted or
 *     de-identified"**, which indefinite retention of a full dump sits
 *     outside of.
 *
 * Two consequences are deliberate, not side effects. The export-write abort
 * is gone with the write: there is nothing left to fail before the first
 * delete, so an erasure can no longer be blocked by Storage. And the export
 * was the only unbounded work in this function — it built the whole workspace
 * in memory inside a 60-second cron, so the larger the workspace the likelier
 * its erasure silently never happened (AGL-1455 half 1). That defect is
 * removed by deletion rather than by a streaming exporter.
 */
export async function eraseOrg(
  orgId: string,
  options: EraseOrgOptions = {},
): Promise<EraseOrgResult> {
  const { dryRun = false, actorUid = 'cron:run-erasures' } = options
  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(orgId)
  const orgSnapshot = await orgRef.get()
  if (!orgSnapshot.exists) return { ok: false, skippedReason: 'not-found' }

  const requestedMs = orgSnapshot.get('erasureRequestedAt')?.toMillis?.() ?? null
  if (!requestedMs) return { ok: false, skippedReason: 'no-request' }
  if (Date.now() - requestedMs < ERASURE_HOLD_MS) {
    return { ok: false, skippedReason: 'hold-active' }
  }

  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .get()
  const members = await orgRef.collection('members').get()
  const slug = orgSnapshot.get('slug') as string | undefined
  // AGL-1028: moved to `orgs/{orgId}/billing/stripe`; the helper falls back
  // to the org doc for orgs the backfill has not reached.
  const stripeCustomerId = (await readOrgBilling(orgId)).stripeCustomerId as
    | string
    | undefined

  // The inventory both audit rows report, taken before anything is touched.
  const before = { hosts: hosts.size, members: members.size }

  // No export. The write that used to stand here is gone (AGL-1443) — see
  // the note above this function. Nothing is persisted anywhere before the
  // deleting starts, and `requestedMs` now travels in the audit row rather
  // than in an object's name.

  // None of what follows was guarded (AGL-1455) — `eraseOrgApiKeys`,
  // `eraseOrgSsoDomains`, `eraseOrgIdempotencyKeys` and `recursiveDelete` all
  // throw. A throw here leaves a workspace half destroyed and still standing,
  // recorded nowhere. Each step now names itself, and the error is re-thrown
  // unchanged — this adds a record, it does not swallow the failure. What it
  // can no longer leave behind is the state that used to be the worst one: a
  // surviving workspace with its own complete dump already in the bucket.
  const progress: EraseProgress = {}
  let step: EraseStep = 'credentials'
  try {
    // Credentials and routing BEFORE content (AGL-1444/AGL-1448). The org doc
    // survives until the recursiveDelete at the end, so a key presented — or a
    // sign-in routed, or a console domain resolved — mid-erasure would still
    // pass the org gate and reach a half-deleted workspace. Revoking first
    // closes that window as well as the permanent one.
    progress.apiKeys = await eraseOrgApiKeys(orgId, dryRun)
    progress.ssoDomains = await eraseOrgSsoDomains(orgId, dryRun)
    progress.consoleDomains = await releaseOrgConsoleDomains(orgId, dryRun)
    progress.apiIdempotency = await eraseOrgIdempotencyKeys(orgId, dryRun)

    // The org's PUBLIC marketplace identity (AGL-1970). Here rather than with
    // the Stripe step, though it carries a payout id, because `publisherHandles`
    // is a live name reservation and belongs with the other reservations this
    // step releases — and because the profile is world-readable, so the sooner
    // it stops resolving the smaller the mid-erasure window.
    const publisher = await eraseOrgPublisherIdentity(orgId, dryRun)
    progress.publisherHandles = publisher.handles
    progress.publisherProfile = publisher.profile
    progress.listingsRetained = publisher.listingsRetained

    // Hosts (Storage + routing + Firestore trees).
    step = 'hosts'
    progress.hosts = 0
    for (const host of hosts.docs) {
      if (!dryRun) await eraseHost(host.id)
      progress.hosts += 1
    }

    // Org-level Storage (media/dataset assets outside the host prefix).
    step = 'org-storage'
    if (!dryRun) {
      try {
        await storageBucket().deleteFiles({ prefix: `orgs/${orgId}/` })
      } catch (error) {
        console.error(`eraseOrg: org storage cleanup failed for ${orgId}`, error)
      }
    }

    // Stripe: the customer at the processor, AND the local reverse index that
    // correlates that identity back to this workspace (AGL-1448). Deleting
    // only the first left exactly the record AGL-1028 denied to every client.
    step = 'stripe'
    if (!dryRun) await deleteStripeCustomer(stripeCustomerId)
    progress.stripeIndex = await eraseOrgStripeIndex(orgId, dryRun)

    // Members' reverse index into this org.
    step = 'members'
    if (!dryRun) {
      for (const member of members.docs) {
        await firestore
          .collection('users')
          .doc(member.id)
          .collection('orgs')
          .doc(orgId)
          .delete()
          .catch(() => undefined)
      }
    }

    // The org subtree, then every slug reservation it has ever held — the
    // current one and each rename tombstone (AGL-1448), with the matching
    // `{slug}.aglyn.com` detached (AGL-1136).
    step = 'org-tree'
    if (!dryRun) await firestore.recursiveDelete(orgRef)
    step = 'slugs'
    progress.slugs = await eraseOrgSlugs(orgId, slug, dryRun)
  } catch (error) {
    console.error(`eraseOrg: ${step} failed for ${orgId}`, error)
    await recordErasureFailure({
      orgId,
      step,
      error,
      actorUid,
      requestedAt: requestedMs,
      before,
      // How far it got, so the next reader knows what is already destroyed.
      after: { ...progress },
    })
    throw error
  }

  // A plan (AGL-1481). Every sweep above ran its query and skipped its write,
  // so these are the counts the real run would report — reached through the
  // same code, which is the whole point of the operator script calling this
  // function instead of listing the sweeps a second time. No audit row: an
  // erasure that did not happen is not a record of one.
  if (dryRun) {
    return {
      ok: false,
      skippedReason: 'dry-run',
      ...progress,
      hosts: hosts.size,
      members: members.size,
    }
  }

  // The proof of erasure, and now the only record of it: actor, action,
  // target, the request it fulfilled, the inventory found and what each sweep
  // destroyed. Ids and counts — never the content (AGL-1443).
  await firestore
    .collection('adminAudit')
    .add({
      actorUid,
      action: 'org.erased',
      target: `orgs/${orgId}`,
      before,
      after: { requestedAt: requestedMs, ...progress },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, ...progress, hosts: hosts.size, members: members.size }
}

/** An org that stops a person's account from being erased. */
export interface UserErasureBlocker {
  orgId: string
  orgName: string
  /** Whether the org still bills — the reason a human must intervene. */
  hasLiveSubscription: boolean
  /** Other people who would be stranded if this org lost its owner. */
  otherMembers: number
}

export interface UserErasureCandidateOrg {
  orgId: string
  orgName: string
  ownerUid: string | null
  hasLiveSubscription: boolean
  memberCount: number
}

/**
 * Which orgs block erasing `uid` (AGL-1140).
 *
 * Pure so the policy can be tested without Firestore, because the policy is
 * the part worth arguing about — the deletion itself is mechanical.
 *
 * **Owning an org blocks erasure, always.** Not only when it bills, and not
 * only when other members would be stranded. The alternative — cascading
 * into `eraseOrg` — deletes a workspace, its sites and its data as a side
 * effect of someone closing a personal account, and no consent given to the
 * second act was given to the first. Blocking is recoverable; a cascade is
 * not.
 *
 * A live subscription and stranded members are reported rather than gating,
 * so the message can say WHY this org needs attention instead of a bare
 * refusal — "transfer ownership" is useless advice if you do not know which
 * of eleven workspaces is the problem.
 */
export function userErasureBlockers(
  uid: string,
  orgs: readonly UserErasureCandidateOrg[],
): UserErasureBlocker[] {
  return orgs
    .filter((org) => org.ownerUid === uid)
    .map((org) => ({
      orgId: org.orgId,
      orgName: org.orgName,
      hasLiveSubscription: org.hasLiveSubscription,
      // The owner themselves is a member; anyone beyond that is stranded.
      otherMembers: Math.max(0, org.memberCount - 1),
    }))
}

export interface EraseUserResult {
  ok: boolean
  /** Set when the account was NOT erased. */
  skippedReason?: 'not-found' | 'owns-orgs'
  /** Orgs that must be handed over or deleted first. */
  blockers?: UserErasureBlocker[]
  /** What was actually removed, for the audit row and the caller's message. */
  deleted?: {
    subcollections: string[]
    authRecord: boolean
    photo: boolean
    /** `profiles/{uid}` — the world-readable public identity (AGL-1970). */
    profile: boolean
  }
}

/**
 * Permanently erase a person's account (AGL-1140).
 *
 * Nothing did this before: `eraseHost`, `eraseSubtree` and `eraseOrg` existed
 * and no path anywhere deleted a `users/{uid}`. That was survivable while the
 * doc held a name and a phone; AGL-1133 added a postal address, and "we have
 * no mechanism to delete it" is a bad answer to an erasure request.
 *
 * `eraseOrg` is deliberately NOT the model here. An org is a workspace with
 * one owner; a person belongs to many orgs, so erasing them must not take
 * anything with it that outlives them.
 *
 * Order matters:
 *   1. Refuse if they own an org — see `userErasureBlockers`.
 *   2. Remove their membership from every org they belong to, so no roster
 *      keeps their email and no host projection keeps granting them access.
 *      This runs BEFORE the profile delete: a half-erased account that still
 *      appears on a roster is worse than one not yet started.
 *   3. Delete the `users/{uid}` subtree, the avatar, the world-readable
 *      `profiles/{uid}` public identity (AGL-1970), then the auth record last
 *      — once that is gone there is no uid to retry with.
 */
export async function eraseUser(uid: string): Promise<EraseUserResult> {
  const firestore = firebaseAdmin.app().firestore()
  const userRef = firestore.collection('users').doc(uid)
  const snapshot = await userRef.get()
  const membership = await userRef.collection('orgs').get()
  // An absent profile doc is not an absent account — the doc is only born on
  // first save (AGL-1127), so the auth record and the org memberships can
  // outlive it. Treat "nothing anywhere" as not-found, not "no doc".
  if (!snapshot.exists && membership.empty) {
    const record = await findUserByUidAcrossPools(uid).catch(() => null)
    if (!record) return { ok: false, skippedReason: 'not-found' }
  }

  const candidates: UserErasureCandidateOrg[] = []
  for (const row of membership.docs) {
    const orgRef = firestore.collection('orgs').doc(row.id)
    const [org, members] = await Promise.all([
      orgRef.get(),
      orgRef.collection('members').count().get(),
    ])
    if (!org.exists) continue
    candidates.push({
      orgId: row.id,
      orgName: String(org.get('name') ?? row.id),
      ownerUid: (org.get('ownerUid') as string | undefined) ?? null,
      hasLiveSubscription: isBillingSubscription(org.data() as never),
      memberCount: Number(members.data().count ?? 0),
    })
  }
  const blockers = userErasureBlockers(uid, candidates)
  if (blockers.length) {
    return { ok: false, skippedReason: 'owns-orgs', blockers }
  }

  // Inventory BEFORE anything is deleted. Taken after the membership sweep
  // below, this under-reported: `removeOrgMember` empties `users/{uid}/orgs`,
  // and Firestore does not list a collection with no documents in it — so a
  // live run erased three subcollections and the audit record named two.
  // An erasure audit trail that understates what it destroyed is the one
  // record that has to be right. Measured 2026-08-01 (AGL-1140).
  const subcollections = (await userRef.listCollections()).map((c) => c.id)

  // Memberships first — a roster row carries their email and a host
  // projection carries their access, and both outlive the profile doc.
  for (const candidate of candidates) {
    await removeOrgMember(candidate.orgId, uid).catch((error) => {
      console.error(`eraseUser: membership cleanup failed for ${candidate.orgId}`, error)
    })
  }

  // The avatar outlives the doc otherwise.
  let photo = false
  try {
    await storageBucket().deleteFiles({ prefix: `users/${uid}/` })
    photo = true
  } catch (error) {
    console.error(`eraseUser: storage cleanup failed for ${uid}`, error)
  }

  await firestore.recursiveDelete(userRef)

  // `profiles/{uid}` — the person's PUBLIC identity (AGL-1970).
  //
  // A separate top-level collection keyed by the uid AS THE DOCUMENT ID, so
  // `recursiveDelete(users/{uid})` above never reaches it and no reader
  // scanning this function for a sweep list is prompted to notice it. It is
  // `allow read: if true` in the rules and carries `handle`, `displayName`,
  // and `stripeAccountId`/`stripeChargesEnabled` — a Stripe Connect payout
  // destination written server-side after KYC. An erased person therefore
  // stayed publicly listed with a live payment-account identifier attached,
  // which Privacy Policy §5 ("a genuine recursive delete… we keep no copy of
  // the erased content") says in terms does not happen.
  //
  // No tombstone, unlike the org's publisher profile: the only reader of the
  // display name is the support forum's author rendering, and a forum post
  // losing its author name is the intended outcome of erasing its author.
  //
  // `recursiveDelete` rather than `delete` — nothing writes a subcollection
  // under a profile today, and a document delete would silently orphan the
  // first thing that does.
  let profile = false
  try {
    const profileRef = firestore.collection('profiles').doc(uid)
    profile = (await profileRef.get()).exists
    await firestore.recursiveDelete(profileRef)
  } catch (error) {
    console.error(`eraseUser: public profile delete failed for ${uid}`, error)
  }

  // Auth record LAST: once it is gone there is no uid to retry with, and
  // `authForPool` is required because a project-level delete cannot see an
  // SSO account at all (AGL-1122).
  let authRecord = false
  try {
    const record = await findUserByUidAcrossPools(uid)
    if (record) {
      await authForPool(record.tenantId).deleteUser(uid)
      authRecord = true
    }
  } catch (error) {
    console.error(`eraseUser: auth record delete failed for ${uid}`, error)
  }

  await firestore
    .collection('adminAudit')
    .add({
      actorUid: 'system:erase-user',
      action: 'user.erased',
      target: `users/${uid}`,
      before: { orgs: candidates.length },
      after: { subcollections, authRecord, photo, profile },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, deleted: { subcollections, authRecord, photo, profile } }
}
