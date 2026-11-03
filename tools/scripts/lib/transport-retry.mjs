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
 * ONE MORE TRY FOR A REQUEST THAT NEVER LEFT THE RUNNER.
 *
 * The uptime probe runs on a GitHub-hosted runner, and that runner's own
 * network sometimes fails a request outright: a DNS miss (`ENOTFOUND`) or a
 * connect timeout (`UND_ERR_CONNECT_TIMEOUT`). On 2026-10-14 at 18:10Z one
 * run reported the tenant and a render probe DOWN that way, and the next run
 * fifteen minutes later found both healthy, so a red run and a Slack post
 * said a site was down that never was.
 *
 * So a request that THREW, which means no response came back at all, is
 * tried once more after a short pause. Two things are deliberately NOT
 * retried:
 *
 *  - Any response, whatever its status. A 503, a 429 or a redirect is what
 *    the site said, and it is graded as said.
 *  - A timeout. A page that takes longer than the budget is the render hang
 *    the probe exists to catch (2026-10-05), and a second wait would double
 *    the time to report it. Once the whole run is in, `retrySilentRows` asks
 *    a silent HEALTH door once more, and every silent row when the runner
 *    stalled. Its rule is below.
 */

/** The pause before the one retry. */
export const TRANSPORT_RETRY_DELAY_MS = 3_000

/** Whether an error thrown by `fetch` is the request timing out. */
export function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
}

/**
 * `fetch(url, { ...init, signal })` with a fresh `timeoutMs` budget per try,
 * tried once more when the first try threw for any reason but a timeout.
 * The second error, if there is one, is the one thrown.
 */
export async function fetchOnceMore(
  url,
  init,
  timeoutMs,
  { fetchImpl = fetch, delayMs = TRANSPORT_RETRY_DELAY_MS } = {},
) {
  const attempt = () =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  try {
    return await attempt()
  } catch (error) {
    if (isTimeout(error)) throw error
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return attempt()
  }
}

/**
 * A RUN WHERE EVERY ANSWER WAS SLOW IS THE RUNNER, NOT THE SITE (AGL-4137).
 *
 * On 2026-11-03 at 16:53Z every one of the 23 rows took 12.6 s or more,
 * cached front doors included. A cache HIT is answered at Vercel's edge
 * without reaching our code, so a 12.7 s HIT was a wait on the runner's own
 * network. Five rows crossed the 15 s budget and were posted as a failing
 * user journey while Google's uptime checks passed from every region. In the
 * 40 red runs before it, the fastest answer was never slower than 0.7 s.
 *
 * So when even the fastest answer in a run took `RUNNER_STALL_MS` or more,
 * or nothing answered at all, each row that got no response is probed once
 * more and graded on that try. A hung render still reads DOWN. On 2026-10-05
 * the cached pages and health routes answered at once while every uncached
 * render hung, so that run was not stalled and none of its renders is
 * retried. And a site that is really down fails the second try too.
 *
 * A HEALTH DOOR THAT TIMES OUT ALONE IS ASKED ONCE MORE, stall or not. Twice a
 * single door missed the budget while every other row answered fast:
 * `console/backups` on 2026-10-23 at 07:07Z and `console/auth-doors` on
 * 2026-11-02 at 16:37Z. Google's uptime checks passed that door from every
 * region on both sides of each one, and the next run was green. On 11/2 every
 * Google API the door calls answered within 0.52 s at p99 that minute, so the
 * time went on the instance, not on sign-in. In the 298 runs to 11/3,
 * `auth-doors` never otherwise took longer than 5.4 s. A health door
 * answers from inside a route handler, and a person never waits on it. If
 * the door is really shut, the second ask joins the same hung probe or meets
 * the same hung dependency, and the row stays DOWN. A page or render row is
 * never retried this way: its hang is the outage the probe exists to catch.
 */
export const RUNNER_STALL_MS = 5_000

/** A health row carries no `kind`; page and render rows say which they are. */
function isHealthRow(row) {
  return row.kind !== 'page' && row.kind !== 'render'
}

/**
 * `results` are the probe's rows; a row with `noResponse` got nothing back.
 * `reprobe(index)` probes the plan row at that index again. Returns the
 * graded rows and, when the runner stalled, `stall: { fastestMs }`
 * (`fastestMs` is null when nothing answered). `retried` counts the rows
 * asked again.
 */
export async function retrySilentRows(
  results,
  reprobe,
  { stallMs = RUNNER_STALL_MS } = {},
) {
  const answered = results.filter((r) => !r.noResponse)
  if (answered.length === results.length) return { results, stall: null, retried: 0 }
  const fastestMs = answered.length ? Math.min(...answered.map((r) => r.ms)) : null
  const stall = fastestMs === null || fastestMs >= stallMs ? { fastestMs } : null
  const owed = (row) => row.noResponse && (stall !== null || isHealthRow(row))

  const graded = await Promise.all(
    results.map(async (first, index) => {
      if (!owed(first)) return first
      const again = await reprobe(index)
      const why = stall ? 'the runner stalled' : 'a health door is asked once more'
      return {
        ...again,
        detail: `${again.detail} · tried again: ${why} (first try ${first.ms}ms, ${first.detail})`,
      }
    }),
  )
  return { results: graded, stall, retried: results.filter(owed).length }
}
