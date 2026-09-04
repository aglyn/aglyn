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
 * Can a customer still do the thing they pay for? (AGL-2586)
 *
 * Create an org, create a site, create a screen, publish it and see it live.
 * Every check that existed before this one measured a component; not one
 * asserted that any of those five completes. Publish in particular broke for
 * about twelve minutes on 2026-09-04 — Firestore rules shipped late after a
 * promotion, the `publishOutbox` block was not live yet, and because the
 * outbox entry rides the SAME client batch as the routing-map write, every
 * publish on the platform was refused whole. Nothing noticed.
 *
 * ## NOTHING IS WRITTEN — the pollution decision for these journeys
 *
 * A synthetic that creates a real org, site and screen every five minutes is
 * an abuse vector of our own making. It would squat slugs and subdomains,
 * consume a Vercel domain slot per org (`attachWorkspaceDomain` runs on every
 * org create), move `/api/health/signups`' org-creation alarm, land in
 * `orgs/{orgId}/usage/{month}` — which `/admin/revenue`, the margin report
 * and the usage alerts all read — and bill itself through
 * `/api/billing/report-usage`. So this takes the other option AGL-2586
 * allows, for all four journeys: assert reachability and authorization
 * WITHOUT committing the write.
 *
 * ## The three checks, and what each is really asking
 *
 * `create` — the reads every create path makes BEFORE its transaction, run
 * against subjects designed never to exist, plus the platform-wide valve
 * that can refuse all of them at once. A slug reservation that cannot be
 * read is an org creation that cannot start; a platform lockdown left armed
 * is every create refused with a 423 and no other symptom.
 *
 * `publishRules` — THE 2026-09-04 CHECK. Publishing is a CLIENT Firestore
 * batch, so unlike almost everything else on the platform it runs under
 * security rules, and rules deploy MANUALLY, outside the git → Vercel
 * pipeline. This reads the ruleset that is actually LIVE and asserts it still
 * declares the write the publish batch makes: a `publishOutbox` block, and a
 * create arm that admits exactly the field set the client writes
 * (`PUBLISH_OUTBOX_FIELDS`). Derived from the constants rather than a copy of
 * the rule text, so the next field added to the outbox document fails this
 * until the rules deploy catches up — which is the same drift, one version
 * later.
 *
 * `publishAnnounce` — did the publishes that DID land reach the live site? An
 * outbox entry is the durable record of a cache drop that has not happened.
 * Entries that have aged past `PUBLISH_OUTBOX_STALE_MS`, or spent their
 * `PUBLISH_OUTBOX_MAX_ATTEMPTS`, are publishes whose page is still serving
 * its old HTML. Absence is healthy here by construction: the tab deletes its
 * own entry on a successful announce, so a quiet collection means the fast
 * path is winning, not that nobody looked.
 *
 * ## What is deliberately NOT here
 *
 * "The page composes and serves" — that is `/api/health/render/site` and
 * `/api/health/render/marketing` in the tenant app (AGL-2486), which run the
 * real page loader against a real host. Repeating it here would give one
 * more 503 for a failure already named somewhere better.
 *
 * ## Cost
 *
 * Three small Firestore reads, one bounded outbox query, and two HTTPS GETs
 * against the Firebase rules control plane — all memoised per instance for
 * `PROBE_TTL_MS`, because the endpoint is public and the memo is what bounds
 * what anyone can make it spend.
 */
import { getApp } from 'firebase-admin/app'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import { firebaseAdmin, getPlatformLockdown } from '@aglyn/tenant-data-admin'
import { isLockdownActive, lockdownBlocks } from '@aglyn/aglyn/server'

import { PUBLISH_OUTBOX_COLLECTION } from '../../../../constants/publish-outbox'
import {
  createJourneyHealth,
  publishAnnounceHealth,
  publishRulesHealth,
  type CreateCheck,
  type OutboxEntryFacts,
  type PublishAnnounceCheck,
  type PublishRulesCheck,
} from './journeys-verdict'

/**
 * Five minutes, matching every sibling subsystem probe. It bounds what a
 * public unauthenticated endpoint can be made to cost — this one reaches an
 * external API — while staying well inside the fifteen-minute monitor
 * interval, so the memo is never what delays a red.
 */
export const PROBE_TTL_MS = 5 * 60_000

/**
 * Subjects that must not exist.
 *
 * The same idiom the root health check uses (`console-health-probe-does-not-
 * exist`): a MISSING document is a successful read. It proves credentials,
 * network and the query path all work, needs no fixture, cannot be broken by
 * somebody renaming a workspace, and returns almost nothing. Both names are
 * outside what a person could pick — `orgSlugs` and `hosts.subdomain` are
 * validated shapes — so "it exists" is itself worth reporting.
 */
const PROBE_ORG_SLUG = 'journey-probe-slug-does-not-exist'
const PROBE_SUBDOMAIN = 'journey-probe-subdomain-does-not-exist'

/** Outbox entries examined per probe. A ceiling on time and on cost. */
const OUTBOX_READ_LIMIT = 200

// ── the probes ──────────────────────────────────────────────────────────

export interface JourneysProbeResult {
  create: CreateCheck
  publishRules: PublishRulesCheck
  publishAnnounce: PublishAnnounceCheck
}

/**
 * The preflight reads every create path makes, plus the valve that refuses
 * all of them at once. Never throws.
 */
export async function probeCreate(): Promise<CreateCheck> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  try {
    const firestore = firebaseAdmin.app().firestore()
    const [platform, slug, subdomains] = await Promise.all([
      getPlatformLockdown(),
      // `orgSlugs` is the reservation `createOrganization` reads first inside
      // its transaction. Reading a name that cannot be taken proves the read
      // works without racing anybody for a real one.
      firestore.collection('orgSlugs').doc(PROBE_ORG_SLUG).get(),
      // The uniqueness query `claimHostForOrg` re-runs inside its
      // transaction. Key-only: nothing but the count is wanted.
      firestore
        .collection('hosts')
        .where('subdomain', '==', PROBE_SUBDOMAIN)
        .select()
        .limit(1)
        .get(),
    ])
    if (isLockdownActive(platform, Date.now()) && lockdownBlocks(platform, 'write')) {
      return createJourneyHealth({ kind: 'platform-locked' }, elapsed())
    }
    if (slug.exists || subdomains.size > 0) {
      return createJourneyHealth({ kind: 'subject-squatted' }, elapsed())
    }
    return createJourneyHealth({ kind: 'open' }, elapsed())
  } catch {
    // The error is dropped, never reported: this body is public and a
    // Firestore error message can carry project ids and document paths.
    return createJourneyHealth({ kind: 'unavailable' }, elapsed())
  }
}

/**
 * Which firebaserules release holds the Firestore rules. The same resource
 * the deploy scripts address, named here rather than assumed so an operator
 * on a differently-shaped project can point this at theirs.
 */
const FIRESTORE_RELEASE_ID = 'cloud.firestore'

/** Bounded: a monitoring probe must never be the thing that hangs. */
const RULES_FETCH_TIMEOUT_MS = 5_000

/**
 * The rules source that is actually LIVE, or null when it cannot be read.
 *
 * Release → `rulesetName` → ruleset → `source.files[0].content`, the same two
 * hops the deploy and drift tooling make (`tools/scripts/lib/firebase-rules-
 * api.mjs`). That module is a Node script library — it loads `.env` files off
 * disk at import and pulls in `node:fs` — so it is not importable from a
 * serverless route; this is the same two requests, and nothing else from it.
 *
 * The credential is the deployment's OWN admin credential. No new secret, and
 * nothing about it is in the repo.
 */
export async function readLiveFirestoreRules(): Promise<string | null> {
  try {
    // `getApp()` rather than the `firebaseAdmin` facade: the facade exposes the
    // four product handles and not `options`, and the credential is what mints
    // the token. `void firebaseAdmin` below is what guarantees the default app
    // exists by the time this runs — the same pairing `/api/health/signups`
    // uses.
    void firebaseAdmin
    const options = getApp().options
    const token = (await options.credential?.getAccessToken())?.access_token
    if (!token) return null
    const projectId = options.projectId ?? process.env['FIREBASE_PROJECT_ID']
    if (!projectId) return null
    const base = (
      process.env['FIREBASE_RULES_API_BASE'] ??
      'https://firebaserules.googleapis.com'
    ).replace(/\/+$/, '')
    const headers = { authorization: `Bearer ${token}` }
    const signal = AbortSignal.timeout(RULES_FETCH_TIMEOUT_MS)
    const release = await fetch(
      `${base}/v1/projects/${projectId}/releases/${FIRESTORE_RELEASE_ID}`,
      { headers, signal, cache: 'no-store' },
    )
    if (!release.ok) return null
    const rulesetName = (await release.json())?.['rulesetName']
    if (typeof rulesetName !== 'string' || !rulesetName) return null
    const ruleset = await fetch(`${base}/v1/${rulesetName}`, {
      headers,
      signal,
      cache: 'no-store',
    })
    if (!ruleset.ok) return null
    const content = (await ruleset.json())?.['source']?.['files']?.[0]?.['content']
    return typeof content === 'string' ? content : null
  } catch {
    // Any failure is "we could not read the live rules", which
    // `publishRulesHealth` grades as indeterminate rather than degraded. The
    // error is dropped: this body is public and it can carry a project id.
    return null
  }
}

/** Grade the live ruleset against the publish batch's write set. */
export async function probePublishRules(): Promise<PublishRulesCheck> {
  const startedAt = Date.now()
  const source = await readLiveFirestoreRules()
  return publishRulesHealth(source, Date.now() - startedAt)
}

/** Grade the publish outbox. Never throws. */
export async function probePublishAnnounce(): Promise<PublishAnnounceCheck> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(PUBLISH_OUTBOX_COLLECTION)
      // The drain's own ordering, served by the automatic single-field index
      // the collection was made top-level to get.
      .orderBy('createdAt')
      .limit(OUTBOX_READ_LIMIT)
      .get()
    const now = Date.now()
    const entries: OutboxEntryFacts[] = snapshot.docs.map((doc) => {
      const createdAt = doc.get('createdAt') as { toMillis?: () => number } | undefined
      const createdAtMs =
        typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : now
      return {
        ageMs: Math.max(0, now - createdAtMs),
        attempts: Number(doc.get('attempts') ?? 0),
      }
    })
    return publishAnnounceHealth(entries, elapsed())
  } catch {
    return publishAnnounceHealth(null, elapsed())
  }
}

/** All three, in parallel. Each is independent and each memoises separately. */
export async function probeJourneys(): Promise<JourneysProbeResult> {
  const [create, publishRules, publishAnnounce] = await Promise.all([
    probeCreate(),
    probePublishRules(),
    probePublishAnnounce(),
  ])
  return { create, publishRules, publishAnnounce }
}
