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

/*
 * A gift card file issues cards, never balances (AGL-3551): every card the
 * dry run passes goes through the Gift cards card's own issue path, only
 * once the total is typed back, only for owners and admins — and undo voids
 * only a card nobody has spent from. Against a fake that answers queries
 * and transactions the way Firestore does.
 */

import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  matchLookupRequests,
  matchRows,
  type MatchKeySpec,
  type TransferPlanRow,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import type { TransferApplyWriter, TransferResourceContext } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

let fake: QueryFakeFirestore
const members = new Map<string, Record<string, unknown>>()
const mockActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockSent: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, FieldValue, Timestamp },
  },
  resolveOrgMembership: async (uid: string, orgId: string) =>
    members.has(uid) ? { orgId, member: { $id: uid, ...members.get(uid) } } : null,
  // Business carries `giftCards`, so the plan is never what refuses below.
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', slug: 'acme' },
  }),
  logHostActivity: (...args: unknown[]) => mockActivity(...args),
  hostSendingIdentity: async () => ({ from: 'hello@acme.example' }),
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))

import { giftCardsTransfer } from './gift-cards.server'
import {
  GIFT_CARD_TRANSFER_FIELDS,
  planGiftCardRows,
  typedDollarsToCents,
  type GiftCardPlannedRow,
} from './records-transfer'
import { GIFT_CARD_CONFIRM_STEP_ID } from './transfer-keys'

const HOST = 'hosts/h1'
const CARDS = `${HOST}/giftCards`

const ctx = (extras?: Record<string, unknown>, actorUid = 'owner-1'): TransferResourceContext => ({
  resource: 'commerce.gift-cards',
  orgId: 'org-1',
  hostId: 'h1',
  actorUid,
  jobId: 'job-1',
  ...(extras ? { extras } : {}),
})

const confirm = (totalCents: number, email = false) => ({ [GIFT_CARD_CONFIRM_STEP_ID]: { totalCents, email } })

function memoryWriter(ledger = new Map<number, TransferRowResult>()): TransferApplyWriter {
  return {
    alreadyApplied: async (row) => ledger.get(row) ?? null,
    markApplied: async (result) => void ledger.set(result.row, result),
    timeLeftMs: () => 60_000,
  }
}

const usd = (dollars: number) => ({ amountMinor: Math.round(dollars * 100), currency: 'USD' })

/** Rows (values by field id) through the lookup, the match and the plan, as the job runs them. */
async function plan(values: Array<Record<string, unknown>>, options: { extras?: Record<string, unknown>; policy?: Partial<TransferPolicy> } = {}) {
  const c = ctx(options.extras)
  const keys = giftCardsTransfer.matchKeys as readonly MatchKeySpec[]
  const found = await giftCardsTransfer.lookup!(c, matchLookupRequests(values, keys))
  const rows: TransferPlanRow[] = values.map((row, index) => ({ index, values: row }))
  const planned = await giftCardsTransfer.plan!(c, {
    fields: buildTransferFieldCatalog({ standard: GIFT_CARD_TRANSFER_FIELDS }).fields,
    rows,
    matches: matchRows(values, keys, found.lookup),
    existing: found.records,
    policy: createTransferPolicy(options.policy ?? {}),
  })
  return { ...planned, rows: planned.rows as GiftCardPlannedRow[] }
}

/** The rows the engine applies: creates and updates the `gift-card-issuable` invariant did not fail. */
const writes = (rows: GiftCardPlannedRow[]) =>
  rows.filter((row) => (row.verdict === 'create' || row.verdict === 'update') && !row.giftCard?.problem)

async function apply(rows: GiftCardPlannedRow[], extras?: Record<string, unknown>, writer = memoryWriter()) {
  const chosen = writes(rows)
  return giftCardsTransfer.apply!(ctx(extras), { jobId: 'job-1', index: 0, start: 0, end: rows.length, rows: chosen }, writer)
}

beforeEach(() => {
  fake = queryFakeFirestore()
  members.clear()
  members.set('owner-1', { role: 'owner' })
  mockActivity.mockClear()
  mockSent.length = 0
})

describe('the dry run lists every card it issues, and its total', () => {
  it('issues under the file’s code joined and upper-cased, makes one for a blank code, and counts the total', async () => {
    const planned = await plan([
      { code: 'abcd efgh 1234', balance: usd(25), recipientEmail: 'Ann@Example.com', note: 'Welcome back' },
      { code: '', balance: usd(100.5) },
    ])
    expect(planned.rows.map((row) => row.verdict)).toEqual(['create', 'create'])
    const [first, second] = planned.rows.map((row) => row.giftCard)
    expect(first).toMatchObject({ code: 'ABCDEFGH1234', amountCents: 2500, recipientEmail: 'ann@example.com', note: 'Welcome back', madeCode: false })
    expect(second?.code).toMatch(/^GC-[0-9A-F]{12}$/)
    expect(second?.madeCode).toBe(true)
    // The dry run's own diff names the code each card is issued under.
    expect(planned.rows[1]?.diff.find((change) => change.fieldId === 'code')?.after).toBe(second?.code)
    expect(first).toMatchObject({ totalCents: 12550, confirmed: false })
    const screening = planned.warnings.find((warning) => warning.class === 'screening')
    expect(screening?.samples.map((sample) => sample.detail)).toEqual([
      'Issues 2 gift cards worth $125.50 in total.',
      'The total has not been confirmed: no card is issued until it is typed on the Confirm step.',
    ])
    expect(planned.acknowledgementsRequired).toContain('screening')
  })

  it('is confirmed only by exactly the total, and says so when the typed total differs', async () => {
    const values = [{ code: 'MIGRATED01', balance: usd(40) }]
    const right = await plan(values, { extras: confirm(4000) })
    expect(right.rows[0]?.giftCard?.confirmed).toBe(true)
    expect(right.warnings.find((warning) => warning.class === 'screening')?.samples).toHaveLength(1)
    const wrong = await plan(values, { extras: confirm(400) })
    expect(wrong.rows[0]?.giftCard?.confirmed).toBe(false)
    expect(wrong.warnings.find((warning) => warning.class === 'screening')?.samples[1]?.detail).toMatch(
      /confirmed was \$4\.00, not \$40\.00/,
    )
  })

  it('refuses a card the store would not issue, with the reason', async () => {
    const planned = await plan([
      { code: 'TOOMUCH001', balance: usd(1000.01) },
      { code: 'NOTHING001', balance: usd(0) },
      { code: 'EUROCARD01', balance: { amountMinor: 2000, currency: 'EUR' } },
      { code: 'DOLLARS001', balance: usd(20), currency: 'cad' },
      { code: 'SHORT', balance: usd(20) },
      { code: 'FINE000001', balance: usd(1000) },
    ])
    const problems = planned.rows.map((row) => row.giftCard?.problem ?? null)
    expect(problems[0]).toMatch(/at most \$1,000/)
    expect(problems[1]).toMatch(/more than \$0/)
    expect(problems[2]).toMatch(/EUR is not converted/)
    expect(problems[3]).toMatch(/CAD is not converted/)
    expect(problems[4]).toMatch(/8 to 40 letters/)
    expect(problems[5]).toBeNull()
    // Only the one card the store can issue counts toward the total.
    expect(planned.rows[5]?.giftCard?.totalCents).toBe(100_000)
  })

  it('never changes a card whose code is taken: refused, skipped, or issued under a new code, as chosen', async () => {
    fake.seed(`${CARDS}/TAKEN00001`, { initialCents: 5000, balanceCents: 5000 })
    fake.seed(`${CARDS}/SPACED0001`, { initialCents: 5000, balanceCents: 5000 })
    const values = [
      { code: 'TAKEN00001', balance: usd(75) },
      { code: 'spaced 0001', balance: usd(75) },
    ]
    // The default ("update the record") is refused: a file never changes a card.
    const refused = await plan(values)
    expect(refused.rows[0]?.giftCard?.problem).toMatch(/TAKEN00001 already exists/)
    // A code spelled differently from the card's is still the card's.
    expect(refused.rows[1]?.giftCard?.problem).toMatch(/SPACED0001 already exists/)
    expect(writes(refused.rows)).toHaveLength(0)

    const skipped = await plan(values, { policy: { record: { onMatch: 'skip', onNew: 'create', onAmbiguous: 'ask' } } })
    expect(skipped.rows[0]?.verdict).toBe('skip')

    const renamed = await plan(values, { policy: { rows: { 0: { action: 'create' } } } })
    expect(renamed.rows[0]?.verdict).toBe('create')
    expect(renamed.rows[0]?.giftCard).toMatchObject({ newCode: true, amountCents: 7500 })
    expect(renamed.rows[0]?.giftCard?.code).toMatch(/^GC-/)
    expect(fake.read(`${CARDS}/TAKEN00001`)).toMatchObject({ balanceCents: 5000 })
  })

  it('issues a code once, however many rows spell it', async () => {
    const planned = await plan([
      { code: 'TWICE00001', balance: usd(10) },
      { code: 'twice 00001', balance: usd(10) },
    ])
    expect(planned.rows[1]?.giftCard?.problem).toBe('Row 1 issues the code TWICE00001 already.')
  })

  it('is refused outright to anybody but an owner or an admin', async () => {
    members.set('editor-1', { role: 'editor', allHosts: true })
    members.set('site-admin', { role: 'editor', hostAccess: { h1: 'admin' } })
    const values = [{ code: 'MIGRATED01', balance: usd(40) }]
    const keys = giftCardsTransfer.matchKeys as readonly MatchKeySpec[]
    const input = {
      fields: buildTransferFieldCatalog({ standard: GIFT_CARD_TRANSFER_FIELDS }).fields,
      rows: values.map((row, index) => ({ index, values: row })),
      matches: matchRows(values, keys, new Map()),
      existing: new Map(),
      policy: createTransferPolicy(),
    }
    await expect(giftCardsTransfer.plan!(ctx(undefined, 'editor-1'), input)).rejects.toMatchObject({ status: 403 })
    await expect(giftCardsTransfer.plan!(ctx(undefined, 'stranger'), input)).rejects.toMatchObject({ status: 403 })
    await expect(giftCardsTransfer.plan!(ctx(undefined, 'site-admin'), input)).resolves.toBeTruthy()
    const planned = await plan(values, { extras: confirm(4000) })
    await expect(
      giftCardsTransfer.apply!(ctx(confirm(4000), 'editor-1'), { jobId: 'job-1', index: 0, start: 0, end: 1, rows: planned.rows }, memoryWriter()),
    ).rejects.toMatchObject({ status: 403 })
    expect(fake.docs(CARDS)).toEqual({})
  })
})

describe('apply issues each card through the issue path', () => {
  it('issues every confirmed card with who issued it, an activity line each, and no email unless asked', async () => {
    const values = [
      { code: 'MIGRATED01', balance: usd(25), recipientEmail: 'ann@example.com' },
      { code: 'MIGRATED02', balance: usd(15) },
    ]
    const planned = await plan(values, { extras: confirm(4000) })
    const applied = await apply(planned.rows, confirm(4000))
    expect(applied.results.map((result) => result.outcome)).toEqual(['created', 'created'])
    expect(fake.read(`${CARDS}/MIGRATED01`)).toMatchObject({
      initialCents: 2500,
      balanceCents: 2500,
      recipientEmail: 'ann@example.com',
      orderId: null,
      issuedBy: 'owner-1',
      importJobId: 'job-1',
      importRow: 0,
    })
    expect(mockActivity).toHaveBeenCalledTimes(2)
    expect(mockActivity).toHaveBeenCalledWith(
      'h1',
      { uid: 'owner-1', email: null },
      'Issued gift card from an import',
      { type: 'commerce:giftCard', id: 'MIGRATED01', name: 'Gift card ending ED01' },
    )
    expect(mockSent).toHaveLength(0)
    expect(applied.undo[0]).toMatchObject({
      recordId: 'MIGRATED01',
      action: 'created',
      written: { balance: 25, status: 'Active', lastUsedAt: null },
    })
  })

  it('emails each recipient their code when the Confirm step asked', async () => {
    const planned = await plan([{ code: '', balance: usd(30), recipientEmail: 'bo@example.com' }], { extras: confirm(3000, true) })
    await apply(planned.rows, confirm(3000, true))
    expect(mockSent).toHaveLength(1)
    expect(String(mockSent[0]?.['text'])).toContain(planned.rows[0]?.giftCard?.code)
  })

  it('issues nothing when the total was not typed, or was typed wrong', async () => {
    const values = [{ code: 'MIGRATED01', balance: usd(25) }]
    const unconfirmed = await plan(values)
    const none = await apply(unconfirmed.rows)
    expect(none.results[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/not confirmed/) })
    // A confirmed plan applied without the answer is refused too: the server reads it again.
    const confirmed = await plan(values, { extras: confirm(2500) })
    const stripped = await apply(confirmed.rows, confirm(2600))
    expect(stripped.results[0]).toMatchObject({ outcome: 'failed' })
    expect(fake.docs(CARDS)).toEqual({})
  })

  it('refuses a code taken after the dry run, and finds its own card on a retried chunk', async () => {
    const planned = await plan([{ code: 'RACED00001', balance: usd(25) }, { code: 'MINE000001', balance: usd(25) }], {
      extras: confirm(5000),
    })
    fake.seed(`${CARDS}/RACED00001`, { initialCents: 900, balanceCents: 900 })
    const first = await apply(planned.rows, confirm(5000))
    expect(first.results[0]).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/already exists/) })
    expect(fake.read(`${CARDS}/RACED00001`)).toMatchObject({ balanceCents: 900 })
    // The ledger lost the row after the card landed: the retry finds the card it issued.
    const retried = await apply(planned.rows, confirm(5000))
    expect(retried.results[1]).toMatchObject({ outcome: 'created', recordId: 'MINE000001' })
    expect(Object.keys(fake.docs(CARDS)).sort()).toEqual(['MINE000001', 'RACED00001'])
  })
})

describe('undo voids only the cards nobody has spent from', () => {
  it('voids an unspent card, and leaves a spent or held one as a conflict whatever the decision', async () => {
    const values = ['UNSPENT001', 'SPENT00001', 'HELD000001'].map((code) => ({ code, balance: usd(50) }))
    const planned = await plan(values, { extras: confirm(15_000) })
    const applied = await apply(planned.rows, confirm(15_000))
    fake.seed(`${CARDS}/SPENT00001`, { ...fake.read(`${CARDS}/SPENT00001`), balanceCents: 2000, lastUsedAtMs: 5 })
    fake.seed(`${CARDS}/HELD000001`, {
      ...fake.read(`${CARDS}/HELD000001`),
      holds: { cs_1: { cents: 1000, expiresAtMs: Date.now() + 60_000 } },
    })
    mockActivity.mockClear()
    const reverted = await giftCardsTransfer.revert!(
      ctx(),
      { jobId: 'job-1', chunk: 0, entries: applied.undo as TransferUndoEntry[] },
      { UNSPENT001: 'revert', SPENT00001: 'revert', HELD000001: 'revert' },
    )
    expect(reverted.done).toEqual([{ action: 'delete', recordId: 'UNSPENT001' }])
    expect(reverted.conflicts.map((step) => step.recordId).sort()).toEqual(['HELD000001', 'SPENT00001'])
    expect(fake.read(`${CARDS}/UNSPENT001`)).toMatchObject({ balanceCents: 0, voidedBy: 'owner-1', voidedByImportUndo: 'job-1' })
    // Voided, never deleted (AGL-1767); the spent cards keep every cent.
    expect(fake.read(`${CARDS}/SPENT00001`)).toMatchObject({ balanceCents: 2000 })
    expect(fake.read(`${CARDS}/HELD000001`)).toMatchObject({ balanceCents: 5000 })
    expect(mockActivity).toHaveBeenCalledTimes(1)
    // A second undo finds nothing left to do.
    const again = await giftCardsTransfer.revert!(ctx(), { jobId: 'job-1', chunk: 0, entries: applied.undo.slice(0, 1) })
    expect(again.done).toEqual([{ action: 'nothing', recordId: 'UNSPENT001', why: 'alreadyReverted' }])
  })
})

describe('gift cards, exported', () => {
  it("reads each card's code, balance and status", async () => {
    fake.seed(`${CARDS}/GC-1`, { initialCents: 5000, balanceCents: 1250, createdAtMs: 0, recipientEmail: 'a@b.co' })
    fake.seed(`${CARDS}/GC-2`, { initialCents: 5000, balanceCents: 0, voidedAtMs: 5 })
    const page = await giftCardsTransfer.readPage!(ctx(), null, ['id', 'balance', 'initial', 'status', 'recipientEmail'], {})
    expect(page.rows).toEqual([
      { id: 'GC-1', balance: 12.5, initial: 50, status: 'Active', recipientEmail: 'a@b.co' },
      { id: 'GC-2', balance: 0, initial: 50, status: 'Voided', recipientEmail: null },
    ])
    await expect(giftCardsTransfer.readPage!(ctx(), null, ['id'], { filter: { anything: 1 } })).rejects.toThrow(
      /exports everything/,
    )
  })
})

describe('the typed total', () => {
  it('reads dollars as a person types them, and nothing else', () => {
    expect(typedDollarsToCents('$1,250.00')).toBe(125_000)
    expect(typedDollarsToCents(' 1250 ')).toBe(125_000)
    expect(typedDollarsToCents('125.5')).toBe(12_550)
    expect(typedDollarsToCents('USD 40')).toBe(4000)
    expect(typedDollarsToCents('12.345')).toBeNull()
    expect(typedDollarsToCents('about 40')).toBeNull()
    expect(typedDollarsToCents('')).toBeNull()
  })

  it('plans nothing to confirm when no card can be issued', () => {
    const empty = planGiftCardRows(
      { rows: [], summary: { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: 0 }, warnings: [], acknowledgementsRequired: [] },
      { confirmation: null, mintCode: () => 'GC-000000000000' },
    )
    expect(empty.warnings).toEqual([])
  })
})
