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

import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * Every CLIENT call site a feature lock can refuse renders the 423 body,
 * not a generic failure (AGL-1532).
 *
 * The server half has been honest since AGL-1510: each chokepoint refuses
 * with `{error:'locked', scope, feature, title, message, untilMs?}`, and
 * the checkout copy says in so many words that it is NOT a payment failure.
 * The signup page consumed its notice; every other surface funnelled the
 * 423 straight into "Could not start checkout" / "Install failed" / "AI
 * request failed". Beta week is when the lockdown IS the incident response,
 * and a lock that misreports itself as a broken product spends exactly the
 * trust it exists to protect.
 *
 * This is the client analogue of `lockdown-423-coverage.spec.ts`, and it
 * takes the same posture: the inventory is DISCOVERED, not listed. Any file
 * that fetches a lockable path must carry the shared reader — so a tenth
 * install button, or a second AI door, arrives in this spec by existing and
 * fails until its author wires the notice.
 *
 * Reverting any ONE call site to its generic toast turns this red and names
 * the file, which is the per-surface guarantee: the surfaces cannot drift
 * apart one refactor at a time.
 */
const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * Where a lockable client fetch can live. `apps/console/app/api` is the
 * SERVER side — its own coverage spec owns it — and is excluded below.
 */
const SEARCH_ROOTS = ['apps/console', 'libs/plugins/marketplace/src']

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.nx',
  '.turbo',
  'specs',
])

/**
 * The paths a feature lock refuses, mirroring the server's own map:
 * `lockdownFeaturesForPluginApiPath` (installs-as-a-class, update-artifact,
 * marketplace checkout, ai/assist) plus the billing checkout route, which
 * the `checkout` key gates directly rather than through the dispatcher.
 *
 * The template-literal form is here because the marketplace funnel picks
 * its installer route per artifact type — seven of the eight install
 * endpoints are only ever reached through it.
 */
const LOCKABLE_FETCH = [
  '/api/billing/checkout',
  '/api/marketplace/install',
  '/api/marketplace/update-artifact',
  '/api/marketplace/checkout',
  '/api/ai/assist',
  '/api/${endpoint}',
]

function walk(absoluteDir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name)))
    } else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

interface CallSite {
  file: string
  source: string
  targets: string[]
}

const CALL_SITES: CallSite[] = SEARCH_ROOTS.flatMap((root) =>
  walk(resolve(REPO_ROOT, root)),
)
  .map((absolute) => ({
    file: relative(REPO_ROOT, absolute),
    source: readFileSync(absolute, 'utf8'),
  }))
  // The server routes answer WITH the 423; they do not read one.
  .filter((entry) => !entry.file.startsWith('apps/console/app/api/'))
  .map((entry) => ({
    ...entry,
    targets: LOCKABLE_FETCH.filter((path) =>
      entry.source.includes(`fetch(\`${path}`) || entry.source.includes(`fetch('${path}`),
    ),
  }))
  .filter((entry) => entry.targets.length > 0)
  .sort((a, b) => a.file.localeCompare(b.file))

/**
 * The three surfaces AGL-1532 names, pinned by file. Discovery alone would
 * quietly shrink if a fetch were renamed or moved — and a coverage guard
 * over an empty set passes.
 */
const NAMED_SURFACES = {
  'billing / upgrade': 'apps/console/app/(app)/[orgSlug]/billing/page.tsx',
  'marketplace install + purchase':
    'libs/plugins/marketplace/src/lib/hooks/use-marketplace-actions.ts',
  'AI-assist drawer':
    'libs/plugins/marketplace/src/lib/components/ai-assist-provider.component.tsx',
} as const

describe('AGL-1532 · client surfaces read the 423 feature body', () => {
  it('finds the lockable client call sites at all', () => {
    // A guard over nothing is not a guard (the empty-inventory failure
    // mode this repo has paid for before).
    expect(CALL_SITES.length).toBeGreaterThanOrEqual(10)
  })

  it.each(Object.entries(NAMED_SURFACES))(
    'the %s surface is still a discovered call site',
    (_label, file) => {
      expect(CALL_SITES.map((site) => site.file)).toContain(file)
    },
  )

  it.each(CALL_SITES.map((site) => [site.file, site] as const))(
    '%s parses the 423 and renders the notice',
    (_file, site) => {
      // Both halves. A parsed verdict that never reaches the user is the
      // "computed but not wired" defect, not a fix.
      expect({
        file: site.file,
        parses: site.source.includes('parseLockdownRefusal('),
        renders: site.source.includes('lockdownRefusalText('),
      }).toEqual({ file: site.file, parses: true, renders: true })
    },
  )

  it.each(CALL_SITES.map((site) => [site.file, site] as const))(
    '%s keeps a generic path for real failures',
    (_file, site) => {
      // The notice must not have REPLACED the error handling — a 500 is
      // still a 500, and `parseLockdownRefusal` returns null for it. Every
      // one of these sites reached its generic toast through a `payload
      // ?? '<copy>'` fallback or a catch; that fallback must survive.
      const hasGeneric =
        site.source.includes('?? ') && /enqueueSnackbar\(/.test(site.source)
      expect(`${site.file} keeps a generic toast: ${hasGeneric}`).toBe(
        `${site.file} keeps a generic toast: true`,
      )
    },
  )

  it('nobody re-implements the parsing (one reader, not three)', () => {
    // The second-implementation shape this repo keeps paying for: a call
    // site that hand-rolls `status === 423` instead of using the shared
    // reader will drift from the others the first time the body changes.
    for (const site of CALL_SITES) {
      expect(`${site.file}: ${/status\s*===\s*423/.test(site.source)}`).toBe(
        `${site.file}: false`,
      )
    }
  })
})
