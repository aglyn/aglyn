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
 * Every write of a site artifact's name restamps the keys its list searches
 * by (AGL-3330, on AGL-3321's artifact list keys), swept across the repo.
 *
 * The screens, layouts, reusable components and templates lists search a
 * name by `nameLower` / `nameTokens` / `nameReversed`, which every create
 * stamps (`artifactCreateListKeys`) and every rename restamps
 * (`artifactRenameListKeys`). A writer that sets `displayName` without them
 * leaves an artifact that still lists and is found only by the name it used
 * to have — the stale-key gap the Forms list's audit found shared by these
 * four collections. The forms half is `form-writers-use-the-helpers.spec.ts`.
 */

import {
  type DocumentWrite,
  documentWrites,
  readSource,
  trackedSources,
  withoutComments,
} from './document-writes'

const COLLECTIONS = ['screens', 'layouts', 'components', 'templates'] as const

/** The helpers that stamp an artifact's name keys. */
const NAME_KEYS = /\b(?:artifactRenameListKeys|artifactCreateListKeys|displayNameSearchFields)\(/

/** What is wrong with one write, or nothing. */
function violation(write: DocumentWrite): string | null {
  const writesName = /(?:^|[{,\s])displayName\s*[:,}]/.test(write.data)
  return writesName && !NAME_KEYS.test(write.data)
    ? 'sets displayName without the artifact name keys'
    : null
}

describe('AGL-3330 · every write of an artifact name restamps its list keys', () => {
  const sites = (() => {
    const found: Array<{ file: string; collection: string; write: DocumentWrite }> = []
    for (const file of trackedSources()) {
      const raw = readSource(file)
      const named = COLLECTIONS.filter((collection) => raw.includes(`'${collection}'`))
      if (!named.length) continue
      const source = withoutComments(raw)
      for (const collection of named) {
        for (const write of documentWrites(source, collection)) found.push({ file, collection, write })
      }
    }
    return found
  })()

  it('finds the rename writers it is meant to hold, so a silent pass means something', () => {
    const renames = sites.filter(({ write }) => /(?:^|[{,\s])displayName\s*[:,}]/.test(write.data))
    expect(renames.length).toBeGreaterThan(0)
  })

  it('finds no write that sets a name without restamping its keys', () => {
    const offenders: string[] = []
    for (const { file, collection, write } of sites) {
      const problem = violation(write)
      if (problem) offenders.push(`${file} (${collection}): ${problem} — ${write.at}`)
    }
    expect(offenders.sort()).toEqual([])
  })

  it('refuses a bare rename, and passes one through the helper', () => {
    const [bare] = documentWrites(
      "await updateDoc(doc(firestore, 'hosts', hostId, 'layouts', id), { displayName: next, updatedAt: now })",
      'layouts',
    )
    expect(violation(bare)).toBe('sets displayName without the artifact name keys')
    const [stamped] = documentWrites(
      "await updateDoc(doc(firestore, 'hosts', hostId, 'layouts', id), { displayName: next, ...artifactRenameListKeys('layouts', next), updatedAt: now })",
      'layouts',
    )
    expect(violation(stamped)).toBeNull()
  })
})
