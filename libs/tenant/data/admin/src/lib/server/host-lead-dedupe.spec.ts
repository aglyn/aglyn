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
 * One person is one lead document.
 *
 * A lead was append-only and keyed by nothing, so a returning customer who
 * signed up and then booked twice was three "leads" — and the Members & leads
 * tab presented that list of events as a list of people. The only thing
 * holding two rows for one person together was string equality on the address
 * at render time.
 *
 * The capacity assertions are the other half and they are not decoration. A
 * ceiling that refuses an EXISTING person's update buys no capacity — the
 * write does not grow the collection — and costs the customer the data. That
 * is enforcement at use, which is the shape the capacity rule forbids.
 */

import { personKey } from '@aglyn/aglyn/server'

const HOST_ID = 'site-1'

/** `leads/{id}` → stored document. */
let leads: Record<string, Record<string, any>> = {}
let counterWrites: Array<Record<string, any>> = []
let autoIdCounter = 0

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

jest.mock('./notifications', () => ({
  __esModule: true,
  notifyHostManagers: async () => undefined,
}))

const attributeCampaignConversion = jest.fn(async () => null)
jest.mock('./campaign-conversion-attribution', () => ({
  __esModule: true,
  attributeCampaignConversion: (...args: unknown[]) =>
    (attributeCampaignConversion as any)(...args),
}))

/**
 * Applies a `set(..., { merge: true })` the way Firestore does, including the
 * two sentinels this writer depends on. A fake that ignored `arrayUnion` and
 * `increment` would let a write that clobbers `sources` pass.
 */
const applyMerge = (
  existing: Record<string, any> | undefined,
  patch: Record<string, any>,
): Record<string, any> => {
  const next = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__increment' in value) {
      next[key] = Number(next[key] ?? 0) + (value as any).__increment
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(next[key]) ? next[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      next[key] = current
    } else {
      next[key] = value
    }
  }
  return next
}

const leadDoc = (id: string) => ({
  id,
  get: async () => ({
    exists: leads[id] !== undefined,
    id,
    get: (field: string) => leads[id]?.[field],
  }),
})

const leadsCollection = {
  doc: (id?: string) => leadDoc(id ?? `auto-${(autoIdCounter += 1)}`),
  count: () => ({ __count: true }),
}

const hostRef: any = {
  firestore: {
    runTransaction: async (body: (tx: any) => Promise<boolean>) => {
      const tx = {
        get: async (target: any) => {
          if (target?.__count) {
            return { data: () => ({ count: Object.keys(leads).length }) }
          }
          return target.get()
        },
        set: (ref: any, patch: Record<string, any>) => {
          leads[ref.id] = applyMerge(leads[ref.id], patch)
        },
      }
      return body(tx)
    },
  },
  collection: (name: string) =>
    name === 'leads'
      ? leadsCollection
      : {
          doc: () => ({
            get: async () => ({ get: () => 0 }),
            set: async (patch: Record<string, any>) => {
              counterWrites.push(patch)
            },
          }),
        },
}

import { addHostLead } from './host-visitor-records'

const capture = (lead: Record<string, any>, ceiling?: number) =>
  addHostLead({
    hostRef,
    hostId: HOST_ID,
    lead: { email: 'visitor@example.com', source: 'signup', ...lead } as any,
    ...(ceiling === undefined ? {} : { ceiling }),
  })

beforeEach(() => {
  leads = {}
  counterWrites = []
  autoIdCounter = 0
  attributeCampaignConversion.mockClear()
})

describe('one person submitting twice is one lead', () => {
  it('writes ONE document for two captures of the same address', async () => {
    // THE assertion. Two captures, one person, one row.
    await capture({ source: 'signup' })
    await capture({ source: 'booking' })
    expect(Object.keys(leads)).toHaveLength(1)
  })

  it('keys the document on personKey, not an auto-id', async () => {
    await capture({})
    expect(Object.keys(leads)).toEqual([personKey('visitor@example.com')])
  })

  it('folds casing and whitespace onto the same person', async () => {
    // `Bob@x.com` and `bob@x.com` are one person. The normalizer runs inside
    // `personKey`, so a caller cannot forget to apply it.
    await capture({ email: 'Visitor@Example.com ' })
    await capture({ email: 'visitor@example.com' })
    expect(Object.keys(leads)).toHaveLength(1)
  })

  it('keeps every surface that produced a capture', async () => {
    // The EVENTS are not lost, they stop being the record.
    await capture({ source: 'signup' })
    await capture({ source: 'booking' })
    await capture({ source: 'booking' })
    const lead = leads[personKey('visitor@example.com') as string]
    expect(lead?.['sources']).toEqual(['signup', 'booking'])
    expect(lead?.['submissionCount']).toBe(3)
  })

  it('brackets the captures with a first and last timestamp', async () => {
    await capture({})
    const lead = leads[personKey('visitor@example.com') as string]
    const firstSeen = lead?.['firstSeenAtMs']
    await capture({})
    const after = leads[personKey('visitor@example.com') as string]
    expect(after?.['firstSeenAtMs']).toBe(firstSeen)
    expect(after?.['lastSeenAtMs']).toBeGreaterThanOrEqual(firstSeen)
  })

  it('keeps a lead with an unusable address as its own row', async () => {
    // `personKey` answers null rather than guessing. Merging several
    // unusable addresses under one invented id would merge two people, which
    // is worse than two rows for one.
    await capture({ email: 'not-an-address' })
    await capture({ email: 'also-not-one' })
    expect(Object.keys(leads)).toHaveLength(2)
  })
})

describe('consent is carried forward and never cleared', () => {
  it('leaves an earlier opt-in standing when a later capture carries none', async () => {
    // ⛔ A merge must never be the moment a person loses an opt-in.
    await capture({ marketingConsent: true })
    await capture({ source: 'booking' })
    const lead = leads[personKey('visitor@example.com') as string]
    expect(lead?.['marketingConsent']).toBe(true)
  })

  it('never invents one', async () => {
    await capture({})
    await capture({ source: 'booking' })
    const lead = leads[personKey('visitor@example.com') as string]
    expect(lead).not.toHaveProperty('marketingConsent')
  })

  it('keeps the EARLIEST consent timestamp', async () => {
    // Re-stamping on every later capture would rewrite when this person
    // actually opted in.
    await capture({ marketingConsent: true })
    const lead = leads[personKey('visitor@example.com') as string]
    const consentedAt = lead?.['marketingConsentAtMs']
    await capture({ marketingConsent: true, source: 'booking' })
    const after = leads[personKey('visitor@example.com') as string]
    expect(after?.['marketingConsentAtMs']).toBe(consentedAt)
  })
})

describe('the ceiling gates a new person, never an existing one', () => {
  it('refuses a NEW person at the ceiling', async () => {
    leads['someone-else'] = { email: 'other@example.com' }
    const stored = await capture({}, 1)
    expect(stored).toBe(false)
    expect(Object.keys(leads)).toEqual(['someone-else'])
  })

  it('accepts a new person one below the ceiling', async () => {
    leads['someone-else'] = { email: 'other@example.com' }
    expect(await capture({}, 2)).toBe(true)
  })

  it('survives its own ceiling being raised', async () => {
    // A refusal that survives its own cap being raised was never that cap's
    // refusal. Same usage, ceiling one higher, must succeed.
    leads['someone-else'] = { email: 'other@example.com' }
    expect(await capture({}, 1)).toBe(false)
    leads = { 'someone-else': { email: 'other@example.com' } }
    expect(await capture({}, 2)).toBe(true)
  })

  it('⛔ NEVER refuses a person who is already recorded', async () => {
    // A returning visitor's capture is an UPDATE — it does not grow the
    // collection, so refusing it buys no capacity and destroys the source and
    // the timestamp the customer would have learned. Capacity is enforced at
    // the addition; it may not refuse a person already there or their data.
    await capture({ source: 'signup' }, 1)
    expect(Object.keys(leads)).toHaveLength(1)

    // The site is now AT its ceiling. The same person comes back.
    const stored = await capture({ source: 'booking' }, 1)
    expect(stored).toBe(true)
    const lead = leads[personKey('visitor@example.com') as string]
    expect(lead?.['sources']).toEqual(['signup', 'booking'])
    expect(lead?.['submissionCount']).toBe(2)
  })

  it('records a trip when a new person is refused', async () => {
    leads['someone-else'] = { email: 'other@example.com' }
    await capture({}, 1)
    expect(counterWrites.length).toBeGreaterThan(0)
  })

  it('writes no trip when an existing person is merged at the ceiling', async () => {
    // The counter answers "how many were turned away". A merge that was
    // allowed is not a refusal and must not inflate it.
    await capture({}, 1)
    counterWrites = []
    await capture({ source: 'booking' }, 1)
    expect(counterWrites).toEqual([])
  })
})

/**
 * The same one-person rule, applied to the campaign that produced them.
 *
 * A lead's attribution follows its CREATION for exactly the reason the
 * document does: the events stopped being the record. Crediting a returning
 * visitor's capture would let whichever campaign ran most recently re-earn a
 * lead list built over a year, and the number would climb every week without
 * a single new person arriving.
 */
describe('a lead is credited to the campaign that created it, once', () => {
  const TOUCH = {
    channel: 'web' as const,
    campaign: 'sept-launch',
    touchedAtMs: 1_700_000_000_000,
  }

  /** The touch is an option on the WRITER, not a field on the lead. */
  const captureFrom = (
    touch: typeof TOUCH | null,
    lead: Record<string, any> = {},
    ceiling?: number,
  ) =>
    addHostLead({
      hostRef,
      hostId: HOST_ID,
      lead: { email: 'visitor@example.com', source: 'signup', ...lead } as any,
      ...(touch ? { touch } : {}),
      ...(ceiling === undefined ? {} : { ceiling }),
    })

  it('credits the campaign on the capture that CREATES the lead', async () => {
    await captureFrom(TOUCH)

    expect(attributeCampaignConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: HOST_ID,
        kind: 'lead',
        refId: personKey('visitor@example.com'),
        touch: TOUCH,
      }),
    )
  })

  it('credits NOTHING on a later capture of the same person', async () => {
    await captureFrom(TOUCH)
    attributeCampaignConversion.mockClear()

    await captureFrom(TOUCH, { source: 'booking' })

    expect(Object.keys(leads)).toHaveLength(1)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })

  it('credits nothing when the door resolved no campaign', async () => {
    await captureFrom(null)

    expect(Object.keys(leads)).toHaveLength(1)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })

  it('credits nothing for a lead the ceiling REFUSED', async () => {
    // The lead does not exist, so there is nothing for a campaign to be
    // credited with. A refusal that still credited would report leads the
    // customer can find nowhere.
    await captureFrom(TOUCH, {}, 0)

    expect(Object.keys(leads)).toHaveLength(0)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })
})
