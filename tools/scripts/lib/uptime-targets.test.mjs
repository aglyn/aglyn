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

// What the uptime probe watches (AGL-1617).
//
// Two defects are guarded here, and they are NOT the same defect:
//
//  1. The tenant target was `https://demo.aglyn.com` — a workspace-subdomain
//     shape whose root 404s. The probe read only `/api/health`, which is
//     host-independent, so it was green every fifteen minutes on a hostname
//     that served no page. Nothing the probe fetches can notice that, which
//     is why the guard is here rather than at runtime.
//
//  2. `/api/health/render/{site,marketing}` were built to replace two dead
//     GCP uptime checks and then had no reader at all — not this probe, not
//     the docs status page. A replacement for a dead check that is itself
//     dark is the written-but-never-read shape one layer up, so the canary
//     list is derived from the FILESYSTEM: a third canary fails this suite
//     until somebody points a monitor at it.

import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TARGETS,
  SUBSYSTEM_HEALTH,
  buildPlan,
  evaluateCanaryReaders,
} from './uptime-targets.mjs'

/**
 * A tenant base must be a hostname that SERVES published sites.
 *
 * Returns the reason it is unusable, or `null`. `*.aglyn.com` is the
 * WORKSPACE-subdomain shape — the console's origin, not a site's. The tenant
 * middleware resolves those names as custom domains via the `cname--`
 * sentinel, there is no host doc named `demo.aglyn.com`, and its root
 * therefore 404s; published sites live on the `*.aglyn.app` tenant apex.
 *
 * This lives in the test rather than in `uptime-targets.mjs` on purpose.
 * Nothing at runtime calls it — an exported predicate with no caller is the
 * same written-but-never-read shape this suite exists to catch — and the
 * knowledge is Aglyn-specific, so keeping it out of the shipped module keeps
 * the self-host ratchet's count of our own hostnames where it was.
 */
function tenantBaseProblem(base) {
  let host
  try {
    host = new URL(base).host
  } catch {
    return `not a URL: ${base}`
  }
  if (host.endsWith('.aglyn.com')) {
    return `${host} is a workspace subdomain — its root 404s; published sites are on the .aglyn.app tenant apex`
  }
  return null
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CANARY_DIR = join(REPO_ROOT, 'apps/tenant/app/api/health/render')

/** The canaries the tenant app actually ships, read from disk. */
function canaryRoutesOnDisk() {
  return readdirSync(CANARY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

describe('the tenant probe target', () => {
  it('is a hostname that serves published sites — the green control', () => {
    const tenant = DEFAULT_TARGETS.find(([name]) => name === 'tenant')
    assert.ok(tenant, 'no tenant target')
    assert.equal(tenantBaseProblem(tenant[1]), null)
  })

  /**
   * THE REGRESSION, named. Without this case the suite is satisfied by the
   * exact configuration that produced eight months of green on a 404.
   */
  it('rejects the workspace-subdomain shape that 404s', () => {
    const problem = tenantBaseProblem('https://demo.aglyn.com')
    assert.ok(problem, 'demo.aglyn.com was accepted')
    assert.match(problem, /404/)
    assert.match(problem, /aglyn\.app/)
  })

  it('rejects a base that is not a URL at all', () => {
    assert.match(tenantBaseProblem('demo.aglyn.app'), /not a URL/)
  })

  it('still names the console target on its own origin', () => {
    const console_ = DEFAULT_TARGETS.find(([name]) => name === 'console')
    assert.ok(console_)
    assert.equal(new URL(console_[1]).host, 'app.aglyn.com')
  })
})

describe('every render canary has a reader', () => {
  it('finds the canaries on disk at all — the positive control', () => {
    // Without this, a renamed directory would empty the list and the guard
    // below would pass by reading nothing.
    const routes = canaryRoutesOnDisk()
    assert.deepEqual(routes, ['marketing', 'site'])
  })

  it('the probe watches every one of them', () => {
    const result = evaluateCanaryReaders(canaryRoutesOnDisk())
    assert.equal(
      result.ok,
      true,
      `render canaries nothing reads: ${result.unread.join(', ')}`,
    )
  })

  it('names a canary that nothing reads — the red case', () => {
    const result = evaluateCanaryReaders([...canaryRoutesOnDisk(), 'checkout'])
    assert.equal(result.ok, false)
    assert.deepEqual(result.unread, ['/api/health/render/checkout'])
  })
})

describe('buildPlan', () => {
  it('puts the root first and names each subsystem row', () => {
    const plan = buildPlan([['tenant', 'https://t.test']])
    assert.deepEqual(plan[0], ['tenant', 'https://t.test', '/api/health'])
    assert.deepEqual(
      plan.slice(1).map(([name]) => name),
      SUBSYSTEM_HEALTH.tenant.map(
        (path) => `tenant/${path.slice('/api/health/'.length)}`,
      ),
    )
    for (const [, base] of plan) assert.equal(base, 'https://t.test')
  })

  it('adds no requests for a name with no subsystem list', () => {
    // A bare-URL or localhost invocation must stay a single fetch.
    const plan = buildPlan([['target-1', 'http://localhost:4200']])
    assert.equal(plan.length, 1)
  })
})
