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
 * The CRM records band is measured on THREE collections (AGL-2611).
 *
 * Every door the band is enforced at reads through `countCrmRecords`, so the
 * claim this file proves — a Free org's hundred records may be ninety
 * companies and ten people, and the hundred-and-first of ANY kind is refused
 * — is proved once, here, against the real quota arithmetic and a Firestore
 * double that counts what was seeded. The doors themselves have their own
 * specs and mock this measurement.
 *
 * Both sides of every boundary: the last record inside the band is admitted
 * and the next is refused, so a helper that refused everything could not
 * pass.
 */

import { CRM_ACTIVITIES_PER_RECORD_CEILING } from '@aglyn/aglyn/app-utils/crm'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

import {
  countCrmActivitiesForRecord,
  countCrmRecords,
  crmEmailsSentToday,
  crmRecordsQuotaForOrg,
  recordCrmEmailSend,
} from './crm-records'

/** Documents by collection path, the way the aggregate counts them. */
const seeded = new Map<string, Array<Record<string, unknown>>>()
/** Every `set()` on a document path, so the counter's write is inspectable. */
const writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = []
/** What a `get()` of a document answers, by path. */
const docs = new Map<string, Record<string, unknown>>()

const seed = (collection: string, howMany: number, data: Record<string, unknown> = {}) => {
  seeded.set(collection, Array.from({ length: howMany }, () => ({ ...data })))
}

function collectionHandle(path: string, filters: Array<[string, unknown]> = []): any {
  const rows = () =>
    (seeded.get(path) ?? []).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    )
  return {
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unmodelled operator ${op}`)
      return collectionHandle(path, [...filters, [field, value]])
    },
    count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
    doc: (id: string) => docHandle(`${path}/${id}`),
  }
}

function docHandle(path: string): any {
  return {
    path,
    collection: (name: string) => collectionHandle(`${path}/${name}`),
    get: async () => ({
      exists: docs.has(path),
      get: (field: string) => docs.get(path)?.[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path, data, merge: Boolean(options?.merge) })
    },
  }
}

const firestore: any = { collection: (name: string) => collectionHandle(name) }
const orgRef = () => firestore.collection('orgs').doc('org-1')

beforeEach(() => {
  seeded.clear()
  writes.length = 0
  docs.clear()
})

describe('countCrmRecords', () => {
  it('sums contacts, companies and deals, and reports each', async () => {
    seed('orgs/org-1/contacts', 40)
    seed('orgs/org-1/companies', 30)
    seed('orgs/org-1/deals', 30)
    // Not counted, deliberately — see `CRM_RECORD_COLLECTIONS`.
    seed('orgs/org-1/crmTasks', 500)
    seed('orgs/org-1/crmActivities', 500)
    seed('orgs/org-1/pipelines', 3)

    await expect(countCrmRecords(orgRef())).resolves.toEqual({
      contactsCount: 40,
      companiesCount: 30,
      dealsCount: 30,
      crmRecordsCount: 100,
    })
  })

  it('reads the contacts through the reference a door already holds', async () => {
    // `upsertHostContact` resolves the contacts collection through the org
    // data scope before it decides anything; the helper counts THAT
    // reference rather than a second path to the same rows.
    seed('orgs/org-1/contacts', 5)
    seed('scoped/contacts', 2)
    const counts = await countCrmRecords(orgRef(), firestore.collection('scoped/contacts'))
    expect(counts.contactsCount).toBe(2)
    expect(counts.crmRecordsCount).toBe(2)
  })

  it('reads an absent or malformed aggregate as zero, never NaN', async () => {
    // Nothing seeded at all — every count answers 0, and the sum is 0
    // rather than `undefined + undefined`.
    await expect(countCrmRecords(orgRef())).resolves.toEqual({
      contactsCount: 0,
      companiesCount: 0,
      dealsCount: 0,
      crmRecordsCount: 0,
    })
  })
})

describe('crmRecordsQuotaForOrg — Free refuses the 101st record across the three collections', () => {
  const free = { plan: 'free' } as never
  const starter = { plan: 'starter' } as never

  it('is measured against the real Free band', () => {
    // The premise, so the numbers below are the plan table's and not this
    // file's opinion of it.
    expect(PLAN_ENTITLEMENTS.free.contactsPerHost).toBe(100)
    expect(PLAN_ENTITLEMENTS.starter.contactsPerHost).toBe(1_000)
  })

  it('admits the hundredth record when the other ninety-nine are mostly companies and deals', async () => {
    seed('orgs/org-1/contacts', 9)
    seed('orgs/org-1/companies', 45)
    seed('orgs/org-1/deals', 45)
    const room = await crmRecordsQuotaForOrg(free, orgRef())
    expect(room.crmRecordsCount).toBe(99)
    expect(room.allowed).toBe(true)
    expect(room.remaining).toBe(1)
  })

  it('refuses the hundred-and-first, whichever collection it would land in', async () => {
    // Ten people and ninety companies — the contacts headcount alone would
    // have admitted ninety more people. FORCED RED against a door that
    // counted contacts only: `allowed` reads true there.
    seed('orgs/org-1/contacts', 10)
    seed('orgs/org-1/companies', 90)
    const room = await crmRecordsQuotaForOrg(free, orgRef())
    expect(room.crmRecordsCount).toBe(100)
    expect(room.allowed).toBe(false)
    expect(room.overageRateUsd).toBeNull()
    expect(room.remaining).toBe(0)
  })

  it('CONTROL: Starter meters the same hundred-and-first rather than refusing it', async () => {
    seed('orgs/org-1/contacts', 10)
    seed('orgs/org-1/companies', 90)
    const room = await crmRecordsQuotaForOrg(starter, orgRef())
    expect(room.allowed).toBe(true)
    expect(room.overageRecords).toBe(0)
    // …and past its own band it bills instead of walling: 1,001 records
    // on a 1,000 band is one record of overage at $1/1,000.
    seed('orgs/org-1/deals', 901)
    const past = await crmRecordsQuotaForOrg(starter, orgRef())
    expect(past.crmRecordsCount).toBe(1_001)
    expect(past.allowed).toBe(true)
    expect(past.overageRecords).toBe(1)
    expect(past.overageRateUsd).toBe(1)
  })
})

describe('countCrmActivitiesForRecord', () => {
  it('counts on the contact first, then the company, then the deal', async () => {
    seed('orgs/org-1/crmActivities', 3, { contactId: 'c1', companyId: 'co1' })
    seeded.get('orgs/org-1/crmActivities')!.push(
      { companyId: 'co1' },
      { companyId: 'co1' },
      { dealId: 'd1' },
    )
    await expect(
      countCrmActivitiesForRecord(orgRef(), { contactId: 'c1', companyId: 'co1' }),
    ).resolves.toBe(3)
    await expect(countCrmActivitiesForRecord(orgRef(), { companyId: 'co1' })).resolves.toBe(5)
    await expect(countCrmActivitiesForRecord(orgRef(), { dealId: 'd1' })).resolves.toBe(1)
    // No record named: nothing to count against, so nothing is read.
    await expect(countCrmActivitiesForRecord(orgRef(), {})).resolves.toBe(0)
  })

  it('the ceiling it feeds is the platform constant', () => {
    expect(CRM_ACTIVITIES_PER_RECORD_CEILING).toBe(5_000)
  })
})

describe('the one-to-one email counter', () => {
  const NOON = new Date('2026-09-05T12:00:00Z')

  it('reads today’s count off orgs/{orgId}/crmEmailUsage/{YYYY-MM-DD}', async () => {
    docs.set('orgs/org-1/crmEmailUsage/2026-09-05', { count: 17 })
    await expect(crmEmailsSentToday(firestore, 'org-1', NOON)).resolves.toBe(17)
    // Yesterday's document is not today's pace.
    docs.clear()
    docs.set('orgs/org-1/crmEmailUsage/2026-09-04', { count: 17 })
    await expect(crmEmailsSentToday(firestore, 'org-1', NOON)).resolves.toBe(0)
  })

  it('reads a malformed counter as zero sent — the permissive direction', async () => {
    docs.set('orgs/org-1/crmEmailUsage/2026-09-05', { count: 'seventeen' })
    await expect(crmEmailsSentToday(firestore, 'org-1', NOON)).resolves.toBe(0)
    docs.set('orgs/org-1/crmEmailUsage/2026-09-05', { count: -4 })
    await expect(crmEmailsSentToday(firestore, 'org-1', NOON)).resolves.toBe(0)
  })

  it('records a send as an increment under merge, on today’s document', async () => {
    await recordCrmEmailSend(firestore, 'org-1', 1, NOON)
    expect(writes).toEqual([
      {
        path: 'orgs/org-1/crmEmailUsage/2026-09-05',
        merge: true,
        data: {
          count: { __increment: 1 },
          day: '2026-09-05',
          updatedAt: 'server-timestamp',
        },
      },
    ])
  })

  it('writes nothing for a send that did not happen, and never throws', async () => {
    await recordCrmEmailSend(firestore, 'org-1', 0, NOON)
    await recordCrmEmailSend(firestore, '', 1, NOON)
    await recordCrmEmailSend(firestore, 'org-1', Number.NaN, NOON)
    expect(writes).toHaveLength(0)
    // A failing write is logged and swallowed: the message has already left.
    const failing: any = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              set: async () => {
                throw new Error('unavailable')
              },
            }),
          }),
        }),
      }),
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(recordCrmEmailSend(failing, 'org-1', 1, NOON)).resolves.toBeUndefined()
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
