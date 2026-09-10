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
 * The canary check is absent, or honest — never green by default (AGL-2715).
 *
 * Three states, and the middle one is the whole point:
 *
 *  - **off** — the check is not in the body. The endpoint makes no claim
 *    about signup, because nothing is walking it.
 *  - **on, no marker** — RED. "Nothing has demonstrated a stranger can sign
 *    up" is exactly what this must not report as calm; that is the shape of
 *    AGL-2581, where the monitor named for signups stayed green through three
 *    days of every account being refused.
 *  - **on, fresh pass** — green.
 *
 * A fourth state is the one to guard against and the reason this file exists:
 * a well-meaning default that reports green when the canary is switched on
 * but has never run. That turns the only check on the platform that reports a
 * demonstration into one that reports an assumption.
 */

import { signupCanaryHealth } from '@aglyn/aglyn/server'
// From the PURE verdict module, not the probe: importing the probe drags
// `@aglyn/tenant-data-admin` and `next/cache` into a plain jest environment.
import { signupCanaryEnabled } from '../app/api/health/journeys/journeys-verdict'

const ENV_KEY = 'SIGNUP_CANARY_ENABLED'
const original = process.env[ENV_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
})

describe('the canary gate', () => {
  it('is OFF unless the flag is exactly "1"', () => {
    // Not truthiness: `SIGNUP_CANARY_ENABLED=0` and `=false` are the strings
    // an operator writes when they mean off, and both are truthy in JS.
    for (const value of ['0', 'false', 'no', '', 'true', 'yes', 'on']) {
      process.env[ENV_KEY] = value
      expect(signupCanaryEnabled()).toBe(false)
    }
    delete process.env[ENV_KEY]
    expect(signupCanaryEnabled()).toBe(false)
  })

  it('is ON for "1"', () => {
    process.env[ENV_KEY] = '1'
    expect(signupCanaryEnabled()).toBe(true)
  })
})

describe('what the check says once it is on', () => {
  it('reds when it is on and nothing has ever walked', () => {
    const check = signupCanaryHealth(null, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('canary-unavailable')
  })

  it('greens only on a fresh, successful, cleaned-up walk', () => {
    const now = Date.now()
    const check = signupCanaryHealth(
      {
        walkedAtMs: now - 60_000,
        ok: true,
        failedStep: null,
        elapsedMs: 4_200,
        reapedCleanly: true,
      },
      1,
      now,
    )
    expect(check.ok).toBe(true)
  })
})
