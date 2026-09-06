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
 * `upsertHostContact` writes a capture's custom field values into the
 * HOLDER's facet, key by key (AGL-2601).
 *
 * Three things have to hold, and each is what a plausible wrong write would
 * break:
 *
 *  1. A NEW contact carries the values under its capturing group's facet —
 *     not at the top of the shared row, where every other holder could read
 *     a value one business collected.
 *  2. An EXISTING contact keeps every `custom` key the capture did not name.
 *     The write is a merge-set, and a `custom` map written whole would take
 *     the ten values a merchant typed by hand out with the two a form sent.
 *  3. A sister group sees none of it.
 *
 * The fake applies a merge-set the way Firestore does — nested maps merged,
 * not replaced — because that is the exact property under test: a shallow
 * fake would pass a whole-map overwrite.
 */

import { upsertHostContact } from './upsert-contact'

jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Record<string, any>[] = []

/** A merge-set as Firestore applies one: nested maps MERGED, never replaced. */
function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('__serverTimestamp' in value) &&
      !('__arrayUnion' in value)
    ) {
      target[key] = { ...(target[key] ?? {}) }
      mergeApply(target[key], value)
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(target[key]) ? target[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      target[key] = current
    } else {
      target[key] = value
    }
  }
}

const contactsRef = {
  where: (field: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(contacts).filter(
          ([, data]) => data[field] === wanted,
        )
        return {
          empty: hits.length === 0,
          docs: hits.map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            data: () => data,
            ref: {
              set: async (
                payload: Record<string, any>,
                options?: { merge?: boolean },
              ) => {
                if (!options?.merge) throw new Error('expected merge set')
                mergeApply(data, payload)
              },
            },
          })),
        }
      },
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(contacts).length }) }),
  }),
  add: async (data: Record<string, any>) => {
    added.push(data)
    return { id: `auto-${added.length}` }
  },
}

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: async () => undefined }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/campaign-membership'),
  ORG_SCOPE_TOKEN: 'org',
  checkContactQuota: () => ({ allowed: true }),
}))

const facet = (id: string, groupId = 'h1') =>
  contacts[id]?.facets?.[groupId] ?? {}

describe('upsertHostContact writes custom field values into the facet', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
  })

  it('a NEW contact carries them under the capturing group, not at the top', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'form',
      interaction: { refId: 'f1', summary: 'Submitted a form' },
      facet: { custom: { tier: 'Gold', annual_revenue: 1200 } },
    })
    expect(added).toHaveLength(1)
    expect(added[0].facets.h1.custom).toEqual({ tier: 'Gold', annual_revenue: 1200 })
    expect(added[0].custom).toBeUndefined()
  })

  it('an EXISTING contact keeps every key the capture did not name', async () => {
    contacts['c1'] = {
      email: 'kept@example.com',
      sources: { form: true },
      interactions: [],
      facets: {
        h1: {
          sources: { form: true },
          interactions: [],
          custom: { vip: true, nickname: 'Robin', tier: 'Silver' },
        },
      },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'kept@example.com',
      source: 'form',
      interaction: { refId: 'f2', summary: 'Submitted a form' },
      facet: { custom: { tier: 'Gold' } },
    })
    // The one key the form mapped moved; the two it did not are untouched.
    expect(facet('c1').custom).toEqual({ vip: true, nickname: 'Robin', tier: 'Gold' })
    // And the rest of the facet is still there beside them.
    expect(facet('c1').sources).toEqual({ form: true })
  })

  it('a sister group sees none of it', async () => {
    contacts['c1'] = {
      email: 'shared@example.com',
      sources: { form: true },
      interactions: [],
      facets: { h2: { sources: { form: true }, interactions: [], custom: { theirs: 1 } } },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'shared@example.com',
      source: 'form',
      interaction: { refId: 'f3', summary: 'Submitted a form' },
      facet: { custom: { tier: 'Gold' } },
    })
    expect(facet('c1', 'h1').custom).toEqual({ tier: 'Gold' })
    expect(facet('c1', 'h2').custom).toEqual({ theirs: 1 })
  })

  it('writes no `custom` at all when the capture carried none', async () => {
    contacts['c1'] = {
      email: 'plain@example.com',
      sources: { form: true },
      interactions: [],
      facets: { h1: { sources: { form: true }, interactions: [] } },
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'plain@example.com',
      source: 'form',
      interaction: { refId: 'f4', summary: 'Submitted a form' },
      facet: { custom: {} },
    })
    expect(facet('c1')).not.toHaveProperty('custom')
    await upsertHostContact({
      hostId: 'h1',
      email: 'newer@example.com',
      source: 'form',
      interaction: { refId: 'f5', summary: 'Submitted a form' },
    })
    expect(added[0].facets.h1).not.toHaveProperty('custom')
  })
})
