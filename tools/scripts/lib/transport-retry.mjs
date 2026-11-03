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
 *    the time to report it.
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
 * render hung, so that run was not stalled and nothing in it is retried. And
 * a site that is really down fails the second try too.
 */
export const RUNNER_STALL_MS = 5_000

/**
 * `results` are the probe's rows; a row with `noResponse` got nothing back.
 * `reprobe(index)` probes the plan row at that index again. Returns the
 * graded rows and, when the runner stalled, `stall: { fastestMs, retried }`
 * (`fastestMs` is null when nothing answered).
 */
export async function retryAfterRunnerStall(
  results,
  reprobe,
  { stallMs = RUNNER_STALL_MS } = {},
) {
  const answered = results.filter((r) => !r.noResponse)
  if (answered.length === results.length) return { results, stall: null }
  const fastestMs = answered.length ? Math.min(...answered.map((r) => r.ms)) : null
  if (fastestMs !== null && fastestMs < stallMs) return { results, stall: null }

  const graded = await Promise.all(
    results.map(async (first, index) => {
      if (!first.noResponse) return first
      const again = await reprobe(index)
      return {
        ...again,
        detail: `${again.detail} · tried again: the runner stalled (first try ${first.ms}ms, ${first.detail})`,
      }
    }),
  )
  return {
    results: graded,
    stall: { fastestMs, retried: results.length - answered.length },
  }
}
