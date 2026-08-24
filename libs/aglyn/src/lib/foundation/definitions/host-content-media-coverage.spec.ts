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
 * The media usage scan's corpus is DERIVED from the repo, not remembered
 * (AGL-1867).
 *
 * `scanMediaReferences` is what an author consults immediately before deleting
 * an asset, and every way it can be wrong points at "unused" — a document it
 * never read and a document with genuinely no reference produce the same empty
 * list. So the dangerous mistake is not a wrong entry in the corpus list; it is
 * a MISSING one, which nothing about the running code can notice.
 *
 * This is the thing that notices. It sweeps `apps/**` and `libs/**` for host
 * subcollection names — the same derived sweep, with the same three anchored
 * path shapes, that `host-subcollection-write-deny-coverage.spec.ts` uses to
 * keep the Firestore rules honest — and asserts:
 *
 *     PLUGIN_CONTENT_COLLECTIONS === sweep − CORE_CONTENT_COLLECTIONS
 *                                         − MEDIA_SCAN_EXCLUDED
 *
 * in BOTH directions. A plugin that adds a host subcollection fails the build
 * with one decision to make, and the default answer — scan it — is also the
 * safe one. A collection that goes away fails the build too, so the corpus
 * cannot keep naming documents nobody writes any more.
 *
 * ## Why the equality is exact rather than a subset check
 *
 * A one-sided assertion ("everything scanned exists") would let a new
 * collection appear and stay unscanned forever, which is precisely the bug.
 * A one-sided assertion the other way ("everything that exists is scanned")
 * would forbid the exclusions, which are real and reasoned. The exact equality
 * is what makes the third state — "somebody looked at this and wrote down why
 * not" — the only way a collection can be outside the corpus.
 *
 * FORCED RED, both directions, and both were run before this was committed:
 * delete `'products'` from `PLUGIN_CONTENT_COLLECTIONS` and the first case
 * fails naming it; add `'products'` to `MEDIA_SCAN_EXCLUDED` and it fails
 * naming it as double-classified.
 */

import { readFileSync, readdirSync } from 'fs'
import type { Dirent } from 'fs'
import { join, resolve } from 'path'

import {
  CORE_CONTENT_COLLECTIONS,
  hostContentCollectionLabel,
  MEDIA_SCAN_EXCLUDED,
  PLUGIN_CONTENT_COLLECTIONS,
  PLUGIN_CONTENT_ROUTE_SLUG,
} from './host-content-collections'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SOURCE_ROOTS = ['apps', 'libs']

/**
 * Built output and agent worktrees.
 *
 * `.claude/worktrees` matters here in a way it does not for a `.next` bundle:
 * a worktree is a full second checkout of this repo, so a name another agent is
 * mid-way through adding would be swept in as if it were committed, and this
 * guard would demand a classification for a collection that does not exist on
 * this branch.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nx',
  'coverage',
  'out',
  '.turbo',
  '.claude',
])

const hostSubcollectionsInRepo = (() => {
  const files: string[] = []
  const walk = (directory: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      // Specs excluded for the deny-coverage guard's reason: a fixture path in
      // a test is not a storage decision, and demanding a corpus entry for one
      // would train people to add names they do not mean.
      if (/\.(spec|test)\.tsx?$/.test(entry.name)) continue
      files.push(path)
    }
  }
  for (const root of SOURCE_ROOTS) walk(resolve(REPO_ROOT, root))

  // Three shapes, all anchored on the host. A bare `.collection('x')` would
  // sweep in every nested and org-level collection in the repo — `versions`
  // hangs off a screen, not off the host, and demanding the media scan treat
  // it as a top-level corpus member would be nonsense.
  const patterns = [
    /'hosts',\s*[A-Za-z0-9_.$[\]]+,\s*'([A-Za-z][A-Za-z0-9]*)'/g,
    /\.collection\(\s*'hosts'\s*\)\s*\.doc\([^()]*\)\s*\.collection\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*\)/g,
    /\b(?:hostRef|hostDoc|host\.ref)\s*\.\s*collection\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*\)/g,
  ]
  const found = new Set<string>()
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    for (const pattern of patterns) {
      for (const hit of source.matchAll(pattern)) found.add(hit[1])
    }
  }
  return [...found].sort()
})()

describe('the media usage corpus is derived from the repo (AGL-1867)', () => {
  it('sweeps a plausible set of host subcollections off the source tree', () => {
    // The floor, and the reason it is first. A regex that stopped matching
    // would empty this sweep and leave every assertion below comparing two
    // empty sets — forever green, having proved nothing. That is worse than no
    // guard, because this one is believed.
    expect(hostSubcollectionsInRepo.length).toBeGreaterThanOrEqual(40)
    expect(hostSubcollectionsInRepo).toEqual(
      expect.arrayContaining([
        'screens',
        'emailTemplates',
        'products',
        'counters',
        'collections',
      ]),
    )
  })

  it('scans every host subcollection that is not core or excluded', () => {
    const shouldScan = hostSubcollectionsInRepo.filter(
      (name) =>
        !(CORE_CONTENT_COLLECTIONS as readonly string[]).includes(name) &&
        !(name in MEDIA_SCAN_EXCLUDED),
    )
    const missing = shouldScan.filter(
      (name) => !(PLUGIN_CONTENT_COLLECTIONS as readonly string[]).includes(name),
    )
    if (missing.length > 0) {
      throw new Error(
        `These host subcollections exist in the codebase and the media usage ` +
          `scan does not read them:\n\n` +
          `${missing.map((name) => `  • hosts/{hostId}/${name}`).join('\n')}\n\n` +
          `That panel is what an author reads immediately before deleting a ` +
          `file, and a collection outside its corpus comes back as an empty ` +
          `list — indistinguishable from "nothing uses this". AGL-1867 was ` +
          `exactly this for \`products\`: a photo used only on a product ` +
          `reported as unused, and the author was invited to delete it.\n\n` +
          `Decide, on this commit, in ` +
          `libs/aglyn/src/lib/foundation/definitions/host-content-collections.ts:\n` +
          `  • scanned — add the name to PLUGIN_CONTENT_COLLECTIONS. This is ` +
          `the DEFAULT and the safe answer: the scan reads documents ` +
          `generically, so it needs no field list and no schema knowledge, ` +
          `and optionally a PLUGIN_CONTENT_ROUTE_SLUG entry so the row deep-` +
          `links somewhere;\n` +
          `  • not scanned — add it to MEDIA_SCAN_EXCLUDED with a reason ` +
          `saying what scanning it would COST or what it would get WRONG. ` +
          `"It probably has no images in it" is not a reason — that guess is ` +
          `the whole failure this guard exists to stop.`,
      )
    }
  })

  it('names no collection the repo has stopped using', () => {
    const stale = [
      ...PLUGIN_CONTENT_COLLECTIONS,
      ...Object.keys(MEDIA_SCAN_EXCLUDED),
      ...CORE_CONTENT_COLLECTIONS,
    ].filter((name) => !hostSubcollectionsInRepo.includes(name))
    // A corpus entry for a collection nothing writes is a per-host query per
    // scan that can never match, and an exclusion for one is a decision about
    // something that no longer exists — the stale entry the deny-coverage
    // guard's header warns is where the next hole hides.
    expect(stale).toEqual([])
  })

  it('classifies each collection exactly once', () => {
    for (const name of PLUGIN_CONTENT_COLLECTIONS) {
      // Scanned AND excluded is a contradiction, and the runtime would resolve
      // it silently in whichever direction the code happened to check first.
      expect([name, name in MEDIA_SCAN_EXCLUDED]).toEqual([name, false])
      expect([
        name,
        (CORE_CONTENT_COLLECTIONS as readonly string[]).includes(name),
      ]).toEqual([name, false])
    }
    for (const name of CORE_CONTENT_COLLECTIONS) {
      expect([name, name in MEDIA_SCAN_EXCLUDED]).toEqual([name, false])
    }
    expect(new Set(PLUGIN_CONTENT_COLLECTIONS).size).toBe(
      PLUGIN_CONTENT_COLLECTIONS.length,
    )
  })

  it('makes every exclusion say what it costs or what it gets wrong', () => {
    for (const [name, reason] of Object.entries(MEDIA_SCAN_EXCLUDED)) {
      // Length is a crude proxy and it is the honest one available: the entries
      // that rot are the ones somebody added in a hurry, and a one-liner is
      // what that looks like.
      expect([name, reason.length > 60]).toEqual([name, true])
    }
  })

  it('routes plugin rows only to collections it actually scans', () => {
    for (const collection of Object.keys(PLUGIN_CONTENT_ROUTE_SLUG)) {
      expect([
        collection,
        (PLUGIN_CONTENT_COLLECTIONS as readonly string[]).includes(collection),
      ]).toEqual([collection, true])
    }
    // The known gap is deliberate and stated: a scanned collection with no
    // slug still produces a ROW, it just renders as text. Coverage never waits
    // on a deep link.
    expect(
      PLUGIN_CONTENT_COLLECTIONS.filter(
        (name) => !(name in PLUGIN_CONTENT_ROUTE_SLUG),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('labels a collection the way the console says it', () => {
    expect(hostContentCollectionLabel('products')).toBe('Product')
    expect(hostContentCollectionLabel('productCategories')).toBe(
      'Product category',
    )
    expect(hostContentCollectionLabel('memberPosts')).toBe('Member post')
    expect(hostContentCollectionLabel('settings')).toBe('Setting')
    // Never the raw camelCase id, for any scanned collection — a "where is
    // this used" row that says `productCategories` is the one thing such a
    // list must not do.
    for (const name of PLUGIN_CONTENT_COLLECTIONS) {
      const label = hostContentCollectionLabel(name)
      expect([name, label]).not.toEqual([name, name])
      expect([name, /[A-Z]/.test(label.slice(1))]).toEqual([name, false])
    }
  })
})
