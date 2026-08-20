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
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  isDeployedRuntime,
  isDevelopmentRuntime,
  isProductionDeployment,
  platformVersion,
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

/**
 * What a health report calls this deployment (AGL-2436).
 *
 * Both health routes read `process.env.VERCEL_ENV ?? 'development'`, so a
 * self-hoster's production container answered `"environment": "development"`.
 * A health endpoint exists to say what is running; ours said the opposite for
 * every deployment that is not Aglyn's.
 */
describe('deploymentEnvironmentLabel', () => {
  it("AGLYN-OPERATED: Vercel's own label wins where it exists", () => {
    // It is the only signal that separates a preview from production, so
    // nothing derived may override it.
    expect(deploymentEnvironmentLabel({ VERCEL_ENV: 'production' })).toBe(
      'production',
    )
    expect(deploymentEnvironmentLabel({ VERCEL_ENV: 'preview' })).toBe(
      'preview',
    )
  })

  it('SELF-HOST: a production container reports production, not development', () => {
    expect(
      deploymentEnvironmentLabel({
        AGLYN_STANDALONE: '1',
        NODE_ENV: 'production',
      }),
    ).toBe('production')
  })

  it('a non-production container is a deployment, and says so', () => {
    // Neither "production" (it is not) nor "development" (it is not a laptop).
    expect(
      deploymentEnvironmentLabel({
        AGLYN_STANDALONE: '1',
        NODE_ENV: 'development',
      }),
    ).toBe('deployment')
  })

  it("a developer's machine is still development", () => {
    expect(deploymentEnvironmentLabel({})).toBe('development')
    expect(deploymentEnvironmentLabel({ NODE_ENV: 'development' })).toBe(
      'development',
    )
  })

  it('the negative control: the exact answer every self-host container gave', () => {
    // With the old expression this environment produced 'development'. If this
    // ever reads 'development' again, the regression is back.
    expect(
      deploymentEnvironmentLabel({
        AGLYN_STANDALONE: '1',
        NODE_ENV: 'production',
      }),
    ).not.toBe('development')
  })
})

/**
 * What BUILD this is, in a shape the operator of it can actually read
 * (AGL-2091).
 *
 * Every `/api/health*` route answered `commit` from `VERCEL_GIT_COMMIT_SHA`
 * alone, so off Vercel — which is every self-host container — the one endpoint
 * whose job is to say what is running answered `null`. An operator who wants
 * to report a bug, or to ask whether a fix has reached them, had no version to
 * quote: the console footer was the only surface that stated one, and the
 * tenant app stated none at all.
 *
 * These take the environment as a parameter for the same reason the
 * predicates above do: jest's own environment is not any of the three
 * deployment shapes, so a spec that reads `process.env` proves nothing about
 * a container.
 */
describe('deploymentCommitRef (AGL-2091)', () => {
  it('reports the commit on Aglyn cloud, shortened the way it always was', () => {
    expect(
      deploymentCommitRef({ ...VERCEL, VERCEL_GIT_COMMIT_SHA: 'cbf8125a3aacb6a1658e476c83fe618f3cafed3b' }),
    ).toBe('cbf8125')
  })

  it('reports COMMIT_REF on a self-host container', () => {
    // The AGL-2091 assertion. Before this existed the container had no
    // VERCEL_GIT_COMMIT_SHA, so this returned null and the health body said
    // `"commit": null` on every self-hosted install.
    expect(
      deploymentCommitRef({ ...CONTAINER, COMMIT_REF: 'f9d997329ee008553be081ba46ded95e9b7eb309' }),
    ).toBe('f9d9973')
  })

  it('prefers an explicitly stamped BUILD_ID over anything derived', () => {
    // Same precedence the console footer uses (AGL-2181), so the footer and
    // the health endpoint cannot disagree about which build answered.
    expect(
      deploymentCommitRef({
        ...CONTAINER,
        BUILD_ID: 'release7',
        COMMIT_REF: 'f9d997329ee0',
        VERCEL_GIT_COMMIT_SHA: 'cbf8125a3aac',
      }),
    ).toBe('release')
  })

  it('is null when nothing stamped the build — never the NULL sentinel', () => {
    // `global.ts` renders unset build metadata as the literal string 'NULL',
    // and a Docker ARG with no default hands the same text through. A health
    // body claiming to run commit "NULL" is worse than one admitting it does
    // not know.
    expect(deploymentCommitRef(CONTAINER)).toBeNull()
    expect(deploymentCommitRef({ ...CONTAINER, COMMIT_REF: 'NULL' })).toBeNull()
    expect(deploymentCommitRef({ ...CONTAINER, BUILD_ID: '   ' })).toBeNull()
  })
})

describe('platformVersion (AGL-2091)', () => {
  it('reports the package version on a self-host container', () => {
    // The number a self-hoster can put in a bug report. It needs no operator
    // configuration at all: `with-aglyn.nextjs.config.js` reads it out of
    // package.json and inlines it, so it is correct in a container the first
    // time one is built.
    expect(platformVersion({ ...CONTAINER, PACKAGE_VERSION: '1.0.0-beta.6' })).toBe(
      '1.0.0-beta.6',
    )
  })

  it('is null when the build missed the define, never the string NULL', () => {
    expect(platformVersion(CONTAINER)).toBeNull()
    expect(platformVersion({ ...CONTAINER, PACKAGE_VERSION: 'NULL' })).toBeNull()
  })
})
