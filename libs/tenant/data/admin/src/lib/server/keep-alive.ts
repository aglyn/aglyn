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
 * Keeps fire-and-forget work alive after the response is sent.
 *
 * A serverless function may be frozen the moment its handler returns, and a
 * notification is usually started with `void notify…()` beside the mutation
 * it reports. The feed write lands first, so the console shows it, while the
 * push and the email after it are cut off part way: the native apps then miss
 * notifications the browser shows. Handing the promise to the platform's
 * `waitUntil` keeps the invocation alive until it settles.
 *
 * Next reads `waitUntil` from the `@next/request-context` slot, and Vercel's
 * own helpers read `@vercel/request-context`; both are asked. Outside a
 * request (a script, a test, a cron worker that awaits anyway) there is no
 * context and the work simply runs as it would have.
 */

type WaitUntil = (promise: Promise<unknown>) => void

interface RequestContextSlot {
  get?: () => { waitUntil?: WaitUntil } | undefined
}

const CONTEXT_SLOTS = [Symbol.for('@next/request-context'), Symbol.for('@vercel/request-context')]

function platformWaitUntil(): WaitUntil | undefined {
  const scope = globalThis as unknown as Record<symbol, RequestContextSlot | undefined>
  for (const slot of CONTEXT_SLOTS) {
    try {
      const waitUntil = scope[slot]?.get?.()?.waitUntil
      if (typeof waitUntil === 'function') return waitUntil
    } catch {
      // A slot that cannot answer is treated as absent.
    }
  }
  return undefined
}

/** Returns `work` unchanged, after asking the platform to wait for it. */
export function keepAlive<T>(work: Promise<T>): Promise<T> {
  const waitUntil = platformWaitUntil()
  if (waitUntil) {
    try {
      waitUntil(work.catch(() => undefined))
    } catch {
      // The platform refused the promise: the work still runs.
    }
  }
  return work
}
