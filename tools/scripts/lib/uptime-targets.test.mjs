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
  evaluateSubsystemReaders,
  markPendingDeployments,
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

/** Which app directory serves each probe target. */
const HEALTH_ROOTS = {
  console: join(REPO_ROOT, 'apps/console/app/api/health'),
  tenant: join(REPO_ROOT, 'apps/tenant/app/api/health'),
}

/**
 * Every subsystem health route an app actually ships, read from disk.
 *
 * A directory counts only when it directly contains a `route.ts` — so
 * `apps/tenant/app/api/health/render`, which is a grouping directory with no
 * handler of its own, contributes its CHILDREN and not itself. The root
 * `/api/health` is excluded because `buildPlan` probes it unconditionally.
 */
function subsystemRoutesOnDisk(root, prefix = '/api/health') {
  const routes = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const path = `${prefix}/${entry.name}`
    const children = readdirSync(dir, { withFileTypes: true })
    if (children.some((child) => child.isFile() && child.name === 'route.ts')) {
      routes.push(path)
    }
    if (children.some((child) => child.isDirectory())) {
      routes.push(...subsystemRoutesOnDisk(dir, path))
    }
  }
  return routes.sort()
}

function allSubsystemRoutesOnDisk() {
  return Object.fromEntries(
    Object.entries(HEALTH_ROOTS).map(([target, root]) => [
      target,
      subsystemRoutesOnDisk(root),
    ]),
  )
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

describe('every subsystem health endpoint has a reader (AGL-1921)', () => {
  it('finds the endpoints on disk at all — the positive control', () => {
    // Without this, a moved directory would empty the lists and the guard
    // below would pass by reading nothing — the same false green the canary
    // control guards against.
    const routes = allSubsystemRoutesOnDisk()
    assert.ok(
      routes.console.length >= 7,
      `only found ${routes.console.length} console health routes`,
    )
    assert.ok(routes.console.includes('/api/health/server-errors'))
    assert.ok(routes.tenant.includes('/api/health/render/site'))
    // The grouping directory is NOT a route: it ships no `route.ts`.
    assert.equal(routes.tenant.includes('/api/health/render'), false)
  })

  it('the probe watches every one of them, and watches nothing that is gone', () => {
    const result = evaluateSubsystemReaders(allSubsystemRoutesOnDisk())
    assert.equal(
      result.ok,
      true,
      `endpoints nothing reads: ${result.unread.join(', ')} · watched paths no app serves: ${result.missing.join(', ')}`,
    )
  })

  it('names an endpoint that nothing reads — the red case', () => {
    const routes = allSubsystemRoutesOnDisk()
    routes.console = [...routes.console, '/api/health/checkout']
    const result = evaluateSubsystemReaders(routes)
    assert.equal(result.ok, false)
    assert.deepEqual(result.unread, ['console/api/health/checkout'])
  })

  /**
   * The inverse direction, and it is what lets the probe treat a subsystem
   * 404 as PENDING instead of DOWN without opening a hole. A path that stays
   * on the watch list after its route is deleted would report PENDING
   * forever — silence wearing a monitor's clothes. This is the only thing
   * that can catch that, and it catches it at review time.
   */
  it('names a watched path that no app serves — the deleted-route case', () => {
    const result = evaluateSubsystemReaders(
      { console: ['/api/health/crons'] },
      { console: ['/api/health/crons', '/api/health/deleted'] },
    )
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing, ['console/api/health/deleted'])
    assert.deepEqual(result.unread, [])
  })

  it('reports an unknown target as entirely unread rather than skipping it', () => {
    // A new app whose name is not in `SUBSYSTEM_HEALTH` must fail loudly. An
    // absent key folding to "nothing to check" is how a whole deployment
    // would go dark silently.
    const result = evaluateSubsystemReaders({ docs: ['/api/health/status'] })
    assert.equal(result.ok, false)
    assert.deepEqual(result.unread, ['docs/api/health/status'])
  })
})

describe('a subsystem 404 pending promotion (AGL-1921)', () => {
  const row = (name, status, ok) => ({ name, status, ok, detail: 'x' })

  it('reclassifies a 404 subsystem row while the root is up', () => {
    const [root, sub] = markPendingDeployments([
      row('console', 200, true),
      row('console/server-errors', 404, false),
    ])
    assert.equal(sub.pending, true)
    assert.equal(sub.ok, true)
    assert.match(sub.detail, /promote main/)
    // The root is untouched, and never eligible itself.
    assert.equal(root.pending, undefined)
  })

  /**
   * THE NEGATIVE CONTROL, and the reason this is safe. A deployment that is
   * genuinely down does not 404 selectively — it fails everything. If the root
   * is down, nothing may be laundered into green.
   */
  it('leaves a 404 DOWN when the target root is also down', () => {
    const [, sub] = markPendingDeployments([
      row('console', 503, false),
      row('console/server-errors', 404, false),
    ])
    assert.equal(sub.pending, undefined)
    assert.equal(sub.ok, false)
  })

  it('never reclassifies the ROOT itself — a 404 base is a wrong base', () => {
    // The AGL-786 defect: a base URL that does not serve the app. That must
    // stay DOWN however the rest of the plan reads.
    const [root] = markPendingDeployments([row('tenant', 404, false)])
    assert.equal(root.pending, undefined)
    assert.equal(root.ok, false)
  })

  /**
   * The row above cannot fail the `name.includes('/')` clause on its own: a
   * 404 root also fails the "root is up" clause, so the two are redundant for
   * every result `probe()` can produce TODAY. This constructs the one shape
   * that separates them — a root marked ok despite a 404 — so the clause is
   * covered rather than merely present. `probe()` computes `ok` from
   * `status === 200`; if that ever changes, this is what keeps a wrong base
   * URL from being laundered into PENDING.
   */
  it('still refuses a root row even if it were somehow marked up', () => {
    const [root] = markPendingDeployments([row('tenant', 404, true)])
    assert.equal(root.pending, undefined)
  })

  it('leaves a 500 or a 503 DOWN — only a MISSING route is pending', () => {
    const [, five, degraded] = markPendingDeployments([
      row('console', 200, true),
      row('console/crons', 500, false),
      row('console/backups', 503, false),
    ])
    assert.equal(five.ok, false)
    assert.equal(degraded.ok, false)
  })

  it('does not touch a healthy row', () => {
    const [, sub] = markPendingDeployments([
      row('console', 200, true),
      row('console/crons', 200, true),
    ])
    assert.equal(sub.pending, undefined)
    assert.equal(sub.detail, 'x')
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
