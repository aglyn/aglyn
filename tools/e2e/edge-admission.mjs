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
 * IS THE EDGE STILL LETTING REAL VISITORS IN? (AGL-2720)
 *
 * Every synthetic here carries the `x-aglyn-probe` bypass, because bot
 * protection refuses a datacenter IP outright. So if the edge began
 * challenging real people, every check would ride past the broken thing and
 * stay green. This is what closes that, and what it closes it with was chosen
 * by elimination:
 *
 * - Vercel publishes no challenged-versus-allowed metric. Seven endpoints
 *   probed 2026-09-10; the only one that answers returns rule ACTIONS, not
 *   traffic, and is empty over every window.
 * - A probe cannot substitute. The discriminator is not "was this request
 *   challenged" but "can a REAL BROWSER get in" — `curl` from a residential
 *   address is challenged too, and that is the HEALTHY state, because the
 *   challenge is answerable and a non-JS client cannot answer it. Verified
 *   both ways the same day: `curl` got 429 from a home connection while a
 *   real browser on the same connection rendered the signup form.
 *
 * What is left is the outcome, and it was already being counted for money.
 * Metered page views are written by real browsers on real customer sites
 * AFTER the edge admitted them, and nothing synthetic touches that number:
 * the probes ride the bypass and the signup canary walks the console, neither
 * of which is a metered tenant page view. Measured over the preceding week:
 * 563, 165, 139, 87, 87, 57, 66, 89, 110 a day.
 *
 * So this asks one question — is that number still moving? — and stamps the
 * moment it last did. `edgeAdmissionHealth` grades how long ago that was.
 *
 *   node tools/e2e/edge-admission.mjs
 *
 * Reads only, apart from its own marker. It creates nothing and touches no
 * customer data.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readServiceAccount } = await import(
  '../scripts/lib/firebase-rules-api.mjs'
)
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

/**
 * The shortest gap between two samples.
 *
 * The workflow asks every ten minutes to survive GitHub dropping most
 * scheduled runs (AGL-2723); that is a request rate, not a work rate. The
 * quantity here moves on the scale of hours, so sampling it more often than
 * this buys nothing and spends a read per host each time.
 */
const MIN_SAMPLE_INTERVAL_MS = 45 * 60 * 1000

/**
 * Ceiling on the host scan.
 *
 * The same bound `report-usage` puts on the same collection. A sampler that
 * walked an unbounded collection would get slower and more expensive as the
 * platform grew, quietly, until it timed out.
 */
const HOST_SCAN_LIMIT = 1000

/** UTC, because the analytics documents are keyed that way. */
function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

async function main() {
  const sa = readServiceAccount()
  if (!sa) throw new Error('admin credentials are not in the environment')

  const app = initializeApp({ credential: cert(sa) }, `edge-${Date.now()}`)
  const db = getFirestore(app)
  const doc = db.collection('rateLimits').doc('edgeAdmission_production')

  // Fails OPEN, like the canary's floor: a marker that cannot be read samples
  // rather than skips, so a throttle can never be why this check goes quiet.
  let prior
  try {
    prior = (await doc.get()).data() ?? null
    const ageMs =
      typeof prior?.sampledAtMs === 'number' ? Date.now() - prior.sampledAtMs : null
    if (ageMs !== null && ageMs < MIN_SAMPLE_INTERVAL_MS) {
      console.log(
        `fresh — sampled ${Math.round(ageMs / 60_000)}min ago, under the ` +
          `${MIN_SAMPLE_INTERVAL_MS / 60_000}min floor; not sampling`,
      )
      process.exit(0)
    }
  } catch (error) {
    console.log(`could not read the prior marker, sampling: ${String(error).slice(0, 120)}`)
    prior = null
  }

  const nowMs = Date.now()
  const day = utcDay(nowMs)
  const hosts = await db.collection('hosts').limit(HOST_SCAN_LIMIT).get()
  let total = 0
  let counted = 0
  for (const host of hosts.docs) {
    const snap = await host.ref.collection('analytics').doc(day).get()
    if (!snap.exists) continue
    const n = Number(snap.get('total') ?? 0)
    if (Number.isFinite(n) && n > 0) {
      total += n
      counted += 1
    }
  }

  /**
   * When did the number last GROW?
   *
   * Decided here rather than in the grader, because a single reading cannot
   * be told apart from midnight: the counter is per UTC day and starts each
   * one at zero. A day change is therefore treated as motion — it is a new
   * counter, not a stalled one — and the first views of the new day move it
   * again shortly after.
   */
  let advancedAtMs = typeof prior?.advancedAtMs === 'number' ? prior.advancedAtMs : nowMs
  let why = 'unchanged'
  if (prior?.day !== day) {
    advancedAtMs = nowMs
    why = 'new UTC day'
  } else if (total > Number(prior?.total ?? -1)) {
    advancedAtMs = nowMs
    why = `grew ${prior?.total ?? 0} -> ${total}`
  }

  await doc.set({
    sampledAtMs: nowMs,
    advancedAtMs,
    day,
    total,
    expiresAt: new Date(nowMs + 30 * 24 * 60 * 60 * 1000),
  })

  const quietMin = Math.round((nowMs - advancedAtMs) / 60_000)
  console.log(
    `${day}: ${total} metered views across ${counted} of ${hosts.size} hosts ` +
      `(${why}); quiet ${quietMin}min`,
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(`edge admission sample failed: ${String(error).slice(0, 300)}`)
  process.exit(1)
})
