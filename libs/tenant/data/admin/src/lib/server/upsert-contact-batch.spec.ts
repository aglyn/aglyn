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
 * A FILE OF CAPTURES, ITS LOOKUPS READ ONCE (AGL-3423).
 *
 * `crm/contacts-import` timed out at sixty seconds on a two-hundred-row
 * chunk because every row paid the door's reads one after another: the
 * site, the group, the address index and the `email` query, the erasure
 * row, the org, and three aggregate counts for the band. These cases run
 * the REAL door and the REAL batch against the querying fake, which counts
 * read round trips, and pin what the fix is for:
 *
 *  1. the reads a chunk costs do not grow with its rows;
 *  2. the answers are the door's own — a retry merges, a row cut off before
 *     its index entry is still found, the erased stay erased, and the band
 *     admits exactly as far as serial captures would, in the caller's order.
 *
 * WHAT IS SUBSTITUTED: the org lookups (a site on one org, counted, so a
 * second resolution is visible), the list-fields restamp (a write-path
 * transaction with its own spec), the mail-server check and the order
 * attribution. The `@aglyn/aglyn/server` barrel is the fixture the verdict
 * spec uses, with the band's quota reduced to "fewer than `included`".
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { queryFakeFirestore, type QueryFakeFirestore } from './test-firestore-queries'
import {
  prepareContactCaptureBatch,
  upsertHostContact,
  type UpsertHostContactVerdict,
} from './upsert-contact'

const HOST = 'h1'
const ORG = 'org1'
const CONTACTS = `orgs/${ORG}/contacts`
const INDEX = `orgs/${ORG}/emailIndex`

let fake: QueryFakeFirestore
let mockIncluded = Infinity
const mockSiteReads = { contacts: 0, org: 0, group: 0 }

jest.mock('./firebase-admin', () => {
  const firebaseAdmin = { app: () => ({ firestore: () => fake }) }
  return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
})

jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: async () => null,
}))

jest.mock('./capture-email-check', () => ({
  __esModule: true,
  scheduleCapturedEmailCheck: () => undefined,
}))

jest.mock('./crm-records', () => ({
  __esModule: true,
  restampCrmListFieldsAt: async () => 'current',
  countCrmRecords: async (orgRef: any, contacts: any) => {
    const [people, firms, deals] = await Promise.all([
      contacts.count().get(),
      orgRef.collection('companies').count().get(),
      orgRef.collection('deals').count().get(),
    ])
    const [contactsCount, companiesCount, dealsCount] = [people, firms, deals].map(
      (snapshot: any) => snapshot.data().count as number,
    )
    return {
      contactsCount,
      companiesCount,
      dealsCount,
      crmRecordsCount: contactsCount + companiesCount + dealsCount,
    }
  },
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  orgDataCollectionForHost: async () => {
    mockSiteReads.contacts += 1
    return fake.collection(CONTACTS)
  },
  getOrgForHost: async () => {
    mockSiteReads.org += 1
    return { orgId: ORG, org: { plan: 'free' } }
  },
  consentGroupForSite: async (hostId: string) => {
    mockSiteReads.group += 1
    return jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId)
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/container-membership'),
  ORG_SCOPE_TOKEN: 'org',
  checkCrmRecordsQuota: (_org: unknown, used: number) => ({ allowed: used < mockIncluded }),
}))

const addressOf = (at: number) => `person${at}@example.com`

/** A contact already on file; `indexed` says whether its index entry was written. */
function seedContact(id: string, email: string, indexed = true) {
  fake.seed(`${CONTACTS}/${id}`, { email, hostId: HOST, visibleTo: [`host:${HOST}`] })
  if (indexed) fake.seed(`${INDEX}/${personKey(email)}`, { email, contactId: id })
}

/** The capture a file row makes, exactly as the import hands it to the door. */
const captureRow = (email: string, batch?: Awaited<ReturnType<typeof prepareContactCaptureBatch>>) =>
  upsertHostContact({
    hostId: HOST,
    email,
    source: 'import',
    interaction: { summary: 'Imported from CSV' },
    campaignIds: [],
    ...(batch ? { batch } : {}),
  })

/** A chunk through one batch, eight rows at a time as the route writes them. */
async function importChunk(emails: string[]): Promise<UpsertHostContactVerdict[]> {
  const batch = await prepareContactCaptureBatch(HOST, emails)
  for (const email of emails) if (batch.peek(email) === null) batch.reserve(email)
  const verdicts: UpsertHostContactVerdict[] = new Array(emails.length)
  let next = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < emails.length) {
        const at = next
        next += 1
        verdicts[at] = await captureRow(emails[at], batch)
      }
    }),
  )
  return verdicts
}

const tally = (verdicts: UpsertHostContactVerdict[]) => ({
  created: verdicts.filter((verdict) => 'created' in verdict && verdict.created).length,
  merged: verdicts.filter((verdict) => 'created' in verdict && !verdict.created).length,
  band: verdicts.filter((verdict) => 'refused' in verdict && verdict.refused === 'band').length,
  erased: verdicts.filter((verdict) => 'refused' in verdict && verdict.refused === 'erased').length,
})

/**
 * A file of `rows` addresses: a third already on file with an index entry,
 * a few on file WITHOUT one (a row cut off between its two writes), one
 * erased, and the rest new.
 */
function seedFile(rows: number): string[] {
  const emails = Array.from({ length: rows }, (_, at) => addressOf(at))
  emails.forEach((email, at) => {
    if (at % 3 === 0) seedContact(`held-${at}`, email)
    else if (at % 7 === 0) seedContact(`unindexed-${at}`, email, false)
  })
  fake.seed(`hosts/${HOST}/suppressions/${personKey(emails[1])}`, { reason: 'erasure' })
  return emails
}

beforeEach(() => {
  fake = queryFakeFirestore()
  mockIncluded = Infinity
  mockSiteReads.contacts = 0
  mockSiteReads.org = 0
  mockSiteReads.group = 0
})

describe('what a chunk costs', () => {
  it('reads the same number of round trips for sixty rows as for ten', async () => {
    const readsFor = async (rows: number) => {
      fake = queryFakeFirestore()
      const emails = seedFile(rows)
      fake.resetReads()
      await importChunk(emails)
      return fake.reads()
    }
    const ten = await readsFor(10)
    const sixty = await readsFor(60)
    // Two `getAll`s and one `in` page per thirty misses, the erasure
    // `getAll`, three counts — sixty rows have one more miss page than ten.
    expect(sixty).toBeLessThanOrEqual(ten + 1)
    expect(sixty).toBeLessThan(12)
  })

  it('resolves the site, the org and the group once for the whole chunk', async () => {
    await importChunk(seedFile(40))
    expect(mockSiteReads).toEqual({ contacts: 1, org: 1, group: 1 })
  })

  it('is the per-row cost the door pays without a batch, for contrast', async () => {
    const emails = seedFile(30)
    fake.resetReads()
    for (const email of emails) await captureRow(email)
    // The index, the query, the erasure row and three counts per new
    // person: over a hundred round trips where the batch paid seven.
    expect(fake.reads()).toBeGreaterThan(emails.length * 3)
  })
})

describe('what a chunk decides', () => {
  it('creates, merges and refuses exactly as the door does one row at a time', async () => {
    const emails = seedFile(30)
    const verdicts = await importChunk(emails)
    // 10 held with an index entry, 3 held without one (7, 14, 28), 1 erased.
    expect(tally(verdicts)).toEqual({ created: 16, merged: 13, band: 0, erased: 1 })
    expect(Object.keys(fake.docs(CONTACTS))).toHaveLength(29)
  })

  it('merges every row of a retried chunk and creates nobody twice', async () => {
    const emails = seedFile(30)
    await importChunk(emails)
    const retried = await importChunk(emails)
    expect(tally(retried)).toEqual({ created: 0, merged: 29, band: 0, erased: 1 })
    expect(Object.keys(fake.docs(CONTACTS))).toHaveLength(29)
  })

  it('finds a row written before its index entry, and writes the entry', async () => {
    seedContact('cut-off', 'late@example.com', false)
    const [verdict] = await importChunk(['late@example.com'])
    expect(verdict).toEqual({ contactId: 'cut-off', created: false })
    expect(fake.read(`${INDEX}/${personKey('late@example.com')}`)).toMatchObject({
      contactId: 'cut-off',
    })
  })

  it('admits creates as far as the band reaches, in the order the caller reserved them', async () => {
    seedContact('held', 'held@example.com')
    mockIncluded = 3
    const batch = await prepareContactCaptureBatch(HOST, ['a@x.co', 'b@x.co', 'c@x.co'])
    // Reserved c, a, b: the band has room for two new records past the one held.
    expect(batch.reserve('c@x.co')).toBe(true)
    expect(batch.reserve('a@x.co')).toBe(true)
    expect(batch.reserve('b@x.co')).toBe(false)
    const [a, b, c] = await Promise.all(
      ['a@x.co', 'b@x.co', 'c@x.co'].map((email) => captureRow(email, batch)),
    )
    expect(a).toMatchObject({ created: true })
    expect(b).toEqual({ refused: 'band' })
    expect(c).toMatchObject({ created: true })
  })

  it('asks live for an address captured twice in one batch, so the second merges', async () => {
    const batch = await prepareContactCaptureBatch(HOST, ['twice@example.com'])
    const first = await captureRow('twice@example.com', batch)
    const second = await captureRow('twice@example.com', batch)
    expect(first).toMatchObject({ created: true })
    expect(second).toEqual({ contactId: (first as { contactId: string }).contactId, created: false })
    expect(Object.keys(fake.docs(CONTACTS))).toHaveLength(1)
  })

  it('ignores a batch prepared for another site', async () => {
    const batch = await prepareContactCaptureBatch('other-site', ['a@x.co'])
    const reads = fake.reads()
    await captureRow('a@x.co', batch)
    expect(fake.reads()).toBeGreaterThan(reads)
  })
})
