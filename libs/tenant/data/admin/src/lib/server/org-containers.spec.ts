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

import { pluginContainerKind } from '@aglyn/aglyn/plugin-manager/plugin-containers'
import {
  findOrgContainersByName,
  listOrgContainers,
  readOrgContainers,
} from './org-containers'

/**
 * A plugin that files records under a container reads the containers where
 * the kind's DECLARATION says they are, and only the facts the declaration
 * makes a contract: the id, the declared name field, `visibleTo` and
 * `deletedAt`. The double below is an org's documents by path; which path the
 * reader asks for is the assertion.
 */

type Doc = Record<string, unknown>

function firestoreWith(docs: Record<string, Doc>) {
  const reads: string[] = []
  const snapshot = (path: string) => ({
    id: path.split('/').pop() ?? '',
    exists: path in docs,
    get: (field: string) => docs[path]?.[field],
  })
  /** A query: its clauses, the projection it reads, and its window. */
  const query = (path: string, clause: [string, unknown] | null, fields: string[]): any => ({
    where: (field: string, _op: string, value: unknown) => query(path, [field, value], fields),
    select: (...selected: string[]) => query(path, clause, selected),
    limit: (n: number) => ({
      get: async () => {
        const where = clause ? `?${clause[0]}==${String(clause[1])}` : `?limit=${n}`
        reads.push(`${path}${where} [${fields.join(',')}]`)
        const keys = Object.keys(docs)
          .filter((key) => key.startsWith(`${path}/`))
          .filter((key) => !clause || docs[key][clause[0]] === clause[1])
          .slice(0, n)
        return { docs: keys.map(snapshot) }
      },
    }),
  })
  const collection = (path: string): any => ({
    path,
    doc: (id: string) => ({ path: `${path}/${id}` }),
    ...query(path, null, []),
  })
  const firestore: any = {
    collection: (name: string) => ({
      doc: (id: string) => ({ collection: (sub: string) => collection(`${name}/${id}/${sub}`) }),
    }),
    getAll: async (...refs: Array<{ path: string }>) => {
      reads.push(...refs.map((ref) => ref.path))
      return refs.map((ref) => snapshot(ref.path))
    },
  }
  return { firestore, reads }
}

const store = pluginContainerKind('campaign')?.orgCollection ?? ''

describe('the declared campaign kind', () => {
  it('is declared, so the reads below go where its owner keeps it', () => {
    expect(store).not.toBe('')
  })
})

describe('readOrgContainers', () => {
  it('answers each id asked, in order, from the declared collection', async () => {
    const { firestore, reads } = firestoreWith({
      [`orgs/org-1/${store}/spring`]: { name: ' Spring push ', visibleTo: ['org'] },
      [`orgs/org-1/${store}/old`]: { name: 'Old', visibleTo: ['host:h1'], deletedAt: 1 },
    })
    const found = await readOrgContainers(firestore, 'campaign', 'org-1', ['old', 'gone', 'spring'])
    expect(reads).toEqual([
      `orgs/org-1/${store}/old`,
      `orgs/org-1/${store}/gone`,
      `orgs/org-1/${store}/spring`,
    ])
    expect(found).toEqual([
      { id: 'old', exists: true, live: false, name: 'Old', visibleTo: ['host:h1'] },
      { id: 'gone', exists: false, live: false, name: '', visibleTo: [] },
      { id: 'spring', exists: true, live: true, name: 'Spring push', visibleTo: ['org'] },
    ])
  })

  it('answers an id that cannot be a document id as gone, without reading it', async () => {
    const { firestore, reads } = firestoreWith({})
    const found = await readOrgContainers(firestore, 'campaign', 'org-1', ['a/b', ''])
    expect(reads).toEqual([])
    expect(found.map((container) => container.exists)).toEqual([false, false])
  })

  it('reads nothing for a kind no plugin keeps', async () => {
    const { firestore, reads } = firestoreWith({})
    const found = await readOrgContainers(firestore, 'tasting', 'org-1', ['one'])
    expect(reads).toEqual([])
    expect(found).toEqual([{ id: 'one', exists: false, live: false, name: '', visibleTo: [] }])
  })
})

describe('listOrgContainers and findOrgContainersByName', () => {
  const docs = {
    [`orgs/org-1/${store}/a`]: { name: 'Spring', visibleTo: ['org'] },
    [`orgs/org-1/${store}/b`]: { name: 'Spring', visibleTo: ['host:h2'], deletedAt: 1 },
    [`orgs/org-2/${store}/c`]: { name: 'Spring', visibleTo: ['org'] },
  }

  it('lists the org’s containers in its window, retired ones marked', async () => {
    const { firestore, reads } = firestoreWith(docs)
    const found = await listOrgContainers(firestore, 'campaign', 'org-1', 10)
    const nameField = pluginContainerKind('campaign')?.nameField
    expect(reads).toEqual([`orgs/org-1/${store}?limit=10 [${nameField},deletedAt,visibleTo]`])
    expect(found.map((container) => [container.id, container.live])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('finds by the declared name field', async () => {
    const { firestore, reads } = firestoreWith(docs)
    const found = await findOrgContainersByName(firestore, 'campaign', 'org-1', ' Spring ', 10)
    const nameField = pluginContainerKind('campaign')?.nameField
    expect(reads).toEqual([
      `orgs/org-1/${store}?${nameField}==Spring [${nameField},deletedAt,visibleTo]`,
    ])
    expect(found.map((container) => container.id)).toEqual(['a', 'b'])
  })

  it('reads nothing for an empty name or a kind no plugin keeps', async () => {
    const { firestore, reads } = firestoreWith(docs)
    expect(await findOrgContainersByName(firestore, 'campaign', 'org-1', '  ', 10)).toEqual([])
    expect(await listOrgContainers(firestore, 'tasting', 'org-1', 10)).toEqual([])
    expect(reads).toEqual([])
  })
})
