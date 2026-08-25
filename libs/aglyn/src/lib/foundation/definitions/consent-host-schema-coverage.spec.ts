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
 * Every `consent.*` key of `hosts/{hostId}` that anything WRITES or READS is
 * DECLARED on `AglynHost` (AGL-1649).
 *
 * ## The hole this was written to close, which was open
 *
 * AGL-1649 exists because a host had no way to obtain a basis for advertising
 * storage. The control that gives them one is a single persisted host field,
 * `consent.advertising`: the console writes it (`consent-banner-card`), the
 * tenant reads it (`hostAsksAboutAdvertising`), and everything else in the
 * feature hangs off those two. It shipped in `7901f7332` and was NOT declared
 * on `AglynHost.consent`, which carried `disabled` and `mode` only.
 *
 * That is the same shape the `analytics` comment in `platform.types.ts`
 * records having already been fixed once — "long written by the console and
 * read by the tenant through `any` casts; declared as of AGL-1498" — and it
 * came straight back on the next host field anyone added.
 *
 * It is not a typo problem. `consent` is an INLINE object type, so the type
 * is what a whole-object write is checked against: writing the map as an
 * object literal carrying all three keys is an excess-property error while
 * one of them is undeclared, and the two ways out of that error are a cast
 * and deleting the key. Deleting it is silent, it is the tidier-looking edit,
 * and against a `merge` write it lands as a host's advertising opt-in
 * switching itself off. `readStoredVisitorConsent` would then read every
 * visitor as never-asked — correctly, and forever.
 *
 * ## Why parsing rather than a type-level assertion
 *
 * The jest projects transform with babel, which erases types without checking
 * them, so a `satisfies`/assignment probe in a spec compiles to nothing and
 * asserts nothing — a green check that only proves it ran. `tsc` would catch
 * a bad WRITE but can say nothing about a key that is merely missing, which
 * is this defect exactly. So the guard reads source text, in the shape the
 * neighbouring AGL-1355/AGL-1361 deny-coverage guards already use.
 *
 * ## Both directions, on purpose
 *
 * - written or read but NOT declared → the schema is behind the product, and
 *   the next whole-object write drops the key;
 * - declared but NEITHER written NOR read → a key nobody uses, which reads to
 *   the next person as a supported control and to Firestore rules as one more
 *   thing a client may set.
 *
 * ## What this does not cover, stated plainly
 *
 * The roots below are where consent is written and read TODAY. A `consent.*`
 * write from a server route outside them — a bundle import, an admin tool —
 * is outside this guard, exactly as the deny-coverage guards say of a field
 * written by server code and declared nowhere. The mitigation is the same:
 * the roots include every app that has ever touched the host consent map, and
 * the non-vacuity case below fails if the scan stops finding the writes it is
 * built around.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'

import { declaredFields, stripComments } from './write-deny-coverage.util'

/** Repo root: this file is at `<root>/libs/aglyn/src/lib/foundation/definitions`. */
const REPO_ROOT = resolve(__dirname, '../../../../../..')

const HOST_TYPES_FILE =
  'libs/aglyn/src/lib/foundation/definitions/platform.types.ts'
const READER_FILE = 'libs/aglyn/src/lib/app-utils/visitor-consent.ts'

/**
 * Where a host consent key can be written or read from.
 *
 * `apps/console` is the only writer (the card's dotted-path `updateDoc`),
 * `libs/aglyn/src/lib/app-utils` holds every reader, and `apps/tenant` is
 * included because it is the runtime that would grow the next one — a reader
 * added there and nowhere else is precisely the change this guard should see.
 */
const SCAN_ROOTS: readonly string[] = [
  'apps/console',
  'apps/tenant',
  'libs/aglyn/src/lib/app-utils',
]

/** Build output and dependencies; `.next` in particular is enormous. */
const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'out',
  'coverage',
])

/**
 * Specs are excluded deliberately. A fixture is allowed to invent a key to
 * prove a reader ignores it, and counting fixtures as product usage would let
 * a test entrench a field the product does not have.
 */
function isScannableSource(name: string): boolean {
  if (!/\.tsx?$/.test(name)) return false
  return !/\.(spec|test)\.tsx?$/.test(name)
}

function collectSources(relativeRoot: string): string[] {
  const sources: string[] = []
  const walk = (absolute: string) => {
    for (const entry of readdirSync(absolute)) {
      if (SKIP_DIRECTORIES.has(entry)) continue
      const child = resolve(absolute, entry)
      if (statSync(child).isDirectory()) {
        walk(child)
        continue
      }
      if (isScannableSource(entry)) {
        sources.push(stripComments(readFileSync(child, 'utf8')))
      }
    }
  }
  walk(resolve(REPO_ROOT, relativeRoot))
  return sources
}

const sources = SCAN_ROOTS.flatMap(collectSources)

/**
 * A persisted dotted path — `updateDoc(ref, { 'consent.advertising': … })`.
 *
 * The quotes are what make this precise. `consent.stored`, `consent.ready`
 * and `consent.posture` are all over `site-analytics.tsx`, where `consent` is
 * the hook's return value and not the host map at all; an unquoted match
 * would read three React state fields as persisted schema.
 */
const WRITE_PATTERN = /['"]consent\.([A-Za-z_$][\w$]*)['"]/g

/**
 * A read THROUGH a host document: `host?.consent?.advertising`. Anchored on
 * `host` for the same reason — and the anchor is a suffix match, so
 * `consentHost.consent.mode` in the console preview counts too.
 */
const READ_PATTERN = /host\??\.\s*consent\??\.\s*([A-Za-z_$][\w$]*)/gi

function keysMatching(pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(pattern)) found.add(match[1])
  }
  return [...found].sort()
}

const written = keysMatching(WRITE_PATTERN)
const read = keysMatching(READ_PATTERN)

/**
 * The keys of the `consent?: {` map declared in one file.
 *
 * `declaredFields` strips comments and keeps only the block's own depth, so
 * the map is read without the doc comments describing it — the prose in both
 * files names all three keys, and a guard that read its own explanation would
 * pass on a schema that declared nothing.
 */
function consentKeysOf(relativePath: string): string[] {
  const source = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
  return declaredFields(source, 'consent?: {').sort()
}

describe('the host consent map is fully declared (AGL-1649)', () => {
  const declared = consentKeysOf(HOST_TYPES_FILE)
  const reader = consentKeysOf(READER_FILE)

  it('the scan still finds the controls it is built around', () => {
    // Non-vacuity. A moved file or a changed write style would otherwise
    // empty both sets and make every case below pass by finding nothing.
    expect(sources.length).toBeGreaterThan(100)
    expect(written).toEqual(expect.arrayContaining(['disabled', 'mode']))
    expect(read).toEqual(expect.arrayContaining(['disabled', 'mode']))
  })

  it('a host still has a control that obtains an advertising basis', () => {
    // The issue's own title, as an assertion. Advertising storage is denied
    // to every visitor until one explicitly allows it, and `consent.advertising`
    // is the ONLY thing that puts the question in front of them. Delete the
    // switch and the product is back to "no way for a host to obtain a basis
    // for it", with every other part of the feature still present and inert.
    expect(written).toContain('advertising')
    expect(read).toContain('advertising')
  })

  it('every written consent key is declared on AglynHost', () => {
    const undeclared = written.filter((key) => !declared.includes(key))
    expect({ undeclared, declared }).toEqual({ undeclared: [], declared })
  })

  it('every consent key read off a host is declared on AglynHost', () => {
    const undeclared = read.filter((key) => !declared.includes(key))
    expect({ undeclared, declared }).toEqual({ undeclared: [], declared })
  })

  it('every declared consent key is actually written or read', () => {
    const unused = declared.filter(
      (key) => !written.includes(key) && !read.includes(key),
    )
    expect({ unused, written, read }).toEqual({ unused: [], written, read })
  })

  it("the tenant reader's local host interface cannot outrun the schema", () => {
    // `VisitorConsentHost` is `visitor-consent.ts`'s own narrow view of the
    // host document. It is a second declaration of the same persisted map, so
    // it drifts the same way — and it is the one every gate reads through.
    const undeclared = reader.filter((key) => !declared.includes(key))
    expect({ undeclared, declared }).toEqual({ undeclared: [], declared })
  })
})
