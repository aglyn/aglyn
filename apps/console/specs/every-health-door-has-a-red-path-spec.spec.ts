/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

/**
 * Every health door has a spec that drives it red (AGL-2591).
 *
 * A health check is a promise to say something other than `ok`. Every route
 * under `api/health` derives its verdict from `healthStatus(checks)`, and the
 * external keyword monitors alert when `"status":"ok"` goes missing — so the
 * whole arrangement is only worth anything if each route CAN stop saying it.
 * One hundred percent uptime is not evidence of that; a check that cannot
 * fail reports one hundred percent uptime too.
 *
 * Most doors carry a spec that stubs their dependency into failure and
 * asserts the 503. The console error-beacon door did not until AGL-1923: it
 * was live and monitored, and nothing in the tree asserted it could answer
 * anything but 200 — and nothing in the tree would have noticed the next one.
 * Three more turned out to be in the same state when this sweep first ran
 * (AGL-2592).
 *
 * The sweep is derived rather than listed, on both sides. The routes come
 * from the filesystem, the same way the sibling monitorability sweep finds
 * them, and the specs come from the filesystem too: a spec "reaches" a door
 * when one of its `import`, `import()`, `require` or `jest.mock` specifiers
 * resolves to that door's route module or to a module the door owns under
 * its health tree (its probe, verdict or canary). It "drives it red" when it
 * also asserts a 503, a `'degraded'` verdict, or a check with `ok: false`.
 * Filesystem and regex only — no route is executed here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')

const HEALTH_ROOTS = [
  'apps/console/app/api/health',
  'apps/tenant/app/api/health',
]

/** Where a spec may live. `tools/` and `cloud/` test scripts, not routes. */
const SPEC_ROOTS = ['apps', 'libs']

/** Build output and dependencies: never sources, and enormous. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'coverage', 'out'])

const toPosix = (path: string) => path.split('\\').join('/')

/** Every file under `root` (repo-relative, posix) whose basename `keep` accepts. */
function filesUnder(root: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  const walk = (absolute: string, rel: string) => {
    for (const entry of readdirSync(absolute)) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue
      const next = join(absolute, entry)
      if (statSync(next).isDirectory()) walk(next, `${rel}/${entry}`)
      else if (keep(entry)) found.push(`${rel}/${entry}`)
    }
  }
  walk(join(REPO_ROOT, root), root)
  return found.sort()
}

const source = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

/** `a/b/c.ts` → `a/b/c`, the id an import specifier resolves to. */
const moduleId = (rel: string) => rel.replace(/\.tsx?$/, '')

const ALL_ROUTES = HEALTH_ROOTS.flatMap((root) =>
  filesUnder(root, (name) => name === 'route.ts'),
)

/** An old path kept alive by re-export owns no verdict of its own (AGL-2583). */
const isAlias = (text: string) => /export \{ GET, HEAD \} from '/.test(text)

/** The routes that IMPLEMENT a health check. */
const ROUTES = ALL_ROUTES.filter((rel) => !isAlias(source(rel)))

const SPECS = SPEC_ROOTS.flatMap((root) =>
  filesUnder(root, (name) => /\.spec\.tsx?$/.test(name)),
)

/**
 * Every module specifier a file names, in any of the four spellings a spec
 * uses to reach a route: `from '…'`, `import('…')`, `require('…')` and
 * `jest.mock('…')`. Backticks included, because one sibling spec drives two
 * canary routes through a template literal.
 */
const SPECIFIER = /(?:\bfrom|\bimport|\brequire|jest\.mock)\s*\(?\s*(['"`])([^'"`\n]+)\1/g

function specifiersOf(text: string): string[] {
  return Array.from(text.matchAll(SPECIFIER), (match) => match[2])
}

/**
 * A matcher for the module ids a relative specifier written in `file` names,
 * or null for a bare (package) specifier. A `${…}` segment in a template
 * literal matches any one path segment, so `render/${which}/route` reaches
 * both canary routes.
 */
function reachOf(file: string, specifier: string): ((id: string) => boolean) | null {
  if (!specifier.startsWith('.')) return null
  const target = moduleId(
    toPosix(relative(REPO_ROOT, resolve(join(REPO_ROOT, dirname(file)), specifier))),
  )
  if (!target.includes('${')) return (id) => id === target
  const pattern = target
    .split(/\$\{[^}]*\}/)
    .map((literal) => literal.replace(/[.*+?^()|[\]\\]/g, '\\$&'))
    .join('[^/]+')
  const glob = new RegExp(`^${pattern}$`)
  return (id) => glob.test(id)
}

/**
 * The modules a door OWNS: its route, plus every relative import of the route
 * that stays inside the health tree. A spec that drives the journeys probe
 * red drives the journeys door red; a spec that drives a shared billing
 * helper under `utils/` does not, so anything outside the tree is excluded.
 */
const HEALTH_TREE_MODULES = HEALTH_ROOTS.flatMap((root) =>
  filesUnder(root, (name) => /\.tsx?$/.test(name)).map(moduleId),
)

function subjectsOf(route: string): string[] {
  const owned = specifiersOf(source(route))
    .map((specifier) => reachOf(route, specifier))
    .filter((reach): reach is (id: string) => boolean => reach !== null)
  return [
    moduleId(route),
    ...HEALTH_TREE_MODULES.filter((id) => owned.some((reaches) => reaches(id))),
  ]
}

/**
 * What a red assertion looks like: the HTTP verdict, the body verdict, or a
 * check's own flag. Matching the matcher call rather than the bare literal
 * keeps a mock that SETS `ok: false` from counting as a spec that asserts it.
 */
const RED_ASSERTION =
  /\.toBe\(\s*503\s*\)|\.toBe\(\s*'degraded'\s*\)|\.to(?:Equal|MatchObject|StrictEqual)\(\s*(?:expect\.objectContaining\()?\{[^}]*\bok:\s*false/

/** Route → the specs that reach it → the subset that drive it red. */
const TABLE = ROUTES.map((route) => {
  const subjects = subjectsOf(route)
  const reaching = SPECS.filter((spec) => {
    const text = source(spec)
    return specifiersOf(text).some((specifier) => {
      const reaches = reachOf(spec, specifier)
      return reaches !== null && subjects.some(reaches)
    })
  })
  const red = reaching.filter((spec) => RED_ASSERTION.test(source(spec)))
  return { route, subjects, reaching, red }
})

const rowFor = (route: string) => {
  const row = TABLE.find((candidate) => candidate.route === route)
  if (row === undefined) throw new Error(`${route} is not a discovered health route`)
  return row
}

describe('the sweep', () => {
  it('discovers the doors and the specs rather than trusting a list', () => {
    // Without these the `describe.each` below would run zero cases and the
    // suite would pass while asserting nothing — the failure mode a derived
    // guard is most prone to.
    expect(ROUTES.length).toBeGreaterThanOrEqual(15)
    expect(ROUTES).toContain('apps/console/app/api/health/route.ts')
    expect(ROUTES).toContain('apps/tenant/app/api/health/route.ts')
    expect(SPECS.length).toBeGreaterThan(1000)
    expect(ALL_ROUTES.length).toBeGreaterThan(ROUTES.length)
  })

  it('recognizes each way a spec reaches a door, with a live example of each', () => {
    // Positive controls, one per specifier spelling. If the matcher regressed
    // on any of them the door would read as uncovered, so the failure here
    // names the matcher rather than the door.
    expect(rowFor('apps/console/app/api/health/error-beacon/route.ts').red).toContain(
      'apps/console/specs/health-error-beacon-route.spec.ts', // import()
    )
    expect(rowFor('apps/console/app/api/health/billing/route.ts').red).toContain(
      'apps/console/specs/health-billing-retry-lag.spec.ts', // require()
    )
    expect(rowFor('apps/tenant/app/api/health/render/site/route.ts').red).toContain(
      'apps/tenant/specs/render-canary-can-go-red.spec.ts', // template literal
    )
    expect(rowFor('apps/console/app/api/health/journeys/route.ts').subjects).toContain(
      'apps/console/app/api/health/journeys/journeys-probe', // owned module
    )
    expect(rowFor('apps/console/app/api/health/billing/route.ts').subjects).toEqual([
      'apps/console/app/api/health/billing/route', // nothing outside the tree
    ])
  })

  it('does not count a spec that only mentions a route path as a string', () => {
    // The lockdown coverage sweep lists every tenant route by path. It drives
    // nothing red and must not be credited as if it did.
    for (const { reaching } of TABLE) {
      expect(reaching).not.toContain('apps/tenant/specs/lockdown-tenant-api-coverage.spec.ts')
      expect(reaching).not.toContain('apps/console/specs/health-endpoints-are-monitorable.spec.ts')
    }
  })
})

describe.each(TABLE)('$route', ({ route, subjects, reaching, red }) => {
  it('is driven red by at least one spec', () => {
    if (red.length > 0) return
    const owned = subjects.slice(1)
    throw new Error(
      [
        `${route} has no spec that drives it red.`,
        reaching.length > 0
          ? `Specs that import it but never assert a 503, 'degraded' or ok: false: ${reaching.join(', ')}`
          : 'No spec imports it at all.',
        `A red-path spec imports ${moduleId(route)}${
          owned.length > 0 ? ` (or ${owned.join(', ')})` : ''
        }, stubs its dependency into failure, and asserts .toBe(503), .toBe('degraded') or a check with ok: false.`,
        'apps/console/specs/health-error-beacon-route.spec.ts is the model.',
      ].join('\n  '),
    )
  })
})

/**
 * A hardcoded ok is a check that cannot fail. Every verdict in the tree is
 * computed by `healthStatus(checks)` and serialized by `healthBody`; a route
 * that spells `status: 'ok'` itself has opted out of ever going red, and the
 * keyword monitor pointed at it would never alert again.
 */
describe.each(ALL_ROUTES)('%s', (route) => {
  const withoutComments = source(route)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('never writes the ok verdict by hand', () => {
    expect(withoutComments).not.toMatch(/\bstatus\s*:\s*['"`]ok['"`]|"status"\s*:\s*"ok"/)
  })

  if (!isAlias(source(route))) {
    it('computes its verdict from the checks', () => {
      expect(withoutComments).toMatch(/const status = healthStatus\(/)
    })
  }
})
