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

// READ-ONLY audit: is the live Stripe webhook actually delivering AND being
// processed? (AGL-1906, launch-checklist §2 BLOCKER, runbook step 2.4.)
//
// Issues GET requests only — it writes NOTHING, to Stripe or to Firestore.
// The live secret key is the expected input, so the no-write property has to
// hold by construction, not by care: there is exactly one HTTP helper in this
// file and it hard-codes `method: 'GET'`.
//
//   STRIPE_SECRET_KEY=sk_… \
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-stripe-webhook-health.mjs [--days 30] [--json]
//
// Or, with the repo's own env files:
//
//   npm run audit:stripe-webhook
//
// WHY THIS EXISTS
//
// On 2026-08-14 the checklist item "Stripe webhooks point at production and
// signature verification is live" was ticked on this evidence: 14 events in
// `stripeEvents`, newest five from a real live checkout, nothing newer because
// no Stripe activity had happened since. Every fact was true and the
// conclusion was wrong — hours later AGL-1551 read the destination itself and
// found HTTP 400 `Invalid signature` on 100% of deliveries for the preceding
// week, behind a green "Active" badge.
//
// The tick failed because `stripeEvents` alone cannot answer the question.
// `route.ts` returns 400 BEFORE claiming the idempotency document, so a
// rejected delivery writes nothing, and an empty collection is indistinguishable
// from a totally broken endpoint. The missing half is Stripe's own list of what
// it TRIED to deliver. This script joins the two: Stripe supplies the
// denominator, Firestore supplies the numerator, and the gap between them is
// the failure that used to be invisible.
//
// WHAT IT ASSERTS
//
//   endpoint.*            one live destination, enabled, at the production URL,
//                         carrying every event in WEBHOOK_EVENTS
//   delivery.evidence     the window contains at least one real delivery — a
//                         0% error rate over an empty window is not evidence
//   delivery.failures     Stripe reports no failed delivery in the window
//   processing.coverage   every deliverable event has a `stripeEvents` document,
//                         i.e. the signature verified and the handler ran
//
// A NOTE ON `delivery_success`, because it reads stronger than it is: the
// filter is ACCOUNT-WIDE, not per destination, and an event of an unsubscribed
// type is delivered nowhere and so trivially "successful". That is why
// `endpoint.count` insists on exactly one live destination (otherwise the
// signal cannot be attributed) and why the denominator is restricted to
// subscribed types. `processing.coverage` is the arm that does not depend on
// Stripe's self-report at all, and it is the one that would have caught
// AGL-1551.
//
// Exits non-zero unless every check is `pass`, so it can gate a release or run
// scheduled. `unknown` is not a pass.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  EVENT_RETENTION_DAYS,
  PLATFORM_WEBHOOK_URL,
  assessWebhookHealth,
  resolveWindow,
} from './lib/stripe-webhook-health.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const skipFirestore = args.includes('--no-firestore')

const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback
}

/**
 * Fill in whatever the shell did not already export, so the audit is one
 * command rather than a paragraph of env plumbing — the difference between a
 * check anyone re-runs and a claim in a document, which is the failure mode
 * AGL-1906 is about.
 *
 * `override: false` throughout: an explicitly exported var always wins, so
 * pointing the audit at a different account stays a matter of exporting a key.
 * The production file is the DEFAULT because the assertion is about the LIVE
 * destination — and reading it is safe here for the same reason the file says
 * up top: this script has one HTTP helper and it is GET-only.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const envFilesLoaded = []
for (const relative of ['.env', 'apps/console/.env.production.local']) {
  const path = resolve(repoRoot, relative)
  if (!existsSync(path)) continue
  dotenv.config({ path, override: false, quiet: true })
  envFilesLoaded.push(relative)
}

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) {
  console.error('Missing STRIPE_SECRET_KEY')
  process.exit(1)
}
const keyMode = secretKey.startsWith('sk_live_') ? 'live' : 'test'

const endpointUrl = flag('--url', PLATFORM_WEBHOOK_URL)

/**
 * The window.
 *
 * `--since` / `--until` take ISO timestamps and exist so the audit can be
 * pointed at a window that is KNOWN to be bad — the week of 2026-08-07 to
 * 2026-08-13, say — and watched to go red. A check nobody has ever seen fail
 * is the thing AGL-1906 is about, and this is how you see this one fail
 * against real data rather than a fixture.
 */
const seconds = (iso) => Math.floor(new Date(iso).getTime() / 1000)
const days = Number(flag('--days', '30'))
const until = args.includes('--until')
  ? seconds(flag('--until'))
  : Math.floor(Date.now() / 1000)
const since = args.includes('--since')
  ? seconds(flag('--since'))
  : until - Math.round(days * 86_400)
if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) {
  console.error('Invalid window: --since must parse and precede --until')
  process.exit(1)
}

/** GET only. There is no write path in this file, by construction. */
async function get(path, params = {}) {
  const query = new URLSearchParams({ limit: '100', ...params })
  const response = await fetch(`https://api.stripe.com/v1/${path}?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Stripe GET ${path} failed`)
  }
  return body
}

async function collect(path, params = {}) {
  const items = []
  let startingAfter = null
  for (;;) {
    const page = await get(path, {
      ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    items.push(...page.data)
    if (!page.has_more || !page.data.length) return items
    startingAfter = page.data[page.data.length - 1].id
  }
}

const iso = (unix) => new Date(unix * 1000).toISOString()

async function main() {
  const endpoints = await collect('webhook_endpoints')

  // Narrow the window to what is actually backed by data before reporting it.
  // Two independent floors: the destination's creation (an older event was
  // never attempted against it) and Stripe's 30-day event retention (an older
  // event is simply absent, silently). Printing a window wider than its data
  // is the same defect this audit exists to catch, one level up.
  const created = Math.min(
    ...endpoints.map((e) => e.created ?? Number.MAX_SAFE_INTEGER),
  )
  const { start: windowStart, clamps } = resolveWindow({
    requestedStart: since,
    end: until,
    endpointCreated: Number.isFinite(created) ? created : null,
    now: Math.floor(Date.now() / 1000),
  })

  const window = { 'created[gte]': String(windowStart), 'created[lte]': String(until) }
  const events = await collect('events', window)
  const failures = await collect('events', { ...window, delivery_success: 'false' })

  let processedEventIds = []
  let firestoreChecked = false
  let firestoreError = null
  if (!skipFirestore) {
    const projectId = process.env.FIREBASE_PROJECT_ID
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!projectId || !clientEmail || !privateKey) {
      firestoreError =
        'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY'
    } else {
      try {
        if (!getApps().length) {
          initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
        }
        const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
        // Read by id rather than listing the collection: the ids are already
        // known from Stripe, the collection has no `receivedAt` index, and a
        // getAll is one round trip per 300 ids instead of a full scan.
        const ids = events.map((event) => event.id)
        for (let i = 0; i < ids.length; i += 300) {
          const refs = ids
            .slice(i, i + 300)
            .map((id) => firestore.collection('stripeEvents').doc(id))
          if (!refs.length) continue
          const snapshots = await firestore.getAll(...refs)
          for (const snapshot of snapshots) {
            if (snapshot.exists) processedEventIds.push(snapshot.id)
          }
        }
        firestoreChecked = true
      } catch (error) {
        firestoreError = error?.message ?? String(error)
      }
    }
  } else {
    firestoreError = '--no-firestore'
  }

  const result = assessWebhookHealth({
    endpoints,
    endpointUrl,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      created: event.created,
    })),
    failedEventIds: failures.map((event) => event.id),
    processedEventIds,
    firestoreChecked,
    expectLivemode: keyMode === 'live',
    windowStart,
    windowEnd: until,
  })

  const report = {
    ok: result.ok,
    window: {
      requestedFrom: iso(since),
      from: iso(windowStart),
      to: iso(until),
      clampedBy: clamps,
      stripeEventRetentionDays: EVENT_RETENTION_DAYS,
    },
    stripeKeyMode: keyMode,
    envFilesLoaded,
    endpointUrl,
    firestore: firestoreChecked ? 'checked' : `skipped: ${firestoreError}`,
    ...result,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return result.ok
  }

  console.log(
    `Stripe webhook health (${keyMode} key) — ${iso(windowStart)} → ${iso(until)}`,
  )
  for (const clamp of clamps) {
    console.log(
      clamp === 'stripe-event-retention'
        ? `  (window start clamped: Stripe retains only ${EVENT_RETENTION_DAYS} days of events — asked for ${iso(since)})`
        : `  (window start clamped to the destination creation date — asked for ${iso(since)})`,
    )
  }
  console.log('')
  const icon = { pass: '✓', fail: '✗', unknown: '?' }
  for (const finding of result.findings) {
    console.log(`  ${icon[finding.level]} ${finding.check.padEnd(21)} ${finding.message}`)
    if (finding.detail !== undefined) {
      console.log(`      ${JSON.stringify(finding.detail)}`)
    }
  }
  const { summary } = result
  console.log('')
  console.log(
    `  events in window: ${summary.totalEvents}   deliverable (subscribed types): ${summary.deliverableEvents}`,
  )
  console.log(
    `  failed deliveries: ${summary.failedDeliveries}   error rate: ${
      summary.errorRate === null ? 'n/a (no deliveries)' : `${(summary.errorRate * 100).toFixed(2)}%`
    }`,
  )
  console.log(
    `  unprocessed (no stripeEvents doc): ${
      summary.unprocessedEvents === null ? 'UNVERIFIED' : summary.unprocessedEvents
    }`,
  )
  if (Object.keys(summary.byType).length) {
    console.log('')
    console.log('  per event type — attempts / failures / no-doc:')
    for (const [type, row] of Object.entries(summary.byType)) {
      console.log(
        `    ${type.padEnd(34)} ${row.attempted} / ${row.failed} / ${row.unprocessed}`,
      )
    }
  }
  console.log('')
  console.log(result.ok ? '  VERDICT: healthy' : '  VERDICT: NOT PROVEN — see failures above')
  return result.ok
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
