#!/usr/bin/env node
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
 * Stamp what the marketplace lists query by onto every listing and purchase
 * written before the fields existed (AGL-3321).
 *
 * Browse, the staff review queue and the licenses tab serve their filters and
 * search by Firestore query now, and a query cannot find a document that
 * lacks the field it asks about. Every writer stamps these going forward;
 * this reaches the backlog.
 *
 * `marketplaceListings`:
 *   - `nameLower`/`nameTokens`/`nameReversed`, `browseAudience`,
 *     `browseTokens`, `takenDown` — derived exactly as `listingQueryFields`
 *     derives them (`lib/listing-query-fields.mjs`, held to the
 *     library by a shared fixtures file), and rewritten where stale.
 *   - `installCount: 0` and `ratingAverage: null` where ABSENT, so Most
 *     installed and Highest rated order a listing nobody has installed or
 *     rated instead of dropping it.
 *   - `deletedAt: null` where absent: the staff queue asks `deletedAt == null`,
 *     and an absent field reads as live everywhere else.
 *   - `latestVersionReviewState` on a PLUGIN listing that has none, from its
 *     latest version's own `reviewState` (`pending` when that has none) —
 *     the value the queue's Awaiting review section asks for, and the same
 *     default the queue applied when it read version docs.
 *
 * `marketplacePurchases`:
 *   - `refundedAt: null` and `buyerOrgId: null` where ABSENT — the licenses
 *     tab asks `refundedAt == null` for a live license and `buyerOrgId ==
 *     null` for one that names no workspace. Never overwrites a value.
 *
 * ## Idempotence and interruption
 *
 * A document already current is never written, so a re-run is a no-op and an
 * interrupted run is finished by the next. Writes are merges of the moved
 * fields only, in batches of 400. Nothing is deleted.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-marketplace-listing-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-marketplace-listing-search.mjs --apply  # write
 *
 * A self-hosted install runs the same two commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  listingQueryFields,
  listingQueryFieldsPatch,
} from './lib/listing-query-fields.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Documents read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/** A plugin listing, by the discriminators `listingArtifactType` reads. */
const isPluginListing = (data) =>
  data.artifactType ? data.artifactType === 'plugin' : data.type === 'plugin'

/**
 * What a listing should be stamped with, or null when it is current. Pure:
 * the latest version's `reviewState` is read by the caller and passed in.
 *
 * @param {Record<string, unknown>} data the listing
 * @param {{ latestReviewState?: unknown }} [context]
 * @returns {Record<string, unknown> | null}
 */
export function planListing(data, context = {}) {
  const update = { ...(listingQueryFieldsPatch(data) ?? {}) }
  if (data.deletedAt === undefined) update.deletedAt = null
  if (isPluginListing(data) && data.latestVersionReviewState === undefined) {
    const state = context.latestReviewState
    update.latestVersionReviewState =
      typeof state === 'string' && state ? state : 'pending'
  }
  return Object.keys(update).length ? update : null
}

/**
 * What a purchase should be stamped with, or null when it is current.
 *
 * @param {Record<string, unknown>} data the purchase
 * @returns {Record<string, unknown> | null}
 */
export function planPurchase(data) {
  const update = {}
  if (data.refundedAt === undefined) update.refundedAt = null
  if (data.buyerOrgId === undefined) update.buyerOrgId = null
  return Object.keys(update).length ? update : null
}

function selfTest() {
  let failed = 0
  let total = 0
  const check = (name, actual, expected) => {
    total += 1
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failed += 1
      console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`)
    }
  }

  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'listing-query-fields.fixtures.json'), 'utf8'),
  )
  for (const one of fixtures.listings) {
    check(`fixture ${one.name}`, listingQueryFields(one.listing), one.expected)
  }

  const component = { displayName: 'Promo', profileId: 'org1', artifactType: 'component' }
  const stamped = planListing(component)
  check(
    'stamps a legacy component with every derived field, the sort defaults and deletedAt',
    Object.keys(stamped ?? {}).sort(),
    [
      'browseAudience',
      'browseTokens',
      'deletedAt',
      'installCount',
      'nameLower',
      'nameReversed',
      'nameTokens',
      'ratingAverage',
      'takenDown',
    ],
  )
  check('a stamped listing is current', planListing({ ...component, ...stamped }), null)
  check(
    'never resets a count or an average it did not write',
    planListing({ ...component, ...stamped, installCount: 7, ratingAverage: 4.5 }),
    null,
  )
  check(
    'a renamed listing gets new keys, and only those',
    Object.keys(planListing({ ...component, ...stamped, displayName: 'Countdown' }) ?? {}).sort(),
    ['browseTokens', 'nameLower', 'nameReversed', 'nameTokens'],
  )
  check(
    'an unpublished listing leaves browse',
    planListing({ ...component, ...stamped, deletedAt: { seconds: 1 } }),
    { browseAudience: [], browseTokens: [] },
  )
  const plugin = { displayName: 'Hours', profileId: 'org1', type: 'plugin', reviewStatus: 'submitted' }
  check(
    'a plugin with no summary takes its version’s verdict',
    planListing(plugin, { latestReviewState: 'approved' })?.latestVersionReviewState,
    'approved',
  )
  check(
    'a plugin whose version has none is pending, as the queue read it',
    planListing(plugin, {})?.latestVersionReviewState,
    'pending',
  )
  check(
    'a summary already there is never touched',
    'latestVersionReviewState' in (planListing({ ...plugin, latestVersionReviewState: 'revoked' }) ?? {}),
    false,
  )
  check(
    'a component never gets a review summary',
    'latestVersionReviewState' in (planListing(component) ?? {}),
    false,
  )

  check('a legacy purchase gets both nulls', planPurchase({ listingId: 'l1' }), {
    refundedAt: null,
    buyerOrgId: null,
  })
  check(
    'a refund is never overwritten',
    planPurchase({ listingId: 'l1', refundedAt: { seconds: 1 }, buyerOrgId: 'org1' }),
    null,
  )
  check(
    'an org purchase gets only the refund null',
    planPurchase({ listingId: 'l1', buyerOrgId: 'org1' }),
    { refundedAt: null },
  )
  check('a current purchase is current', planPurchase({ refundedAt: null, buyerOrgId: null }), null)

  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function run(args) {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldPath, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(`project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}`)

  const sweep = async (name, plan) => {
    const totals = { scanned: 0, current: 0, updated: 0 }
    const fields = new Map()
    let cursor = null
    for (;;) {
      // Paged by document name: every document has one, so the walk is total.
      let page = firestore.collection(name).orderBy(FieldPath.documentId()).limit(BATCH)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.get()
      if (snapshot.empty) break
      const batch = firestore.batch()
      let writes = 0
      for (const doc of snapshot.docs) {
        totals.scanned += 1
        const update = await plan(doc)
        if (!update) {
          totals.current += 1
          continue
        }
        totals.updated += 1
        for (const key of Object.keys(update)) fields.set(key, (fields.get(key) ?? 0) + 1)
        batch.set(doc.ref, update, { merge: true })
        writes += 1
      }
      if (args.apply && writes) await batch.commit()
      cursor = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.size < BATCH) break
    }
    console.log(
      `\n${name}: ${totals.scanned} scanned, ${totals.current} already current, ` +
        `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}`,
    )
    for (const [key, count] of fields) console.log(`  ${key}: ${count}`)
  }

  await sweep('marketplaceListings', async (doc) => {
    const data = doc.data()
    let latestReviewState
    if (isPluginListing(data) && data.latestVersionReviewState === undefined && data.latestVersion != null) {
      const version = await doc.ref.collection('pluginVersions').doc(String(data.latestVersion)).get()
      latestReviewState = version.exists ? version.get('reviewState') : undefined
    }
    return planListing(data, { latestReviewState })
  })
  await sweep('marketplacePurchases', async (doc) => planPurchase(doc.data()))
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

const args = parseDeployArgs({
  command: 'backfill-marketplace-listing-search',
  summary:
    'Stamp the fields the marketplace lists query by onto listings and purchases ' +
    'that predate them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

if (args.selfTest) selfTest()
else await run(args)
