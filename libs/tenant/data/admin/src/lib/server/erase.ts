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
    await firestore
      .collection('orgs')
      .doc(orgId)
      .set({ hosts: { [hostId]: FieldValue.delete() } }, { merge: true })
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

type DocRef = FirebaseFirestore.DocumentReference

/** Recursively snapshot a doc + all its subcollections (for the export). */
async function exportDocTree(ref: DocRef): Promise<Record<string, unknown>> {
  const snapshot = await ref.get()
  const result: Record<string, unknown> = {
    _id: ref.id,
    data: snapshot.exists ? snapshot.data() : null,
  }
  const collections = await ref.listCollections()
  for (const collectionRef of collections) {
    const docs = await collectionRef.get()
    result[collectionRef.id] = await Promise.all(
      docs.docs.map((docSnapshot) => exportDocTree(docSnapshot.ref)),
    )
  }
  return result
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
async function eraseOrgApiKeys(orgId: string): Promise<number> {
  return deleteDocsByOrgId('apiKeys', orgId)
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
 */
async function deleteDocsByOrgId(
  collection: string,
  orgId: string,
): Promise<number> {
  if (!orgId) return 0
  const firestore = firebaseAdmin.app().firestore()
  const rows = await firestore
    .collection(collection)
    .where('orgId', '==', orgId)
    .get()
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
async function eraseOrgSsoDomains(orgId: string): Promise<number> {
  return deleteDocsByOrgId('ssoDomains', orgId)
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
async function releaseOrgConsoleDomains(orgId: string): Promise<number> {
  const firestore = firebaseAdmin.app().firestore()
  const claims = await firestore
    .collection(CONSOLE_DOMAINS_COLLECTION)
    .where('orgId', '==', orgId)
    .get()
  const primaries = new Set(
    claims.docs.map((doc) => (doc.get('primaryHost') as string) || doc.id),
  )
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
async function eraseOrgStripeIndex(orgId: string): Promise<number> {
  return deleteDocsByOrgId('stripeCustomers', orgId)
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
async function eraseOrgIdempotencyKeys(orgId: string): Promise<number> {
  return deleteDocsByOrgId('apiIdempotency', orgId)
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
): Promise<number> {
  const firestore = firebaseAdmin.app().firestore()
  const held = await firestore
    .collection('orgSlugs')
    .where('orgId', '==', orgId)
    .get()
  const slugs = new Set(held.docs.map((doc) => doc.id))
  if (currentSlug) slugs.add(currentSlug)
  for (const slug of slugs) {
    await firestore.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
    await detachWorkspaceDomain(slug).catch(() => undefined)
  }
  return slugs.size
}

/**
 * The steps of `eraseOrg` after the hold check, named so a failed attempt can
 * say WHERE it stopped (AGL-1455). `export` is the safe one — nothing is gone
 * and nothing is written. Every name after it means the export bundle is
 * already in the bucket.
 */
type EraseStep =
  | 'export'
  | 'credentials'
  | 'hosts'
  | 'org-storage'
  | 'stripe'
  | 'members'
  | 'org-tree'
  | 'slugs'

export interface EraseOrgResult {
  ok: boolean
  /** Set when the org was NOT erased (flag missing, hold not elapsed, gone). */
  skippedReason?: string
  /** Storage path of the final export bundle when erased. */
  exportPath?: string
  hosts?: number
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
}

/** What an in-flight erasure has destroyed so far — counts only. */
type EraseProgress = Omit<EraseOrgResult, 'ok' | 'skippedReason' | 'exportPath'>

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
 * `after.exportWritten` is the field that matters. When it is true a complete
 * dump of a workspace that STILL EXISTS is sitting in the bucket under
 * `after.exportPath` — the worst state this path can leave behind, and
 * previously the least visible.
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
  before: { hosts: number; members: number }
  after: Record<string, unknown>
}): Promise<void> {
  await firebaseAdmin
    .app()
    .firestore()
    .collection('adminAudit')
    .add({
      actorUid: 'cron:run-erasures',
      action: 'org.erase-failed',
      target: `orgs/${entry.orgId}`,
      before: entry.before,
      after: {
        failedStep: entry.step,
        error: errorLabel(entry.error),
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
 * Order matters and every step is defensive:
 *   1. Re-read the org and re-verify erasureRequestedAt + hold — never
 *      delete on a stale/cancelled request.
 *   2. Write a final JSON export (org + host trees) to Storage FIRST — if
 *      the export can't be written, abort without deleting anything.
 *   3. Revoke the org's API credentials (AGL-1444) and its public routing —
 *      SSO domains and custom console domains (AGL-1448). All three are
 *      top-level collections keyed by something other than the org id, so the
 *      org-tree delete cannot reach them; doing them before the content
 *      delete also closes the mid-erasure window, in which a credential or a
 *      domain still resolves to a half-deleted workspace.
 *   4. Delete each host (eraseHost), org-level Storage, the Stripe customer
 *      AND its local reverse index, member back-references, then the org tree
 *      and every slug the org ever held — tombstones included (AGL-1448).
 *   5. Audit.
 *
 * Every ending is audited, not just the successful one (AGL-1455). An aborted
 * export and a throw from any step after it both write an `org.erase-failed`
 * row before returning or re-throwing, because `erasureRequestedAt` stays set
 * on a failure: without a record the org is retried and fails identically on
 * every subsequent run, forever, and nothing anywhere says so.
 */
export async function eraseOrg(orgId: string): Promise<EraseOrgResult> {
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

  // Export FIRST — erasure must never be a data's only ending. Abort the
  // whole operation if we can't persist the bundle.
  //
  // The bundle BUILD is inside the guard with the write (AGL-1455). It used to
  // sit outside, so a read failure while walking the tree — the shape this
  // path is likeliest to fail in, since the bundle is proportional to the
  // whole workspace — escaped as a throw rather than the deliberate abort,
  // and took the rest of the cron batch with it. Both halves now end the same
  // way: nothing deleted, and the attempt recorded.
  const exportPath = `erasures/${orgId}/${requestedMs}.json`
  try {
    const bundle = {
      exportedAt: new Date().toISOString(),
      org: await exportDocTree(orgRef),
      hosts: await Promise.all(
        hosts.docs.map((host) => exportDocTree(host.ref)),
      ),
    }
    await storageBucket()
      .file(exportPath)
      .save(Buffer.from(JSON.stringify(bundle)), {
        contentType: 'application/json',
      })
  } catch (error) {
    console.error(`eraseOrg: export write failed for ${orgId}; aborting`, error)
    await recordErasureFailure({
      orgId,
      step: 'export',
      error,
      before,
      // Nothing is gone and nothing is written: the safe abort.
      after: { exportWritten: false },
    })
    return { ok: false, skippedReason: 'export-failed' }
  }

  // Everything below runs with a COMPLETE dump of the org already in the
  // bucket, and none of it was guarded (AGL-1455) — `eraseOrgApiKeys`,
  // `eraseOrgSsoDomains`, `eraseOrgIdempotencyKeys` and `recursiveDelete` all
  // throw. A throw here leaves the worst state this path can produce: the
  // workspace still standing, part of it already destroyed, and its full
  // export persisted. That was recorded nowhere. Each step now names itself,
  // and the error is re-thrown unchanged — this adds a record, it does not
  // swallow the failure.
  const progress: EraseProgress = {}
  let step: EraseStep = 'credentials'
  try {
    // Credentials and routing BEFORE content (AGL-1444/AGL-1448). The org doc
    // survives until the recursiveDelete at the end, so a key presented — or a
    // sign-in routed, or a console domain resolved — mid-erasure would still
    // pass the org gate and reach a half-deleted workspace. Revoking first
    // closes that window as well as the permanent one.
    progress.apiKeys = await eraseOrgApiKeys(orgId)
    progress.ssoDomains = await eraseOrgSsoDomains(orgId)
    progress.consoleDomains = await releaseOrgConsoleDomains(orgId)
    progress.apiIdempotency = await eraseOrgIdempotencyKeys(orgId)

    // Hosts (Storage + routing + Firestore trees).
    step = 'hosts'
    progress.hosts = 0
    for (const host of hosts.docs) {
      await eraseHost(host.id)
      progress.hosts += 1
    }

    // Org-level Storage (media/dataset assets outside the host prefix).
    step = 'org-storage'
    try {
      await storageBucket().deleteFiles({ prefix: `orgs/${orgId}/` })
    } catch (error) {
      console.error(`eraseOrg: org storage cleanup failed for ${orgId}`, error)
    }

    // Stripe: the customer at the processor, AND the local reverse index that
    // correlates that identity back to this workspace (AGL-1448). Deleting
    // only the first left exactly the record AGL-1028 denied to every client.
    step = 'stripe'
    await deleteStripeCustomer(stripeCustomerId)
    progress.stripeIndex = await eraseOrgStripeIndex(orgId)

    // Members' reverse index into this org.
    step = 'members'
    for (const member of members.docs) {
      await firestore
        .collection('users')
        .doc(member.id)
        .collection('orgs')
        .doc(orgId)
        .delete()
        .catch(() => undefined)
    }

    // The org subtree, then every slug reservation it has ever held — the
    // current one and each rename tombstone (AGL-1448), with the matching
    // `{slug}.aglyn.com` detached (AGL-1136).
    step = 'org-tree'
    await firestore.recursiveDelete(orgRef)
    step = 'slugs'
    progress.slugs = await eraseOrgSlugs(orgId, slug)
  } catch (error) {
    console.error(
      `eraseOrg: ${step} failed for ${orgId} AFTER the export was written`,
      error,
    )
    await recordErasureFailure({
      orgId,
      step,
      error,
      before,
      // The org survives and its dump does not: name the object, or nobody
      // can find the export that outlived the workspace.
      after: { exportWritten: true, exportPath, ...progress },
    })
    throw error
  }

  await firestore
    .collection('adminAudit')
    .add({
      actorUid: 'cron:run-erasures',
      action: 'org.erased',
      target: `orgs/${orgId}`,
      before,
      after: { exportPath, ...progress },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, exportPath, ...progress, hosts: hosts.size }
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
  deleted?: { subcollections: string[]; authRecord: boolean; photo: boolean }
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
 *   3. Delete the profile subtree, the avatar, then the auth record last —
 *      once that is gone there is no uid to retry with.
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
      after: { subcollections, authRecord, photo },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, deleted: { subcollections, authRecord, photo } }
}
