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
 * Which builds may talk to Google Analytics (AGL-2067).
 *
 * Four environments, and each one is a different mistake:
 *
 * - **localhost.** The console pointed `next dev` at the PRODUCTION
 *   measurement id and booted Analytics unconditionally, so every session
 *   spent building produced real hits in the live property.
 * - **A Vercel preview.** `NODE_ENV` is `production` in a preview build — it
 *   is a production build of a non-production deployment — so `NODE_ENV`
 *   alone cannot see it, and the archived Marketing property's whole
 *   year-to-date history is mostly preview `/signin` views because nothing
 *   did.
 * - **A self-hosted deployment.** Points at the operator's own Firebase
 *   project and their own GA property. Silencing it to protect ours would
 *   break a customer's analytics, so an unknown deployment must EMIT.
 * - **A production build with the escape hatch set.** The nastiest of the
 *   four, and the reason `analyticsEnvironmentForcesInternal` is a separate
 *   predicate rather than "not production": if the hatch could force the
 *   internal stamp in production it would blanket-flag every paying
 *   customer, and an Active GA4 filter would discard them irrecoverably.
 *
 * Planted reds, verified: drop the `deployEnv` check from
 * `isProductionSurface` → the preview cases; make
 * `analyticsEnvironmentForcesInternal` return `allowsNonProduction(env)` →
 * the production-with-hatch case; make `allowsNonProduction` a bare truthiness
 * test → the `'0'` / `'false'` cases.
 */

import {
  ANALYTICS_ALLOW_NONPROD_ENV,
  analyticsEnvironmentForcesInternal,
  analyticsMayEmit,
  readAnalyticsEnvironment,
} from './analytics-environment'

describe('analyticsMayEmit (AGL-2067)', () => {
  it('emits from a real production deployment', () => {
    expect(
      analyticsMayEmit({ nodeEnv: 'production', deployEnv: 'production' }),
    ).toBe(true)
  })

  it('emits from an UNKNOWN production deployment — the self-host default', () => {
    // Docker + bring-your-own-Firebase sets no VERCEL_ENV. Their property is
    // theirs; refusing to report into it would be our leak fixed at their
    // expense.
    expect(analyticsMayEmit({ nodeEnv: 'production' })).toBe(true)
    expect(analyticsMayEmit({ nodeEnv: 'production', deployEnv: '' })).toBe(true)
  })

  it('stays silent on localhost', () => {
    expect(analyticsMayEmit({ nodeEnv: 'development' })).toBe(false)
    expect(analyticsMayEmit({ nodeEnv: 'test' })).toBe(false)
  })

  it('stays silent on a Vercel PREVIEW, whose NODE_ENV is production', () => {
    // The case nothing else catches, and the one already visible in the data.
    expect(
      analyticsMayEmit({ nodeEnv: 'production', deployEnv: 'preview' }),
    ).toBe(false)
    expect(
      analyticsMayEmit({ nodeEnv: 'production', deployEnv: 'PREVIEW' }),
    ).toBe(false)
    expect(
      analyticsMayEmit({ nodeEnv: 'production', deployEnv: 'development' }),
    ).toBe(false)
  })

  it('re-enables a silenced build through the escape hatch', () => {
    expect(
      analyticsMayEmit({ nodeEnv: 'development', allowNonProduction: '1' }),
    ).toBe(true)
    expect(
      analyticsMayEmit({
        nodeEnv: 'production',
        deployEnv: 'preview',
        allowNonProduction: 'true',
      }),
    ).toBe(true)
  })

  it.each(['', '0', 'false', 'off', '  '])(
    'treats an escape hatch of %p as unset',
    (value) => {
      expect(
        analyticsMayEmit({ nodeEnv: 'development', allowNonProduction: value }),
      ).toBe(false)
    },
  )
})

describe('analyticsEnvironmentForcesInternal (AGL-2067)', () => {
  it('forces the stamp on a non-production build that was deliberately re-enabled', () => {
    // The hatch's other half: such a build emits only because one of us asked
    // it to, so every hit from it is ours by construction.
    expect(
      analyticsEnvironmentForcesInternal({
        nodeEnv: 'development',
        allowNonProduction: '1',
      }),
    ).toBe(true)
    expect(
      analyticsEnvironmentForcesInternal({
        nodeEnv: 'production',
        deployEnv: 'preview',
        allowNonProduction: '1',
      }),
    ).toBe(true)
  })

  it('NEVER forces it in production, even with the hatch set', () => {
    // The expensive direction, and the whole reason this is a second
    // predicate: a production build that blanket-stamped `internal` would
    // delete every paying customer from every report the moment the GA4
    // filter goes Active, and that data is not recoverable.
    expect(
      analyticsEnvironmentForcesInternal({
        nodeEnv: 'production',
        deployEnv: 'production',
        allowNonProduction: '1',
      }),
    ).toBe(false)
    // Including the self-host shape, which is the one most likely to be
    // running with an unfamiliar env file.
    expect(
      analyticsEnvironmentForcesInternal({
        nodeEnv: 'production',
        allowNonProduction: 'true',
      }),
    ).toBe(false)
  })

  it('forces nothing when the build is silent anyway', () => {
    expect(analyticsEnvironmentForcesInternal({ nodeEnv: 'development' })).toBe(
      false,
    )
  })
})

describe('readAnalyticsEnvironment', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('reads process.env at CALL time, not at module load', () => {
    // A module constant could only ever be observed in one state, which is
    // the shape of a check that cannot fail — and it would also make every
    // gate in this repo untestable.
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'preview'
    process.env[ANALYTICS_ALLOW_NONPROD_ENV] = '1'
    expect(readAnalyticsEnvironment()).toMatchObject({
      deployEnv: 'preview',
      allowNonProduction: '1',
    })
    delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    expect(readAnalyticsEnvironment().deployEnv).toBeUndefined()
  })
})
