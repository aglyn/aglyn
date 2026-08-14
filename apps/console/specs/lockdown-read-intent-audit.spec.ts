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
 * WHICH CONSOLE ROUTES CLAIM TO BE READS (AGL-1625).
 *
 * AGL-1511 made a read-only lock discriminate on intent and defaulted the
 * intent to `write` — an over-refused read costs friction, an under-refused
 * write costs the corruption the mode exists to prevent. `intent: 'read'` is
 * therefore the ONE construct in this system that can relax a lock, and it is
 * a security assertion each time it is written: it says, of a specific route,
 * that no path below the verdict mutates anything.
 *
 * A sibling of `lockdown-423-coverage.spec.ts`, and the same posture:
 * DISCOVER the declarations rather than trust a list. That spec answers "does
 * every route answer a lock at all"; this one answers "and which of them have
 * been allowed through one".
 *
 * Two obligations, because the failure modes are opposite:
 *
 *  1. an UNDECLARED read is friction — the AGL-1625 audit narrowed that, and
 *     nothing here can find the next one;
 *  2. an UNAUDITED declaration is a write let through a maintenance freeze,
 *     which is silent, and is what this spec exists to make loud. A new
 *     `intent: 'read'` fails until its route is added to the list below,
 *     which is the moment someone has to argue for it.
 *
 * `api/admin/` is excluded exactly as it is in the coverage spec: those
 * routes are staff-gated, and the un-panic invariant returns null for a staff
 * claim BEFORE any read, so intent cannot change their answer. (The verdict
 * probe under that path names both intents on purpose — see AGL-1628.)
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

function walk(absoluteDir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name)))
    } else if (entry.name === 'route.ts') {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

const read = (absolutePath: string) => readFileSync(absolutePath, 'utf8')

const ROUTES = walk(resolve(REPO_ROOT, CONSOLE_API))
  .map((absolutePath) => relative(REPO_ROOT, absolutePath))
  .filter((file) => !file.includes(`${CONSOLE_API}/admin/`))
  .sort()

/**
 * The declaration as it is actually written — an object property, so a type
 * annotation (`intent: 'read' | 'write'`) or a comparison is not mistaken
 * for one. Trailing comma or closing brace only.
 */
const DECLARES_READ = /\bintent:\s*'read'\s*(?:,|\})/

interface ReadDeclaration {
  file: string
  /** The contiguous `//` block immediately above the declaration. */
  reason: string
}

function readDeclarations(file: string): ReadDeclaration[] {
  const lines = read(resolve(REPO_ROOT, file)).split('\n')
  const found: ReadDeclaration[] = []
  lines.forEach((line, index) => {
    if (!DECLARES_READ.test(line)) return
    const reason: string[] = []
    for (let above = index - 1; above >= 0; above -= 1) {
      const trimmed = lines[above].trim()
      if (!trimmed.startsWith('//')) break
      reason.unshift(trimmed.slice(2).trim())
    }
    found.push({ file, reason: reason.join(' ').trim() })
  })
  return found
}

const DECLARED = ROUTES.flatMap(readDeclarations)

/**
 * The audited set, at the close of AGL-1625. Every entry is a route whose
 * METHOD lies about what it does — a POST that is really a query, or a
 * session door that a read-only lock must not bolt — and each was read end
 * to end before it was written down.
 *
 * `auth/session` appears twice by design: the mint and the exchange are
 * separate chokepoints in one file and each carries its own declaration.
 */
const AUDITED_READS: Record<string, number> = {
  // Signing in is how a customer reaches the data read-only keeps readable
  // (mint, then cookie exchange).
  'apps/console/app/api/auth/session/route.ts': 2,
  // Presence lives in RTDB and races no Firestore migration.
  'apps/console/app/api/presence/token/route.ts': 1,
  // "What would this plugin change" — a projection, not a change.
  'apps/console/app/api/hosts/plugin-impact/route.ts': 1,
  // A usage query whose arguments happen to be a body.
  'apps/console/app/api/hosts/where-used/route.ts': 1,
  // Signing a URL for an object the caller may already read.
  'apps/console/app/api/media/sign/route.ts': 1,
  // AGL-1625: the per-asset usage scan, the media sibling of where-used.
  'apps/console/app/api/media/references/route.ts': 1,
}

describe('AGL-1625 · which console routes are declared READS', () => {
  it('discovers the whole route surface rather than trusting a list', () => {
    // The floor guards against the walk silently breaking: an empty scan
    // would "pass" every assertion below by finding nothing to check.
    expect(ROUTES.length).toBeGreaterThanOrEqual(80)
    expect(DECLARED.length).toBeGreaterThan(0)
  })

  it('declares a read intent only on an audited route', () => {
    const counted: Record<string, number> = {}
    for (const entry of DECLARED) {
      counted[entry.file] = (counted[entry.file] ?? 0) + 1
    }
    // Equality both ways, not a subset: an ADDED declaration is a route let
    // through a write freeze, and a REMOVED one means an audited read went
    // back to being refused during maintenance. Both should stop a build
    // and be argued for, rather than noticed during the next incident.
    expect(counted).toEqual(AUDITED_READS)
  })

  it('writes down WHY, at every declaration', () => {
    // The bar AGL-1511 set for the first four: "an explicit `intent` with a
    // one-line reason". A bare `intent: 'read'` is indistinguishable from a
    // copy-paste, and this is the assertion that says so at review time.
    const thin = DECLARED.filter((entry) => entry.reason.length < 60).map(
      (entry) => `${entry.file} — "${entry.reason}"`,
    )
    expect(thin).toEqual([])
  })

  it('keeps the media resolver refusing by default', () => {
    // `resolveMediaScope` is the delegation target for eight routes and
    // takes no request, so its default IS the intent for all of them. Seven
    // mutate. A default of `read` here would relax every one of them at
    // once, from a single line nobody would think to look at.
    const source = read(
      resolve(REPO_ROOT, 'apps/console/utils/server/media-scope.ts'),
    )
    expect(source).toMatch(/intent\?: LockdownVerdictOptions\['intent'\]/)
    expect(source).not.toMatch(DECLARES_READ)
    // And it must actually forward what it is given — an accepted-but-
    // ignored option would silently refuse the read it was told about.
    expect(source.match(/intent: options\?\.intent/g)?.length).toBe(2)
  })
})
