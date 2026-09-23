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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  OUTREACH_COLLECTIONS,
  outreachOrgCollectionPath,
} from './outreach.types'

/**
 * The collection names are spelled in three places this plugin may not
 * import: the Firestore rules, the org erasure and the personal-data export
 * (AGL-2974). The last two live in a `scope:data` library the boundary keeps
 * away from a plugin, so each carries the name as a literal, and this spec is
 * what holds all four spellings to one. Read as source text, because the
 * thing that would drift IS the text.
 */

const REPO_ROOT = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('Outreach collection names (AGL-2974)', () => {
  it('builds the org-scoped paths under the organization', () => {
    expect(outreachOrgCollectionPath('org-1', 'mailboxes')).toBe(
      'orgs/org-1/outreachMailboxes',
    )
    expect(outreachOrgCollectionPath('org-1', 'sequences')).toBe(
      'orgs/org-1/outreachSequences',
    )
    expect(outreachOrgCollectionPath('org-1', 'enrollments')).toBe(
      'orgs/org-1/outreachEnrollments',
    )
  })

  it('names every collection in the Firestore rules', () => {
    const rules = read('cloud/firebase-firestore.rules')
    for (const name of Object.values(OUTREACH_COLLECTIONS)) {
      expect(rules).toMatch(new RegExp(`match /${name}/\\{`))
    }
  })

  it.each([OUTREACH_COLLECTIONS.mailboxCredentials, OUTREACH_COLLECTIONS.links])(
    'closes the top-level %s collection to every client',
    (name) => {
      const rules = read('cloud/firebase-firestore.rules')
      const block = rules.match(
        new RegExp(`match /${name}/\\{[^}]+\\}\\s*\\{([^}]*)\\}`),
      )
      expect(block?.[1]).toMatch(/allow read, write: if false;/)
    },
  )

  it.each([
    ['OUTREACH_MAILBOX_CREDENTIALS_COLLECTION', OUTREACH_COLLECTIONS.mailboxCredentials],
    ['OUTREACH_LINKS_COLLECTION', OUTREACH_COLLECTIONS.links],
  ])('is swept by the org erasure under the same spelling (%s)', (constant, name) => {
    const erase = read('libs/tenant/data/admin/src/lib/server/erase.ts')
    expect(erase).toContain(`const ${constant} = '${name}'`)
    expect(erase).toMatch(new RegExp(`deleteDocsByOrgId\\(\\s*${constant}`))
  })

  it.each([OUTREACH_COLLECTIONS.mailboxCredentials, OUTREACH_COLLECTIONS.links])(
    'has a disclosure decision in the personal-data export (%s)',
    (name) => {
      const exported = read(
        'libs/tenant/data/admin/src/lib/server/personal-data-export.ts',
      )
      expect(exported).toContain(`collection: '${name}'`)
    },
  )
})
