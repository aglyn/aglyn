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
 * Every write of what the media library filters by restamps its keys
 * (AGL-3330, on AGL-3327's `mediaFilterKeys`), swept across the repo.
 *
 * The library filters, sorts and searches a file by `kind`, `nameLower`,
 * `nameTokens`, `hasAlt` and `orientation`, derived from its `fileName`,
 * `contentType`, `alt` and size. A writer that changes one of those without
 * spreading `mediaFilterKeys` leaves a file the library still lists and that
 * its filter or search then answers wrongly — renamed but found by its old
 * name, given alt text but still listed as missing it. The one helper is
 * `mediaFilterKeys`, and this holds every writer to it.
 */

import {
  type DocumentWrite,
  documentWrites,
  readSource,
  trackedSources,
  withoutComments,
} from './document-writes'

/** The fields the filter keys are derived from. */
const SOURCE_FIELDS = /(?:^|[{,\s])(?:fileName|contentType|alt|width|height)\s*[:,}]/

/** What is wrong with one write, or nothing. */
function violation(write: DocumentWrite): string | null {
  return SOURCE_FIELDS.test(write.data) && !/\bmediaFilterKeys\(/.test(write.data)
    ? 'writes what the library filters by without mediaFilterKeys'
    : null
}

describe('AGL-3330 · every write of what the media library filters by restamps its keys', () => {
  const sites = (() => {
    const found: Array<{ file: string; write: DocumentWrite }> = []
    for (const file of trackedSources()) {
      const raw = readSource(file)
      if (!raw.includes("'media'") && !raw.includes('mediaRef')) continue
      for (const write of documentWrites(withoutComments(raw), 'media', 'mediaRef')) {
        found.push({ file, write })
      }
    }
    return found
  })()

  it('finds the writers it is meant to hold, so a silent pass means something', () => {
    const files = new Set(sites.map((site) => site.file))
    for (const file of [
      'apps/console/app/api/media/upload/route.ts',
      'apps/console/app/api/media/upload-url/route.ts',
      'apps/console/app/api/media/replace/route.ts',
      'apps/console/utils/api-v1-resources.ts',
      'apps/console/components/media/media-library.component.tsx',
      'libs/tenant/data/admin/src/lib/server/media-tombstone.ts',
    ]) {
      expect([file, files.has(file)]).toEqual([file, true])
    }
  })

  it('finds no write that skips the filter keys', () => {
    const offenders: string[] = []
    for (const { file, write } of sites) {
      const problem = violation(write)
      if (problem) offenders.push(`${file}: ${problem} — ${write.at}`)
    }
    expect(offenders.sort()).toEqual([])
  })

  it('refuses a bare alt edit, and passes one through the helper', () => {
    const [bare] = documentWrites(
      "await updateDoc(doc(firestore, 'hosts', hostId, 'media', id), { alt: next })",
      'media',
    )
    expect(violation(bare)).toBe('writes what the library filters by without mediaFilterKeys')
    const [stamped] = documentWrites(
      "await updateDoc(doc(firestore, 'hosts', hostId, 'media', id), { alt: next, ...mediaFilterKeys({ ...media, alt: next }) })",
      'media',
    )
    expect(violation(stamped)).toBeNull()
  })
})
