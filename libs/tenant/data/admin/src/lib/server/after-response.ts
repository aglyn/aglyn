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

/*==========================================
 * WORK RUN AFTER THE RESPONSE: NEXT'S `after()`, LOADED LAZILY.
 *
 * A serverless invocation is frozen the moment its response is sent, and
 * work scheduled any other way does not run (AGL-2327). `after()` is the
 * one way to keep it.
 *
 * ## Loaded, not imported
 *
 * `next/server` evaluates web `Request` classes at load, which a jsdom spec
 * reaching one of this package's writers cannot, and the modules that
 * schedule work ride every writer's import. So it is loaded the first time
 * work is scheduled.
 *
 * ## Through `import()`, never `require()`
 *
 * This package is an ES module. Next 16's Turbopack build compiled the
 * `const loaded = require('next/server')` both callers once used into a
 * hoisted `.after` read and left the body naming `loaded`, a binding that
 * no longer existed: every call threw `ReferenceError: loaded is not
 * defined`, the `catch` around it answered "no request", and neither the
 * media CDN's regeneration (AGL-3486) nor the deliverability check at
 * capture (AGL-3328) ever ran in production. A spec cannot see this:
 * `jest.mock('next/server')` answers `require` and `import()` alike.
 * `after-response.spec.ts` holds the package to `import()`.
 *
 * ## Every drop is said once
 *
 * A task that could not be scheduled is work that silently did not
 * happen. The first time each caller's task is dropped for a given reason
 * it is logged; after that the same reason stays quiet, so a script
 * writing five hundred rows outside a request says it once, not five
 * hundred times. A task that runs and fails is logged every time.
 *==========================================*/

/** Next's `after()`, as the callers use it. */
export type AfterResponse = (task: () => Promise<void>) => void

let afterResponseLoad: Promise<AfterResponse | null> | null = null

const logged = new Set<string>()

function logOnce(label: string, reason: string, message: string, error?: unknown): void {
  const key = `${label}|${reason}`
  if (logged.has(key)) return
  logged.add(key)
  if (error === undefined) console.error(`${label} ${message}`)
  else console.error(`${label} ${message}`, error)
}

/**
 * Next's `after()`, loaded the first time it is asked for; `null` where
 * `next/server` cannot be loaded or has no `after`. One load per process.
 */
export function loadAfterResponse(label = '[after-response]'): Promise<AfterResponse | null> {
  afterResponseLoad ??= import('next/server').then(
    (loaded) =>
      typeof (loaded as { after?: unknown }).after === 'function'
        ? (loaded as { after: AfterResponse }).after
        : null,
    (error: unknown) => {
      logOnce(label, 'load', 'next/server could not be loaded', error)
      return null
    },
  )
  return afterResponseLoad
}

/**
 * Runs `task` once the response has been sent, through Next's `after()`.
 * Resolves `false` where there is no request to run after — a script, a
 * spec — and the task is then not run at all. Never rejects. `label`
 * prefixes what is logged, the caller's own (`[media-cdn]`).
 */
export async function scheduleAfterResponse(task: () => Promise<void>, label: string): Promise<boolean> {
  const after = await loadAfterResponse(label)
  if (!after) {
    logOnce(label, 'unavailable', 'after() is unavailable; the task was not scheduled')
    return false
  }
  try {
    after(() =>
      task().catch((error: unknown) => {
        console.error(`${label} after-response task failed`, error)
      }),
    )
    return true
  } catch (error) {
    logOnce(label, 'refused', 'after() refused the task; it was not scheduled', error)
    return false
  }
}

/** Test seam: forget the loaded `after()` and what was logged. */
export function resetAfterResponseForTests(): void {
  afterResponseLoad = null
  logged.clear()
}
