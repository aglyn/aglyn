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
 * A contact's reports-to (AGL-3515): the loop check walks ONE holder's
 * chain, and the sweep a merge and an erasure run moves or clears every
 * pointer at a contact in each holder's facet — never leaving a contact
 * reporting to itself.
 */

import {
  contactReportsToLoops,
  CONTACT_REPORTS_TO_DEPTH,
  repointContactReportsTo,
} from './contact-reports-to'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: () => ({ __delete: true }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}))

type Doc = Record<string, any>
let docs: Record<string, Doc> = {}

/** The value at a dotted path. */
const at = (doc: Doc | undefined, path: string) =>
  path.split('.').reduce<any>((node, key) => (node == null ? undefined : node[key]), doc)

/** A dotted-path update, sentinels included. */
function applyUpdate(doc: Doc, patch: Doc): Doc {
  const next = JSON.parse(JSON.stringify(doc))
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let node = next
    for (const key of keys.slice(0, -1)) node = node[key] ??= {}
    const leaf = keys[keys.length - 1]
    if (value && typeof value === 'object' && '__delete' in value) delete node[leaf]
    else node[leaf] = value
  }
  return next
}

const contacts: any = {
  where: (path: string, _op: string, value: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(docs)
          .filter(([, doc]) => at(doc, path) === value)
          .map(([id]) => ({ id, ref: { id } }))
        return { empty: hits.length === 0, size: hits.length, docs: hits }
      },
    }),
  }),
}

const firestore: any = {
  batch: () => {
    const staged: Array<[string, Doc]> = []
    return {
      update: (ref: { id: string }, patch: Doc) => void staged.push([ref.id, patch]),
      commit: async () => {
        for (const [id, patch] of staged) docs[id] = applyUpdate(docs[id], patch)
      },
    }
  },
}

const holder = (reportsTo?: string) => ({
  facets: { g1: { sources: {}, interactions: [], ...(reportsTo ? { reportsToContactId: reportsTo } : {}) } },
})

beforeEach(() => {
  docs = {}
})

describe('contactReportsToLoops', () => {
  const read = async (id: string) => docs[id] ?? null

  it('finds a loop through the chain, and none where the chain ends', async () => {
    docs = { ann: holder('bob'), bob: holder('cat'), cat: holder() }
    expect(await contactReportsToLoops(read, 'cat', 'ann', 'g1')).toBe(true)
    expect(await contactReportsToLoops(read, 'dan', 'ann', 'g1')).toBe(false)
  })

  it("walks one holder's chain, not another's", async () => {
    docs = { ann: { facets: { g2: { reportsToContactId: 'cat' } } }, cat: holder() }
    expect(await contactReportsToLoops(read, 'cat', 'ann', 'g1')).toBe(false)
  })

  it('treats a chain past the depth as a loop, and a loop above the contact as none', async () => {
    for (let index = 0; index <= CONTACT_REPORTS_TO_DEPTH; index += 1) {
      docs[`p${index}`] = holder(`p${index + 1}`)
    }
    expect(await contactReportsToLoops(read, 'new', 'p0', 'g1')).toBe(true)
    docs = { ann: holder('bob'), bob: holder('ann') }
    expect(await contactReportsToLoops(read, 'cat', 'ann', 'g1')).toBe(false)
  })
})

describe('repointContactReportsTo', () => {
  it('moves every pointer to the survivor, and clears the survivor own', async () => {
    docs = { ann: holder('old'), bob: holder('old'), keep: holder('other'), survivor: holder('old') }
    const moved = await repointContactReportsTo(firestore, contacts, ['g1'], 'old', 'survivor', 'spec')
    expect(moved).toBe(3)
    expect(docs['ann'].facets.g1.reportsToContactId).toBe('survivor')
    expect(docs['bob'].facets.g1.reportsToContactId).toBe('survivor')
    expect(docs['keep'].facets.g1.reportsToContactId).toBe('other')
    expect(docs['survivor'].facets.g1).not.toHaveProperty('reportsToContactId')
  })

  it('clears every pointer at an erased person', async () => {
    docs = { ann: holder('gone'), bob: holder('gone') }
    await repointContactReportsTo(firestore, contacts, ['g1', 'g1', ''], 'gone', null, 'spec')
    expect(docs['ann'].facets.g1).not.toHaveProperty('reportsToContactId')
    expect(docs['bob'].facets.g1).not.toHaveProperty('reportsToContactId')
  })
})
