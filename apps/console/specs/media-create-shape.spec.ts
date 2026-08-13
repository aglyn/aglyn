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
