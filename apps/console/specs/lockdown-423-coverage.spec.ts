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

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * Every console API route answers a lockdown with the distinct 423 — or
 * says, in the file itself, why it does not (AGL-1506).
 *
 * AGL-1501 wired the verdict into six chokepoints and deferred the rest;
 * the deferred set is exactly the kind of inventory that rots. So this
 * spec holds the TOTAL surface, discovered rather than listed (the
 * `media-create-shape.spec.ts` posture): every `route.ts` under
 * `apps/console/app/api` must be one of —
 *
 *  1. WIRED — carries the `lockdownRefusal` two-line idiom, or the
 *     original AGL-1501 pair (`getLockdownVerdict` + `lockdownJsonResponse`,
 *     kept where the refusal also clears cookies);
 *  2. DELEGATED — `// lockdown-423: via <path>`, naming the shared module
 *     that runs the verdict for it (the media scope resolver, the v1
 *     authenticator); the target is verified to actually contain the
 *     helper, because a pointer at nothing is the AGL-1481 drift shape;
 *  3. EXEMPT — `// lockdown-423: exempt — <reason>`, with a real reason.
 *     The exemptions AGL-1501 established are the model: sign-out and the
 *     notice surface must stay reachable, support must stay contactable,
 *     the self-serve billing surface is how a billing-locked org pays its
 *     way out, and server-internal cron/webhook paths have no user caller;
 *  4. under `api/admin/` — structurally exempt, PROVEN: each file must
 *     carry a staff gate (the un-panic invariant makes the verdict
 *     identically null for anyone who passes it) or the cron secret.
 *
 * A new route arrives in this spec by existing. It fails until its author
 * either wires the verdict or writes down why not — which is the entire
 * point: the next AGL-1506 should be a one-line decision at review time,
 * not an archaeology project.
 */
const REPO_ROOT = resolve(__dirname, '../../..')
const CONSOLE_API = 'apps/console/app/api'

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
])

function walk(absoluteDir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name), keep))
    } else if (keep(entry.name)) {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

const read = (absolutePath: string) => readFileSync(absolutePath, 'utf8')
const repoPath = (absolutePath: string) => relative(REPO_ROOT, absolutePath)

const ROUTES = walk(
  resolve(REPO_ROOT, CONSOLE_API),
  (name) => name === 'route.ts',
)
  .map(repoPath)
  .sort()

/**
 * The wired idiom, both halves. Presence of the call alone is not
 * wiring — a computed verdict that never becomes the response is the
 * defect `feedback_verify_control_is_wired` exists about — so the return
 * is asserted too.
 */
const isWired = (source: string): boolean =>
  (source.includes('lockdownRefusal(') &&
    source.includes('if (locked) return locked')) ||
  (source.includes('getLockdownVerdict(') &&
    source.includes('lockdownJsonResponse'))

const VIA = /lockdown-423: via (\S+)/
const EXEMPT = /lockdown-423: exempt — (.*)/

/** Marker reason: the marker line's tail plus following `//` lines. */
function exemptReason(source: string): string | null {
  const lines = source.split('\n')
  const at = lines.findIndex((line) => EXEMPT.test(line))
  if (at === -1) return null
  let reason = (lines[at].match(EXEMPT) as RegExpMatchArray)[1].trim()
  for (let next = at + 1; next < lines.length; next += 1) {
    const trimmed = lines[next].trim()
    if (!trimmed.startsWith('//')) break
    reason += ` ${trimmed.slice(2).trim()}`
  }
  return reason
}

interface Classified {
  file: string
  kind: 'admin' | 'wired' | 'delegated' | 'exempt' | 'violation'
  via?: string
  reason?: string
}

const CLASSIFIED: Classified[] = ROUTES.map((file) => {
  const source = read(resolve(REPO_ROOT, file))
  if (file.includes(`${CONSOLE_API}/admin/`)) return { file, kind: 'admin' }
  if (isWired(source)) return { file, kind: 'wired' }
  const via = source.match(VIA)
  if (via) return { file, kind: 'delegated', via: via[1] }
  const reason = exemptReason(source)
  if (reason !== null) return { file, kind: 'exempt', reason }
  return { file, kind: 'violation' }
})

describe('AGL-1506 · every org-scoped console API route answers the 423', () => {
  it('discovers the whole surface rather than trusting a list', () => {
    // 105 route files on the day this landed. The floor only guards
    // against the walk silently breaking (an empty scan "passes"
    // everything), not against growth.
    expect(ROUTES.length).toBeGreaterThanOrEqual(100)
    // Anchors: the AGL-1501 originals and this issue's two dispatcher
    // chokepoints must be discovered as wired — if these four read as
    // anything else, the classifier broke, not the routes.
    const byFile = new Map(CLASSIFIED.map((entry) => [entry.file, entry]))
    for (const anchor of [
      'apps/console/app/api/hosts/versions/route.ts',
      'apps/console/app/api/auth/session/route.ts',
      'apps/console/app/api/[...pluginApi]/route.ts',
    ]) {
      expect(`${anchor}: ${byFile.get(anchor)?.kind}`).toBe(`${anchor}: wired`)
    }
  })

  it('leaves no route unwired, undelegated and unexplained', () => {
    const violations = CLASSIFIED.filter(
      (entry) => entry.kind === 'violation',
    ).map(
      (entry) =>
        `${entry.file} — wire lockdownRefusal (see hosts/versions), add ` +
        `"lockdown-423: via <module>", or document ` +
        `"lockdown-423: exempt — <reason>"`,
    )
    expect(violations).toEqual([])
  })

  it('backs every delegation with a module that really runs the verdict', () => {
    const delegated = CLASSIFIED.filter((entry) => entry.kind === 'delegated')
    // The two delegation targets this issue shipped. More may arrive.
    expect(delegated.length).toBeGreaterThanOrEqual(2)
    const broken = delegated
      .filter((entry) => {
        const target = resolve(REPO_ROOT, entry.via as string)
        if (!existsSync(target)) return true
        const source = read(target)
        return (
          !source.includes('lockdownRefusal(') &&
          !source.includes('getLockdownVerdict(')
        )
      })
      .map((entry) => `${entry.file} → ${entry.via}`)
    expect(broken).toEqual([])
  })

  it('media routes return the resolver’s prebuilt refusal, not a bare status', () => {
    // The scope resolver hands the 423 back as `error.response`; a caller
    // that flattens it to `{error: message}` still refuses, but drops the
    // machine-readable body the whole issue is about.
    const flattening = CLASSIFIED.filter((entry) => {
      const source = read(resolve(REPO_ROOT, entry.file))
      return (
        source.includes('resolveMediaScope(') &&
        !source.includes('error?.response')
      )
    }).map((entry) => entry.file)
    expect(flattening).toEqual([])
  })

  it('exempts only with a real reason, never a bare marker', () => {
    const exempt = CLASSIFIED.filter((entry) => entry.kind === 'exempt')
    expect(exempt.length).toBeGreaterThanOrEqual(25)
    const thin = exempt
      .filter((entry) => (entry.reason as string).length < 40)
      .map((entry) => `${entry.file} — "${entry.reason}"`)
    expect(thin).toEqual([])
  })

  it('admin routes are all staff-gated or cron-secret paths', () => {
    // The structural exemption's proof obligation: staff bypass every
    // scope (the un-panic invariant), so a staff-gated route's verdict is
    // identically null — but only if the gate is actually there.
    const admin = CLASSIFIED.filter((entry) => entry.kind === 'admin')
    expect(admin.length).toBeGreaterThanOrEqual(25)
    const ungated = admin
      .filter((entry) => {
        const source = read(resolve(REPO_ROOT, entry.file))
        return !source.includes(`'staff'`) && !source.includes('CRON_SECRET')
      })
      .map((entry) => entry.file)
    expect(ungated).toEqual([])
  })
})
