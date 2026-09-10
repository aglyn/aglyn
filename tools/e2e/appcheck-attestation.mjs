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
 * IS APP CHECK ADMITTING REAL PEOPLE? (AGL-2715)
 *
 * The signup canary walks the whole journey but attests with a debug token,
 * because this project's App Check provider is reCAPTCHA Enterprise and it is
 * built to score headless automation as a bot. That leaves it blind to the one
 * failure it sits closest to: attestation refusing the visitors it should
 * admit.
 *
 * This is what covers that, and it covers it by measurement rather than by
 * argument. Firebase publishes `services/verification_count` to Cloud
 * Monitoring — every request from every visitor, labelled ALLOW or DENY. A
 * debug token cannot hold it green: the canary contributes at most one an hour
 * against roughly a thousand a day, in the same ALLOW bucket as everybody
 * else. If attestation collapses for real people, the rate collapses.
 *
 * It samples; `appCheckAttestationHealth` decides. The rate is not read on the
 * health path because a public endpoint has no business calling Monitoring —
 * a second credential, a slow call, and a quota anyone with `curl` could
 * spend.
 *
 * Deliberately independent of the canary. This is the cover for the canary's
 * blind spot, so it must not be able to go dark just because the canary did.
 *
 *   node tools/e2e/appcheck-attestation.mjs
 *
 * Reads only. It creates nothing, deletes nothing, and touches no customer
 * data — the one document it writes is its own reading.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readServiceAccount, getServiceAccountToken } = await import(
  '../scripts/lib/firebase-rules-api.mjs'
)
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

/**
 * The window sampled.
 *
 * Six hours, matching `APP_CHECK_WINDOW_MINUTES`. Google aggregates this
 * metric on its own schedule and it arrives late, so a one-hour window reads
 * empty for reasons that have nothing to do with attestation.
 */
const WINDOW_HOURS = 6

const METRIC = 'firebaseappcheck.googleapis.com/services/verification_count'

/**
 * The shortest gap between two samples.
 *
 * The workflow's schedule asks every ten minutes to survive GitHub dropping
 * most scheduled runs (AGL-2723), which is a request rate rather than a work
 * rate. Re-reading a six-hour aggregate every ten minutes would return very
 * nearly the same numbers while spending Monitoring quota to do it, so a
 * delivered run inside this floor exits without sampling.
 */
const MIN_SAMPLE_INTERVAL_MS = 45 * 60 * 1000

async function main() {
  const sa = readServiceAccount()
  if (!sa) throw new Error('admin credentials are not in the environment')

  const app = initializeApp({ credential: cert(sa) }, `attest-${Date.now()}`)
  const db = getFirestore(app)
  // Fails OPEN, like the walk's floor: a marker that cannot be read samples
  // rather than skips, so a throttle can never be what starves this check.
  try {
    const prior = (
      await db
        .collection('rateLimits')
        .doc('appCheckAttestation_production')
        .get()
    ).data()
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
    console.log(`could not read the prior sample, sampling: ${String(error).slice(0, 120)}`)
  }

  // `monitoring.read` rather than the default scope. Measured 2026-09-09: the
  // Firebase service account CAN read `timeSeries` — which corrects a standing
  // belief that it cannot reach Monitoring at all. That belief was true of
  // `alertPolicies`, and only of those.
  const token = await getServiceAccountToken({
    ...sa,
    scopes: ['https://www.googleapis.com/auth/monitoring.read'],
  })

  const end = new Date()
  const start = new Date(end.getTime() - WINDOW_HOURS * 3600_000)
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z')
  const query = new URLSearchParams({
    filter: `metric.type="${METRIC}"`,
    'interval.startTime': iso(start),
    'interval.endTime': iso(end),
    // One bucket over the whole window: the verdict wants totals, not a shape.
    'aggregation.alignmentPeriod': `${WINDOW_HOURS * 3600}s`,
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
  })

  const res = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${sa.projectId}/timeSeries?${query}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!res.ok) {
    throw new Error(`timeSeries answered ${res.status}`)
  }
  const body = await res.json()

  /**
   * Flattened to what the verdict grades, and nothing else.
   *
   * Counts, a result, a security reason and a service name — no principal, no
   * origin, no app id. The health body that reads this is public, and the
   * question is a rate, not an audience.
   */
  const samples = []
  for (const series of body.timeSeries ?? []) {
    const labels = series.metric?.labels ?? {}
    const count = (series.points ?? []).reduce(
      (sum, point) => sum + Number(point.value?.int64Value ?? 0),
      0,
    )
    if (!count) continue
    samples.push({
      result: labels.result,
      security: labels.security,
      service: series.resource?.labels?.service_id ?? labels.service_id,
      count,
    })
  }

  await db
    .collection('rateLimits')
    .doc('appCheckAttestation_production')
    .set({
      sampledAtMs: Date.now(),
      samples,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

  for (const s of samples) {
    console.log(
      `  ${String(s.service).padEnd(34)} ${String(s.result).padEnd(6)} ${String(
        s.security,
      ).padEnd(24)} ${s.count}`,
    )
  }
  console.log(`\nsampled ${samples.length} series over ${WINDOW_HOURS}h`)
  process.exit(0)
}

main().catch((error) => {
  console.error(`attestation sample failed: ${String(error).slice(0, 300)}`)
  process.exit(1)
})
