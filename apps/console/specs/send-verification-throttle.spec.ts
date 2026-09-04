/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, the trap every other spec in this directory carries a
 * note about.
 *
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Identity Platform's throttle must read as a throttle (AGL-2584).
 *
 * `/verify-email` mints a link on EVERY mount, so reopening the tab sends
 * again. Identity Platform throttles that ahead of the route's own per-uid
 * budget and reports it as a 400 `auth/internal-error` whose body carries
 * `TOO_MANY_ATTEMPTS_TRY_LATER`. That landed in the catch-all and returned
 * 500 `Sending the email failed` — which is wrong twice: the previous mail
 * HAD been sent, and the remedy is to wait, not to retry.
 *
 * Asserted over the source rather than by invoking the handler: the route
 * pulls in firebase-admin, the email renderer and the cost meter, and the
 * property under test is which STATUS a recognised throttle maps to. The
 * client already branches on 429 with the right sentence, so the status is
 * the whole contract between them.
 */
const SOURCE = readFileSync(
  join(__dirname, '..', 'app', 'api', 'auth', 'send-verification', 'route.ts'),
  'utf8',
)

describe('the Identity Platform throttle is reported as a throttle', () => {
  it('recognises TOO_MANY_ATTEMPTS_TRY_LATER', () => {
    expect(SOURCE).toContain('TOO_MANY_ATTEMPTS_TRY_LATER')
  })

  it('maps it to 429, not 500', () => {
    const branch = /isTooManyAttempts\(error\)\)\s*\{[\s\S]*?status:\s*(\d+)/.exec(
      SOURCE,
    )
    expect(branch).not.toBeNull()
    expect(branch?.[1]).toBe('429')
  })

  it('does not call it a send failure — the mail had already been sent', () => {
    // Bounded explicitly at the catch-all below it, so the assertion cannot
    // drift into the 500 branch and pass by reading the wrong sentence.
    const start = SOURCE.indexOf('if (isTooManyAttempts(error))')
    const end = SOURCE.indexOf("error: 'Sending the email failed'", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const branch = SOURCE.slice(start, end)
    expect(branch).not.toContain('Sending the email failed')
    expect(branch).toMatch(/wait a moment/i)
  })

  it('keeps 500 for every OTHER failure', () => {
    // The catch-all must survive: a genuinely broken sender is not a throttle
    // and must not be reported as one.
    expect(SOURCE).toContain(
      "return Response.json({ error: 'Sending the email failed' }, { status: 500 })",
    )
  })

  it('matches on the upstream body, not the shared code alone', () => {
    // `auth/internal-error` is the code for every internal failure, so
    // matching it alone would relabel unrelated breakage as a throttle.
    const fn = /function isTooManyAttempts[\s\S]*?\n\}/.exec(SOURCE)?.[0] ?? ''
    expect(fn).toContain('auth/internal-error')
    expect(fn).toContain('TOO_MANY_ATTEMPTS_TRY_LATER')
  })
})
