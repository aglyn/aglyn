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

// The AI jobs beat, driven on this machine (AGL-3596).
//
// In production Cloud Scheduler calls `POST /api/admin/ai-jobs-beat` once a
// minute with the cron secret (docs/AI_JOBS.md, "The beat"), and that call is
// what moves a job past whatever its create door ran inline. Nothing calls it
// on the emulator stack, so a local job sat queued forever. The pump is that
// caller: one beat at a time, the next `everyMs` after the last answered, and
// only while some job is due, so an idle stack sends nothing.
//
// One at a time rather than on a fixed clock: a beat can run for minutes, and
// the route's lease already lets overlapping beats share a job safely, but a
// dev server compiling and serving five overlapping sweeps is slower at each
// of them than at one.

/** The beat's console path; the console serves it from a named route. */
export const AI_JOBS_BEAT_ROUTE = '/api/admin/ai-jobs-beat'

/** The statuses the beat picks up (`listDueAiJobs` in libs/plugins/ai). */
export const AI_JOBS_DUE_STATUSES = ['queued', 'running', 'needs_input']

/**
 * How many AI jobs on the emulator the beat would look at, through an Admin
 * Firestore already pointed at the emulator.
 *
 * @param {import('firebase-admin/firestore').Firestore} firestore
 */
export async function countDueAiJobs(firestore) {
  const snapshot = await firestore
    .collectionGroup('aiJobs')
    .where('status', 'in', AI_JOBS_DUE_STATUSES)
    .limit(50)
    .get()
  return snapshot.size
}

/**
 * Starts the pump; resolves nothing and returns a handle with `stop()` (which
 * resolves once the beat in flight, if any, has answered) and `stats`.
 *
 * @param {object} options
 * @param {string} options.origin The console, e.g. http://localhost:4610.
 * @param {string} options.secret The CRON_SECRET that console verifies.
 * @param {number} [options.everyMs] The rest between one answer and the next call.
 * @param {() => Promise<number>} [options.due] How many jobs are due; no call while 0.
 *   Without it every tick calls.
 * @param {(line: string) => void} [options.log]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function startAiJobsBeatPump(options) {
  const {
    origin,
    secret,
    everyMs = 5_000,
    due = null,
    log = () => undefined,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options
  if (!origin) throw new Error('The beat pump needs the console origin.')
  if (!secret)
    throw new Error('The beat pump needs the CRON_SECRET the console verifies.')
  const url = new URL(AI_JOBS_BEAT_ROUTE, origin).toString()
  const stats = {
    beats: 0,
    idleTicks: 0,
    failures: 0,
    lastStatus: null,
    lastBody: null,
  }
  let running = true

  const loop = (async () => {
    while (running) {
      let count = 1
      if (due) {
        try {
          count = await due()
        } catch (error) {
          // An unreadable queue is a reason to beat, not to stop: the route
          // reads the queue itself and answers what it found.
          log(
            `beat pump: could not count due jobs (${error?.message ?? error}); beating anyway`,
          )
        }
      }
      if (count > 0) {
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'x-cron-secret': secret,
              'content-type': 'application/json',
            },
            body: '{}',
          })
          const body = await response.json().catch(() => null)
          stats.beats += 1
          stats.lastStatus = response.status
          stats.lastBody = body
          if (!response.ok) {
            stats.failures += 1
            log(
              `beat pump: ${response.status} ${JSON.stringify(body)?.slice(0, 200)}`,
            )
          } else {
            log(`beat pump: 200 ${JSON.stringify(body)?.slice(0, 200)}`)
          }
        } catch (error) {
          stats.failures += 1
          log(`beat pump: request failed (${error?.message ?? error})`)
        }
      } else {
        stats.idleTicks += 1
      }
      if (running) await sleep(everyMs)
    }
  })()

  return {
    stats,
    async stop() {
      running = false
      await loop
    },
  }
}
