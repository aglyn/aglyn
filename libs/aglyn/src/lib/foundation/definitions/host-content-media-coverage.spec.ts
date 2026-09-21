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
 * (AGL-1867), and every collection in it is named by whoever owns it
 * (AGL-3080).
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
 *     scanned generically === sweep − CORE_CONTENT_COLLECTIONS − excluded
 *
 * in BOTH directions, where each side is now composed of core's own names and
 * the plugins' declarations. A plugin that adds a host subcollection fails the
 * build with one decision to make, and the default answer — scan it — is also
 * the safe one. A collection that goes away fails the build too, so the corpus
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
 * ## What moving the lists onto the plugins does not change
 *
 * The equality above is the same equality, and it is asserted over the same
 * sweep. What changed is where the answer is written: core holds its own three
 * lists, each plugin holds its own, and this spec adds the one question the
 * split makes possible — that no collection is claimed twice, by two plugins
 * or by a plugin and core.
 *
 * FORCED RED, and each of these was run before this was committed: drop
 * `products` from commerce's `hostCollections` and the coverage case fails
 * naming `hosts/{hostId}/products`; declare `counters` — which core owns — on
 * the CRM and the ownership case fails naming it; declare `products` on a
 * second plugin and the generator refuses to write the manifest at all,
 * naming both claimants.
 *
 * ## What this guard does NOT catch, stated so nobody trusts it to
 *
 * A FALSE exclusion. `mediaScan: "none"` with a plausible sixty-character
 * reason passes every case here, because no test can tell a true account of
 * what scanning would cost from a convincing one. That was equally true of
 * the hand-kept list this replaced, and the control is the same: the reason
 * is written down, in a reviewed file, next to the plugin that would benefit
 * from the shortcut. The teeth here are on the failures a person cannot see —
 * a collection nobody classified, one nobody writes any more, one classified
 * twice, and one claimed by two owners.
 */

import { readFileSync, readdirSync } from 'fs'
import type { Dirent } from 'fs'
import { join, resolve } from 'path'

import {
  listPluginHostCollections,
  pluginHostCollectionLabel,
  pluginHostCollectionsExcludedFromMediaScan,
  pluginHostCollectionsScannedGenerically,
} from '../../plugin-manager/plugin-host-collections'
import {
  CORE_CONTENT_COLLECTIONS,
  CORE_GENERIC_SCAN_COLLECTIONS,
  hostContentCollectionLabel,
  MEDIA_SCAN_EXCLUDED,
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

/** Every collection the scan reads generically: core's own, then the plugins'. */
const scannedGenerically = [
  ...CORE_GENERIC_SCAN_COLLECTIONS,
  ...pluginHostCollectionsScannedGenerically(),
]

/** Every collection deliberately not read, with the reason and who gave it. */
const excluded: Array<{ name: string; reason: string; by: string }> = [
  ...Object.entries(MEDIA_SCAN_EXCLUDED).map(([name, reason]) => ({
    name,
    reason,
    by: 'core',
  })),
  ...pluginHostCollectionsExcludedFromMediaScan().map((one) => ({
    name: one.name,
    reason: one.reason,
    by: one.pluginId,
  })),
]
const excludedNames = new Set(excluded.map((one) => one.name))

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

  it('reads the plugins\' own declarations, not an empty registry', () => {
    // The floor for the half that moved. The declarations are COMPILED from
    // plugins.config.json precisely so this list is never empty in a process
    // that loaded no plugin — and if that ever stops being true, every
    // assertion below starts comparing core's three names against a sweep of
    // sixty and fails loudly rather than passing vacuously. This case is here
    // to say which failure it is.
    expect(listPluginHostCollections().length).toBeGreaterThanOrEqual(40)
    expect(listPluginHostCollections().map((one) => one.name)).toEqual(
      expect.arrayContaining(['products', 'campaigns', 'services', 'orders']),
    )
  })

  it('scans every host subcollection that is not core or excluded', () => {
    const shouldScan = hostSubcollectionsInRepo.filter(
      (name) =>
        !(CORE_CONTENT_COLLECTIONS as readonly string[]).includes(name) &&
        !excludedNames.has(name),
    )
    const missing = shouldScan.filter((name) => !scannedGenerically.includes(name))
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
          `Decide, on this commit, in the "hostCollections" block of the ` +
          `plugin that writes it in plugins.config.json — or, if core writes ` +
          `it, in host-content-collections.ts:\n` +
          `  • scanned — name it, and nothing else. This is the DEFAULT and ` +
          `the safe answer: the scan reads documents generically, so it needs ` +
          `no field list and no schema knowledge. Add "routeSlug" (one of ` +
          `that plugin's own console routes) so the row deep-links somewhere;\n` +
          `  • not scanned — add "mediaScan": "none" with a ` +
          `"mediaScanReason" saying what scanning it would COST or what it ` +
          `would get WRONG. "It probably has no images in it" is not a ` +
          `reason — that guess is the whole failure this guard exists to stop.`,
      )
    }
  })

  it('names no collection the repo has stopped using', () => {
    const stale = [
      ...scannedGenerically,
      ...excludedNames,
      ...CORE_CONTENT_COLLECTIONS,
    ].filter((name) => !hostSubcollectionsInRepo.includes(name))
    // A corpus entry for a collection nothing writes is a per-host query per
    // scan that can never match, and an exclusion for one is a decision about
    // something that no longer exists — the stale entry the deny-coverage
    // guard's header warns is where the next hole hides.
    expect(stale).toEqual([])
  })

  it('classifies each collection exactly once', () => {
    for (const name of scannedGenerically) {
      // Scanned AND excluded is a contradiction, and the runtime would resolve
      // it silently in whichever direction the code happened to check first.
      expect([name, excludedNames.has(name)]).toEqual([name, false])
      expect([
        name,
        (CORE_CONTENT_COLLECTIONS as readonly string[]).includes(name),
      ]).toEqual([name, false])
    }
    for (const name of CORE_CONTENT_COLLECTIONS) {
      expect([name, excludedNames.has(name)]).toEqual([name, false])
    }
    expect(new Set(scannedGenerically).size).toBe(scannedGenerically.length)
  })

  it('gives every collection exactly one owner', () => {
    // The split's own failure mode. Two plugins writing one collection under
    // one site would be two schemas in one place, and the scan, the deep link
    // and the artifact counters would each pick a winner by declaration order.
    const declared = listPluginHostCollections()
    const owners = new Map<string, string[]>()
    for (const one of declared) {
      owners.set(one.name, [...(owners.get(one.name) ?? []), one.pluginId])
    }
    expect(
      [...owners.entries()]
        .filter(([, holders]) => holders.length > 1)
        .map(([name, holders]) => `${name}: ${holders.join(', ')}`),
    ).toEqual([])
    // And core does not name what a plugin owns — the whole point of the move.
    const coreNames = [
      ...CORE_CONTENT_COLLECTIONS,
      ...CORE_GENERIC_SCAN_COLLECTIONS,
      ...Object.keys(MEDIA_SCAN_EXCLUDED),
    ]
    expect(coreNames.filter((name) => owners.has(name))).toEqual([])
  })

  it('makes every exclusion say what it costs or what it gets wrong', () => {
    for (const { name, reason, by } of excluded) {
      // Length is a crude proxy and it is the honest one available: the entries
      // that rot are the ones somebody added in a hurry, and a one-liner is
      // what that looks like.
      expect([`${by}/${name}`, reason.length > 60]).toEqual([`${by}/${name}`, true])
    }
  })

  it('routes plugin rows only to collections it actually scans', () => {
    for (const one of listPluginHostCollections()) {
      if (!one.routeSlug) continue
      expect([one.name, scannedGenerically.includes(one.name)]).toEqual([
        one.name,
        true,
      ])
    }
    // The known gap is deliberate and stated: a scanned collection with no
    // slug still produces a ROW, it just renders as text. Coverage never waits
    // on a deep link.
    expect(
      scannedGenerically.filter(
        (name) =>
          !listPluginHostCollections().some(
            (one) => one.name === name && one.routeSlug,
          ),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('labels a collection the way the console says it', () => {
    expect(hostContentCollectionLabel('products')).toBe('Product')
    expect(hostContentCollectionLabel('productCategories')).toBe(
      'Product category',
    )
    expect(hostContentCollectionLabel('memberPosts')).toBe('Member post')
    // A plugin may say it better than the derivation can: `settings` derives
    // to "Setting", which tells an author nothing about which settings.
    expect(hostContentCollectionLabel('settings')).toBe('Setting')
    expect(pluginHostCollectionLabel('settings')).toBe('Store settings')
    // Never the raw camelCase id, for any scanned collection — a "where is
    // this used" row that says `productCategories` is the one thing such a
    // list must not do.
    for (const name of scannedGenerically) {
      const label = pluginHostCollectionLabel(name)
      expect([name, label]).not.toEqual([name, name])
      expect([name, /[A-Z]/.test(label.slice(1))]).toEqual([name, false])
    }
  })
})
