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
 * What `upsertHostContact` ANSWERS, and the profile it can now write
 * (AGL-2602).
 *
 * The door was `Promise<void>` for every capture that ever called it,
 * because a form or an order must not care what the CRM did. An import
 * cares row by row, so the door now returns a verdict — created, merged,
 * or refused with a name — and takes the per-holder profile (`facet`) and
 * `tags` an import carries. This file pins both against the same fake
 * merge-set `upsert-contact.spec.ts` uses, so a facet write that replaced
 * another holder's map, or a verdict that called a merge a create, goes red
 * here rather than in a customer's numbers.
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
let mockQuotaAllowed = true
let mockAddFails = false

/** A merge-set the way Firestore applies one: nested maps merged, unions applied. */
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

/** True when any value anywhere in the payload is `undefined` — the Admin SDK refuses those. */
function carriesUndefined(value: unknown): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.some(carriesUndefined)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(carriesUndefined)
  }
  return false
}

const contactsRef = {
  where: (field: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(contacts).filter(([, data]) => data[field] === wanted)
        return {
          empty: hits.length === 0,
          docs: hits.map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            data: () => data,
            ref: {
              set: async (payload: Record<string, any>, options?: { merge?: boolean }) => {
                if (!options?.merge) throw new Error('expected merge set')
                if (carriesUndefined(payload)) throw new Error('undefined in merge payload')
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
    if (mockAddFails) throw new Error('write failed')
    if (carriesUndefined(data)) throw new Error('undefined in add payload')
    added.push(data)
    const id = `auto-${added.length}`
    contacts[id] = JSON.parse(JSON.stringify(data))
    return { id }
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
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'free' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/campaign-membership'),
  ORG_SCOPE_TOKEN: 'org',
  checkContactQuota: () => ({ allowed: mockQuotaAllowed }),
}))

const facet = (id: string, groupId = 'h1') => contacts[id]?.facets?.[groupId] ?? {}

beforeEach(() => {
  for (const key of Object.keys(contacts)) delete contacts[key]
  added = []
  mockQuotaAllowed = true
  mockAddFails = false
})

describe('the verdict', () => {
  it('names an unusable address without touching the store', async () => {
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'nope',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
    })
    expect(verdict).toEqual({ refused: 'invalid-email' })
    expect(added).toEqual([])
  })

  it('says created, with the new id, for a person nobody held', async () => {
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'Ada@Example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
    })
    expect(verdict).toEqual({ contactId: 'auto-1', created: true })
    expect(contacts['auto-1'].email).toBe('ada@example.com')
  })

  it('says merged, with the existing id, for a person already held', async () => {
    contacts['c1'] = { email: 'ada@example.com', facets: { h1: { sources: {}, interactions: [] } } }
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'ada@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
    })
    expect(verdict).toEqual({ contactId: 'c1', created: false })
    expect(added).toEqual([])
  })

  it('says band when the free band refuses the create', async () => {
    mockQuotaAllowed = false
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
    })
    expect(verdict).toEqual({ refused: 'band' })
    expect(added).toEqual([])
  })

  it('says error, and still throws nothing, when the write fails', async () => {
    mockAddFails = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
    })
    spy.mockRestore()
    expect(verdict).toEqual({ refused: 'error' })
  })
})

describe('the profile and tags', () => {
  const profile = {
    phone: '+15125550123',
    jobTitle: 'Analyst',
    companyId: 'company-1',
    address: { line1: '1 Main', city: 'Austin', country: 'US' },
    ownerUid: 'u-1',
    lifecycleStage: 'customer' as const,
    custom: { seats: 12, tier: 'Gold' },
  }

  it('writes them into the capturing group facet on a create, and nowhere else', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'ada@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
      tags: [' VIP ', 'beta', 'vip'],
      facet: profile,
    })
    expect(facet('auto-1')).toMatchObject({
      ...profile,
      tags: ['vip', 'beta'],
      sources: { import: true },
    })
    // Nothing of the profile at the top of the shared row, where a sister
    // brand would read it.
    for (const key of Object.keys(profile)) {
      expect(contacts['auto-1'][key]).toBeUndefined()
    }
    expect(contacts['auto-1']['tags']).toBeUndefined()
  })

  it('merges them onto an existing facet without erasing what it held', async () => {
    contacts['c1'] = {
      email: 'ada@example.com',
      facets: {
        h1: {
          sources: { form: true },
          interactions: [],
          tags: ['hand-written'],
          notes: 'Met at the expo',
          jobTitle: 'Engineer',
          custom: { region: 'EMEA' },
        },
        h2: { sources: { order: true }, interactions: [], tags: ['theirs'] },
      },
    }
    const verdict = await upsertHostContact({
      hostId: 'h1',
      email: 'ada@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
      tags: ['vip'],
      facet: { phone: '+15125550123', custom: { seats: 12 } },
    })
    expect(verdict).toEqual({ contactId: 'c1', created: false })
    expect(facet('c1')).toMatchObject({
      sources: { form: true, import: true },
      tags: ['hand-written', 'vip'],
      notes: 'Met at the expo',
      // Not carried by this call, so not touched.
      jobTitle: 'Engineer',
      phone: '+15125550123',
      // Deep-merged: the file's key beside the hand-typed one.
      custom: { region: 'EMEA', seats: 12 },
    })
    expect(facet('c1', 'h2')).toEqual({ sources: { order: true }, interactions: [], tags: ['theirs'] })
  })

  it('never hands Firestore an undefined value', async () => {
    // The fake throws on `undefined` anywhere in a payload, the way the
    // Admin SDK does without `ignoreUndefinedProperties`.
    const create = await upsertHostContact({
      hostId: 'h1',
      email: 'a@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
      facet: { phone: undefined, jobTitle: 'Analyst', custom: { seats: undefined, tier: 'Gold' } },
    })
    expect(create).toEqual({ contactId: 'auto-1', created: true })
    expect(facet('auto-1')).toMatchObject({ jobTitle: 'Analyst', custom: { tier: 'Gold' } })
    expect('phone' in facet('auto-1')).toBe(false)
    const merge = await upsertHostContact({
      hostId: 'h1',
      email: 'a@example.com',
      source: 'import',
      interaction: { summary: 'Imported from CSV' },
      facet: { ownerUid: undefined, lifecycleStage: 'lead' },
    })
    expect(merge).toEqual({ contactId: 'auto-1', created: false })
    expect(facet('auto-1').lifecycleStage).toBe('lead')
  })
})
