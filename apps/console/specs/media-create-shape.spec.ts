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

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, relative, resolve } from 'path'

/**
 * Every route that MINTS a media document writes the same document
 * (AGL-1485).
 *
 * The defect this exists to prevent is not a missing field. It is a second
 * implementation: a legacy org-media upload route created
 * `orgs/{orgId}/media/{id}` with exactly `fileName, contentType, sizeBytes,
 * url, uploadedBy, createdAt` and never touched `counters/media`, while the
 * other creators produced the full shape. Three measured consequences —
 *
 * 1. the storage counter never moved, so the quota under-counted every asset
 *    landed through it, and AGL-1473 has since made that counter a billing
 *    input;
 * 2. no `contentHash` means `serveMediaCdn` emits **no ETag at all**
 *    (`serve-media-cdn.etag.spec.ts` measures exactly that), so a replaced
 *    asset can never propagate;
 * 3. no `storagePath` means the object's location is unrecorded, which blocks
 *    a folder move outright — a move copies then deletes, and the document
 *    does not say from where.
 *
 * That route was DELETED rather than repaired: its last caller went in
 * AGL-821 when every picker consolidated onto one DAM, so it was a fourth
 * door onto the same collection with no one behind it. Repairing it would
 * have left the divergence — six fields copied into a second implementation,
 * which is the shape AGL-1481 watched drift inside a week.
 *
 * The creators are **discovered**, not listed, because the thing that failed
 * was an inventory: AGL-1474 reasoned about two chokepoints and there were
 * four. A fifth creator is caught by arriving, not by being remembered.
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

/**
 * A creator, as opposed to the several routes that update or read a media
 * document: it allocates a NEW resource id and writes into a `media`
 * collection. `media/replace`, `media/folders`, `media/references`,
 * `media/sign` and `media/restore` all touch the collection without minting
 * anything, and are correctly not held to the create-time shape.
 */
const MEDIA_COLLECTION = "collection('media')"
const MINTS_AN_ID = 'createResourceUid'

const CREATORS = walk(
  resolve(REPO_ROOT, CONSOLE_API),
  (name) => name === 'route.ts',
)
  .filter((file) => {
    const source = read(file)
    return source.includes(MEDIA_COLLECTION) && source.includes(MINTS_AN_ID)
  })
  .map(repoPath)
  .sort()

/**
 * What a media document has to carry, and the consequence of omitting it —
 * the `why` is the assertion's real payload, since a bare field name reads
 * as style rather than as the counter drifting or the ETag vanishing.
 */
const REQUIRED: Array<{ token: string; why: string }> = [
  {
    token: 'storagePath',
    why: 'the object location; without it a folder move cannot copy-then-delete',
  },
  {
    token: 'contentHash',
    why: 'the CDN builds its ETag from this — no hash, no cache validator, ever',
  },
  {
    token: 'cdnPath',
    why: 'the field every picker and page node actually references',
  },
  {
    token: 'variants',
    why: 'the WebP set the CDN serves for `?w=`; absent reads as "not generated"',
  },
  {
    token: 'folderId',
    why: 'which folder the asset is in; absent collapses it into "No folder"',
  },
  {
    token: "collection('counters')",
    why: 'the storage counter that gates the quota and, since AGL-1473, bills',
  },
]

describe('AGL-1485 · every media creator writes the same document', () => {
  it('discovers the creators rather than trusting a list', () => {
    // Three today: `media/upload`, `media/upload-url` (finalize), and the
    // host/org split inside them. A fourth arriving is the event this whole
    // file exists for, and it arrives here rather than in production.
    expect(CREATORS.length).toBeGreaterThanOrEqual(2)
    expect(CREATORS).toContain('apps/console/app/api/media/upload/route.ts')
    expect(CREATORS).toContain('apps/console/app/api/media/upload-url/route.ts')
  })

  // Asserted on the list of MISSING fields rather than on the source, so a
  // failure prints the verdict instead of a 400-line handler — the idiom
  // `scoped-create-coverage.spec.ts` uses for the same reason.
  it.each(CREATORS)('%s writes the full shape', (file) => {
    const source = read(resolve(REPO_ROOT, file))
    const missing = REQUIRED.filter(
      ({ token }) => !source.includes(token),
    ).map(({ token, why }) => `${token} — ${why}`)
    expect(missing).toEqual([])
  })
})

/**
 * The same ground, one tier down: the SCRIPTS (AGL-1488).
 *
 * AGL-1485 attributed a measured 8-document / 561,000-byte shortfall on
 * `hosts/DXnRbPH4CQ` to the legacy route above. It cannot have been — that
 * route had no host branch at all. The actual generators were four Admin-SDK
 * call sites in `tools/scripts/**`, which write `{hosts|orgs}/{id}/media/{id}`
 * straight past every route and therefore past every counter write.
 *
 * The direction is always the same, which is why it went unnoticed: the
 * counter comes out LOW. A low `counters/media` measures the free tier's
 * 250 MB band against less storage than exists, so the customer is
 * UNDER-limited rather than locked out — and since AGL-1473 made the counter
 * a billing input, the metered plans UNDER-bill. Nothing complains.
 *
 * Discovered, not listed, for the reason the block above gives: the thing
 * that failed was an inventory. A script is a WRITER here if it names a media
 * collection and does something other than read it — so a fifth seed is
 * caught by arriving.
 */
const SHARED_MEDIA_WRITER = 'putMediaDocument'
const MEDIA_COLLECTION_MJS = "collection('media')"

/**
 * The module that DEFINES the shared writer, and its test. Excluded by path
 * because they are the fixed point of the rule, not exceptions to it.
 */
const MEDIA_WRITER_MODULE = ['tools', 'scripts', 'lib', 'media-counter'].join('/')

/**
 * Tokens that can bring a media document into EXISTENCE.
 *
 * This is the whole of what AGL-1488 is about. The shortfall it measured came
 * from documents being MINTED past the counter: bytes arrive, a document
 * appears, `counters/media` never moves, and the scope is under-reported for
 * good. `.set()` mints — including `set(…, { merge: true })`, which creates
 * the document when it is absent — and `.add()` mints.
 *
 * `.update()` does NOT, and that is a Firestore guarantee rather than a
 * convention: it throws on a missing document. A script that only ever
 * `update`s an existing media document cannot land bytes and cannot move the
 * counter's true value, so holding it to `putMediaDocument()` would mean
 * routing a one-field patch through a creator.
 */
const MEDIA_MINTING_TOKENS = ['.set(', '.add(']

/**
 * Can this script bring a media document into existence?
 *
 * Derived, never asserted by a name list — the thing that failed in AGL-1485
 * was an inventory, so a fifth seed has to be caught by arriving.
 *
 * A media reference is harmless when the chain hanging off it neither mints
 * nor is left open-ended. Two shapes qualify, and both are live in the tree:
 *
 *  * **Read.** `collection('media').get()`, or a query in between —
 *    `.orderBy(…).get()`, `.where(…).get()`. `backfill-media-refs.mjs` reads
 *    media to repair `nodes` on screens and forms and must not be held to a
 *    counter it never moves.
 *  * **Patch.** `collection('media')` … `.update(` with no mint token in the
 *    chain, which is `backfill-media-content-sha256.mjs` (AGL-1630) adding
 *    `contentSha256` to documents that already exist.
 *
 * The window examined is bounded rather than "the rest of the file" so a mint
 * three hundred lines later, in an unrelated function, does not condemn a
 * read — and is short enough that a mint on the SAME chain is always inside
 * it.
 */
const MEDIA_CHAIN_WINDOW = 160

function cannotMintMedia(source: string): boolean {
  const occurrences = source.split(MEDIA_COLLECTION_MJS).slice(1)
  return occurrences.every((rest) => {
    const chain = rest.slice(0, MEDIA_CHAIN_WINDOW)
    if (MEDIA_MINTING_TOKENS.some((token) => chain.includes(token))) return false
    return chain.includes('.get(') || chain.includes('.update(')
  })
}

/**
 * Both halves matter, and the second one is not decoration.
 *
 * Reaching a media collection BY HAND (`collection('media')`) is how a new
 * writer arrives, and it is what this must catch. But once a script is fixed
 * it no longer contains that token at all — so a rule that discovered only on
 * the raw token would empty itself out the moment the fix landed and pass
 * forever afterwards over zero files. That is the guard-that-cannot-fail
 * shape, and it is exactly what the first draft of this block did: it went
 * from four writers to none and reported green.
 *
 * Discovering on the helper too keeps the fixed callers in the list, so
 * un-wiring one is visible here rather than silent.
 */
const SCRIPT_MEDIA_WRITERS = walk(
  resolve(REPO_ROOT, 'tools'),
  (name) => name.endsWith('.mjs'),
)
  .filter((file) => {
    if (file.includes(MEDIA_WRITER_MODULE)) return false
    const source = read(file)
    const reachesByHand =
      source.includes(MEDIA_COLLECTION_MJS) && !cannotMintMedia(source)
    return reachesByHand || source.includes(SHARED_MEDIA_WRITER)
  })
  .map(repoPath)
  .sort()

describe('AGL-1488 · every script that writes media moves `counters/media`', () => {
  it('discovers the script writers rather than trusting a list', () => {
    // Four when this was filed — the demo seed (shared by the host and org
    // demo scripts), the e2e seed, the scope fixture and the blog-cover
    // migration — plus the lockdown e2e probe. A fifth arriving lands here.
    expect(SCRIPT_MEDIA_WRITERS.length).toBeGreaterThanOrEqual(4)
    expect(SCRIPT_MEDIA_WRITERS).toContain('tools/scripts/lib/seed-demo.mjs')
    expect(SCRIPT_MEDIA_WRITERS).toContain('tools/scripts/seed-e2e.mjs')
    expect(SCRIPT_MEDIA_WRITERS).toContain('tools/scripts/seed-scope-fixture.mjs')
    expect(SCRIPT_MEDIA_WRITERS).toContain('tools/scripts/migrate-blog-covers.mjs')
  })

  it('a read-only media consumer is not held to the counter', () => {
    // The negative control. Without it the rule above could be satisfied by a
    // predicate that matches everything, and "all writers comply" would be a
    // statement about nothing.
    expect(SCRIPT_MEDIA_WRITERS).not.toContain(
      'tools/scripts/backfill-media-refs.mjs',
    )
  })

  it('a script that only PATCHES an existing document is not either', () => {
    // AGL-1630's `contentSha256` backfill reaches media by hand and writes to
    // it — with `.update()`, which throws on a missing document and therefore
    // cannot mint one. It lands no bytes, so there is no counter to move, and
    // routing a one-field patch through `putMediaDocument()` would mean
    // calling a creator to avoid creating.
    expect(SCRIPT_MEDIA_WRITERS).not.toContain(
      'tools/scripts/backfill-media-content-sha256.mjs',
    )
  })

  it('the widened rule still catches every minting shape', () => {
    // The rule above got looser to admit a patcher, so this proves it did not
    // get loose. Each of these is a real way a media document arrives, and a
    // predicate that let any of them through would re-open AGL-1488.
    expect(cannotMintMedia("collection('media').doc(id).set({})")).toBe(false)
    expect(
      cannotMintMedia("collection('media').doc(id).set({}, { merge: true })"),
    ).toBe(false)
    expect(cannotMintMedia("collection('media').add({})")).toBe(false)
    // A chain that does nothing recognisable is treated as a mint, not waved
    // through: an unknown shape is exactly when this guard should speak up.
    expect(cannotMintMedia("collection('media').doc(id)")).toBe(false)
    // …and the two harmless shapes still read as harmless.
    expect(cannotMintMedia("collection('media').get()")).toBe(true)
    expect(
      cannotMintMedia("collection('media').orderBy('__name__').get()"),
    ).toBe(true)
    expect(cannotMintMedia("collection('media').doc(id).update({ a: 1 })")).toBe(
      true,
    )
  })

  it.each(SCRIPT_MEDIA_WRITERS)('%s writes through the shared helper', (file) => {
    // Not "contains an increment". The counter and the document have to be
    // written by the SAME function, or they drift again the first time a
    // caller returns early between them — which is how four call sites
    // arrived at the same omission independently.
    //
    // Asserted on a verdict rather than on the source, for the reason the
    // block above gives: a failure should print what is wrong, not 700 lines
    // of seed fixture.
    const source = read(resolve(REPO_ROOT, file))
    const verdict = source.includes(SHARED_MEDIA_WRITER)
      ? []
      : [
          `${file} writes a media document without \`${SHARED_MEDIA_WRITER}()\` — ` +
            'the document lands and `counters/media` does not move, so the ' +
            'scope is under-reported for good (AGL-1488)',
        ]
    expect(verdict).toEqual([])
  })
})

/**
 * The deletion itself. Assembled from segments so this file is not its own
 * counter-example when it scans the tree below.
 */
const LEGACY_ROUTE_DIR = ['apps/console/app', 'api', 'orgs', 'media'].join('/')
const LEGACY_ROUTE_PATH = ['api', 'orgs', 'media'].join('/')

describe('AGL-1485 · the legacy fourth creator is gone, not merely repaired', () => {
  it('the route file no longer exists', () => {
    expect(existsSync(resolve(REPO_ROOT, LEGACY_ROUTE_DIR, 'route.ts'))).toBe(
      false,
    )
  })

  it('no source file still reaches for it', () => {
    // Its only caller was `OrgMediaCard`, retired in AGL-821 when every
    // picker consolidated onto `MediaLibraryComponent` — which uploads
    // through `/api/media/upload`. Nothing has referenced it since, which is
    // what made deleting it the smaller change than repairing it.
    const sources = ['apps', 'libs', 'tools'].flatMap((root) =>
      walk(resolve(REPO_ROOT, root), (name) =>
        /\.(ts|tsx|mjs|cjs|js|jsx)$/.test(name),
      ),
    )
    const referencing = sources
      .filter((file) => read(file).includes(LEGACY_ROUTE_PATH))
      .map(repoPath)
    expect(referencing).toEqual([])
  })
})
