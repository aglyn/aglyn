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
 * Recount every form's counters from the rows they count, and report drift
 * (AGL-3330).
 *
 * `/api/forms/submit` keeps `stats.submissions`, `stats.leads` and
 * `stats.lastSubmissionAtMs` by increment. An increment cannot see a
 * submission deleted from the Inbox, a lead erased on request, a write that
 * failed, or a history written before it, so the stored figures drift — on
 * production, before this ran, a form held `5` submissions and `4` leads over
 * two stored submissions and one lead. The console recounts a form after each
 * removal it makes (`recountFormStats`, through `/api/hosts/forms/stats`);
 * this is the same decision over every form, for the drift nothing prompted.
 *
 * Per form:
 *
 *  - submissions: `count()` of the site's `formSubmissions` with its `formId`;
 *  - leads: `count()` of the organization's leads whose `sources` hold
 *    `form:{formId}` — the PEOPLE the form filed that the workspace still
 *    holds, which is what the submit path counts; `0` on a form that routes
 *    leads and has filed none, `null` on one that never routed any;
 *  - last submission: the newest of those submissions' `createdAt`, from the
 *    `formId ASC, createdAt DESC` composite. A stored stamp within ten
 *    minutes of it agrees: the submit path stamps its own clock a moment
 *    after the row's commit.
 *
 * ## The decision comes from the shared script twin
 *
 * `lib/site-form-stats-recount.mjs` restates the library's `formCountersFromSource`
 * and `formCounterDrift`; both answer `lib/site-form-stats-recount.fixtures.json`
 * (`npm run test:site-form-stats-recount`, which runs `--self-test` too).
 *
 * ## Idempotence and interruption
 *
 * A form whose counters already agree is not written, so a re-run reports 0
 * drift and an interrupted run is finished by the next. Each form is counted
 * and written in ONE transaction, so a submission's increment landing
 * mid-recount contends with it and one of the two retries, rather than the
 * recount writing a figure the increment already moved past. Only
 * `hosts/{hostId}/forms/{formId}` is touched, and only its three counters.
 *
 * ## Running it
 *
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/recount-form-stats.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/recount-form-stats.mjs --apply  # write
 *     node tools/scripts/recount-form-stats.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { connectFirestore } from './lib/firestore-backfill.mjs'
import {
  FORM_COUNTER_FIELDS,
  formCounterDrift,
  formCounterPatch,
  formCountersFromSource,
  formLeadSource,
} from './lib/site-form-stats-recount.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMAND = 'recount-form-stats'

/** Documents read per page of the scan. */
const PAGE = 300

/** A Firestore `Timestamp`, a `Date` or epoch millis, as millis. */
function millisOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

/** Every fixture recounted: the recount and the drift each must report. */
function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(new URL('./lib/site-form-stats-recount.fixtures.json', import.meta.url), 'utf8'),
  )
  let failed = 0
  for (const one of fixtures.cases) {
    const recounted = formCountersFromSource(one.source)
    const drift = formCounterDrift(one.stored, recounted)
    const again = formCounterDrift(
      Object.fromEntries(FORM_COUNTER_FIELDS.map((field) => [field, recounted[field]])),
      recounted,
    )
    const ok =
      JSON.stringify(recounted) === JSON.stringify(one.recounted) &&
      JSON.stringify(drift) === JSON.stringify(one.drift) &&
      again.length === 0
    if (!ok) {
      failed += 1
      console.error(`FAIL ${one.name}: recounted ${JSON.stringify(recounted)}, drift ${JSON.stringify(drift)}`)
    }
  }
  const total = fixtures.cases.length
  console.log(failed ? `self-test: ${failed}/${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

/** The organization a site belongs to, by its `hostIndex` mirror, else its own document. */
async function orgIdOf(firestore, hostId, cache) {
  if (cache.has(hostId)) return cache.get(hostId)
  const indexed = await firestore.collection('hostIndex').doc(hostId).get()
  let orgId = indexed.get('orgId')
  if (typeof orgId !== 'string' || !orgId) {
    orgId = (await firestore.collection('hosts').doc(hostId).get()).get('orgId')
  }
  const resolved = typeof orgId === 'string' && orgId ? orgId : null
  cache.set(hostId, resolved)
  return resolved
}

/** One form, counted and — with `apply` — written, in one transaction. */
async function recount(firestore, formRef, orgId, apply) {
  const hostRef = formRef.parent.parent
  const submissions = hostRef.collection('formSubmissions').where('formId', '==', formRef.id)
  const leads = orgId
    ? firestore
        .collection('orgs')
        .doc(orgId)
        .collection('leads')
        .where('sources', 'array-contains', formLeadSource(formRef.id))
    : null
  return firestore.runTransaction(async (tx) => {
    const form = await tx.get(formRef)
    if (!form.exists) return null
    const [submissionCount, newest, leadCount] = await Promise.all([
      tx.get(submissions.count()),
      tx.get(submissions.orderBy('createdAt', 'desc').limit(1)),
      leads ? tx.get(leads.count()) : null,
    ])
    const recounted = formCountersFromSource({
      submissions: submissionCount.data().count,
      leads: leadCount ? leadCount.data().count : 0,
      newestSubmissionAtMs: millisOf(newest.docs[0]?.get('createdAt')),
      routesLeads: form.get('routing')?.lead === true,
    })
    const stats = form.get('stats') ?? {}
    const drift = formCounterDrift(stats, recounted)
    if (apply && drift.length) tx.update(formRef, formCounterPatch(recounted))
    return {
      stored: Object.fromEntries(FORM_COUNTER_FIELDS.map((field) => [field, stats[field]])),
      recounted,
      drift,
    }
  })
}

async function main() {
  const args = parseDeployArgs({
    command: COMMAND,
    summary:
      "Recount every form's submissions, leads and last submission from its rows, and report " +
      'the drift. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    ],
  })
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const firestore = connectFirestore({ repoRoot: join(here, '..', '..'), apply })
  const counts = { scanned: 0, agree: 0, drifted: 0, otherCollections: 0, gone: 0 }
  const byField = Object.fromEntries(FORM_COUNTER_FIELDS.map((field) => [field, 0]))
  const orgs = new Map()
  let cursor = null
  for (;;) {
    let page = firestore.collectionGroup('forms').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const segments = doc.ref.path.split('/')
      if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'forms') {
        counts.otherCollections += 1
        continue
      }
      counts.scanned += 1
      const orgId = await orgIdOf(firestore, segments[1], orgs)
      const result = await recount(firestore, doc.ref, orgId, apply)
      if (!result) {
        counts.gone += 1
        continue
      }
      if (!result.drift.length) {
        counts.agree += 1
        continue
      }
      counts.drifted += 1
      for (const field of result.drift) byField[field] += 1
      console.log(
        `  ${apply ? 'wrote' : 'would write'} ${doc.ref.path}: ` +
          result.drift
            .map((field) => `${field} ${JSON.stringify(result.stored[field] ?? null)} → ${JSON.stringify(result.recounted[field])}`)
            .join(', '),
      )
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  console.log(apply ? `${COMMAND}: APPLIED` : `${COMMAND}: DRY RUN (nothing written)`)
  console.log(`  forms scanned                         ${counts.scanned}`)
  console.log(`  already agree                         ${counts.agree}`)
  console.log(`  drifted${apply ? ' (written)' : ' (to write)'}                    ${counts.drifted}`)
  for (const field of FORM_COUNTER_FIELDS) {
    console.log(`    ${field.padEnd(34)}${byField[field]}`)
  }
  console.log(`  deleted mid-run                       ${counts.gone}`)
  console.log(`  not hosts/*/forms (left alone)        ${counts.otherCollections}`)
}

await main()
