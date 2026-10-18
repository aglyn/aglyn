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
