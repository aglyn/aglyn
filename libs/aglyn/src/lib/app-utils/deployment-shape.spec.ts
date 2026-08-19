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
 * The two deployment predicates, and why they are not interchangeable
 * (AGL-2177, AGL-2180).
 *
 * Both take their environment as a parameter, which is what lets these assert
 * the CONTAINER shape directly rather than approximating it — the gap that let
 * AGL-2177 live: jest's own environment happens to look like a container, and
 * every existing spec read that as a quirk of the harness.
 */

import {
  isDeployedRuntime,
  isDevelopmentRuntime,
  isProductionDeployment,
} from './deployment-shape'

/** Exactly what docker/tenant.Dockerfile and docker/console.Dockerfile set. */
const CONTAINER = { AGLYN_STANDALONE: '1', NODE_ENV: 'production' }
/** Aglyn's cloud. */
const VERCEL = { VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' }
/** A developer's machine. */
const LOCALHOST = { NODE_ENV: 'development' }

describe('isDeployedRuntime', () => {
  it('is true on a self-host container', () => {
    // The assertion AGL-2177 was about: this read false, so the tenant
    // middleware resolved no host and 307'd every visitor to app.aglyn.com.
    expect(isDeployedRuntime(CONTAINER)).toBe(true)
  })

  it('is true on Vercel', () => {
    expect(isDeployedRuntime(VERCEL)).toBe(true)
  })

  it('is false on a developer machine', () => {
    expect(isDeployedRuntime(LOCALHOST)).toBe(false)
    expect(isDeployedRuntime({})).toBe(false)
  })

  it('reads only an explicit standalone opt-in', () => {
    // A stray or half-set value must not promote a laptop to a deployment.
    expect(isDeployedRuntime({ AGLYN_STANDALONE: '0' })).toBe(false)
    expect(isDeployedRuntime({ AGLYN_STANDALONE: 'true' })).toBe(false)
    expect(isDeployedRuntime({ AGLYN_STANDALONE: '' })).toBe(false)
  })
})

describe('isProductionDeployment — narrower, and a preview is the reason', () => {
  const PREVIEW = { VERCEL: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production' }

  it('is true on a production container', () => {
    expect(isProductionDeployment(CONTAINER)).toBe(true)
  })

  it('is true on Vercel production', () => {
    expect(isProductionDeployment(VERCEL)).toBe(true)
  })

  it('is FALSE on a preview, which isDeployedRuntime is not', () => {
    // The entire reason both predicates exist. The canonical custom-domain
    // redirect keys on this one: a preview that bounced a reviewer onto the
    // customer's LIVE site would be useless. The first attempt at AGL-2180
    // used the broad predicate here and canonical-domain-redirect.spec.ts
    // refused it — the suite doing its job.
    expect(isDeployedRuntime(PREVIEW)).toBe(true)
    expect(isProductionDeployment(PREVIEW)).toBe(false)
  })

  it('is false on a developer machine', () => {
    expect(isProductionDeployment(LOCALHOST)).toBe(false)
  })

  it('will not call a non-production container a production deployment', () => {
    expect(
      isProductionDeployment({ AGLYN_STANDALONE: '1', NODE_ENV: 'development' }),
    ).toBe(false)
  })
})

describe('isDevelopmentRuntime — the predicate a relaxation may key on', () => {
  it('is FALSE on a container, so production rules apply there', () => {
    // The whole of AGL-2180. `!process.env.VERCEL` was true here, which turned
    // the custom-domain soft-pass ON in production: any domain with any CNAME
    // verified, on every self-host install.
    expect(isDevelopmentRuntime(CONTAINER)).toBe(false)
  })

  it('is false on Vercel', () => {
    expect(isDevelopmentRuntime(VERCEL)).toBe(false)
  })

  it('is true on a developer machine, so local work is unaffected', () => {
    expect(isDevelopmentRuntime(LOCALHOST)).toBe(true)
  })

  it('differs from !isDeployedRuntime exactly where it matters', () => {
    // If these two agreed everywhere there would be no reason for both to
    // exist, and the next author would collapse them. On a container they
    // disagree, and that disagreement IS the security fix.
    expect(isDeployedRuntime(CONTAINER)).toBe(true)
    expect(isDevelopmentRuntime(CONTAINER)).toBe(false)
    expect(!isDeployedRuntime(CONTAINER)).toBe(isDevelopmentRuntime(CONTAINER))

    // ...and on a bare environment they do NOT agree: nothing set looks
    // undeployed, but it does not look like production either. A relaxation
    // keyed on the wrong one is exactly how a container got dev rules.
    expect(!isDeployedRuntime({})).toBe(true)
    expect(isDevelopmentRuntime({})).toBe(true)
  })
})
