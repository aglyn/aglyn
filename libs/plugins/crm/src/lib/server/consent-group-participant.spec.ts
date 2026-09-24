/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The CRM's share of a consent group change (AGL-3320): a contact's per-site
 * refusal carried across a separation (C4), and the records a group keeps
 * about a person moved or split when the declaration does.
 *
 * Every pass is run twice. The executor runs the carry before the flip and
 * again as the catch-up, and the sweep repeats everything, so the property
 * that matters as much as the first write is that the second writes nothing —
 * no refusal restamped, no figure summed twice, no note appended twice.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec injects its own Firestore')
    },
  },
}))

import {
  type ConsentGroupDeclaration,
  planConsentGroupChange,
} from '@aglyn/aglyn/app-utils/consent-group-change'
import type { ConsentGroupChangeRunRequest } from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'
import { queryFakeFirestore } from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import {
  COPIED_BY_CHANGE_FIELD,
  createConsentGroupParticipant,
  planHolderRecords,
  PREVIEW_SCAN_LIMIT,
} from './consent-group-participant'

const ORG = 'org-1'
const CHANGE = 'change-1'
const contactPath = (id: string) => `orgs/${ORG}/contacts/${id}`

function participantOn(seed: Record<string, Record<string, unknown>>) {
  const firestore = queryFakeFirestore(seed)
  const participant = createConsentGroupParticipant({ firestore: () => firestore as never })
  return { firestore, participant }
}

/** Runs one phase to the end, as the executor does, and totals its counts. */
async function runPhase(
  participant: ReturnType<typeof createConsentGroupParticipant>,
  before: ConsentGroupDeclaration,
  after: ConsentGroupDeclaration,
  phase: ConsentGroupChangeRunRequest['phase'],
  options: { dryRun?: boolean } = {},
) {
  const plan = planConsentGroupChange(before, after)
  const counts: Record<string, number> = {}
  let cursor: string | null = null
  for (let call = 0; call < 50; call += 1) {
    const result = await participant.run({
      orgId: ORG,
      changeId: CHANGE,
      plan,
      phase,
      cursor,
      deadlineMs: Date.now() + 60_000,
      dryRun: options.dryRun ?? false,
    })
    for (const [key, value] of Object.entries(result.counts)) counts[key] = (counts[key] ?? 0) + value
    if (result.done) return counts
    cursor = result.cursor
  }
  throw new Error('the phase never finished')
}

const G = { g: { name: 'Northwind', hostIds: ['r', 'x'] } }

describe('C4 — a contact’s per-site refusal', () => {
  const seed = () => ({
    [contactPath('declined-on-x')]: {
      email: 'pat@example.com',
      marketingConsentByHost: {
        x: {
          marketingConsent: false,
          marketingConsentAtMs: 1_000,
          marketingConsentSource: { actor: 'person', door: 'unsubscribe' },
        },
        // R's grant, recorded while the two were one sender.
        r: { marketingConsent: true, marketingConsentAtMs: 500, consentGroupId: 'g' },
      },
    },
    [contactPath('declined-on-both')]: {
      email: 'lee@example.com',
      marketingConsentByHost: {
        x: { marketingConsent: false, marketingConsentAtMs: 1_000 },
        r: { marketingConsent: false, marketingConsentAtMs: 2_000 },
      },
    },
    [contactPath('granted')]: {
      email: 'sam@example.com',
      marketingConsentByHost: { x: { marketingConsent: true, marketingConsentAtMs: 9 } },
    },
  })

  it('writes the refusal onto the receiving site by dotted path, keeping what it replaced', async () => {
    const { firestore, participant } = participantOn(seed())
    const counts = await runPhase(participant, G, {}, 'carry')
    expect(counts).toEqual({ refusals: 1 })
    const contact = firestore.read(contactPath('declined-on-x'))
    expect(contact?.['marketingConsentByHost']).toEqual({
      x: {
        marketingConsent: false,
        marketingConsentAtMs: 1_000,
        marketingConsentSource: { actor: 'person', door: 'unsubscribe' },
      },
      r: {
        marketingConsent: false,
        marketingConsentAtMs: 1_000,
        marketingConsentSource: { actor: 'person', door: 'unsubscribe' },
        carriedFromHostId: 'x',
        carriedByChangeId: CHANGE,
        supersededEntry: { marketingConsent: true, marketingConsentAtMs: 500, consentGroupId: 'g' },
      },
    })
    // A refusal each site already held is its own, and a grant is not carried.
    expect(firestore.read(contactPath('declined-on-both'))?.['marketingConsentByHost']).toEqual(
      seed()[contactPath('declined-on-both')].marketingConsentByHost,
    )
    expect(firestore.read(contactPath('granted'))?.['marketingConsentByHost']).toEqual({
      x: { marketingConsent: true, marketingConsentAtMs: 9 },
    })
  })

  it('writes nothing the second time', async () => {
    const { firestore, participant } = participantOn(seed())
    await runPhase(participant, G, {}, 'carry')
    firestore.resetWrites()
    expect(await runPhase(participant, G, {}, 'carry')).toEqual({ refusals: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('counts and writes nothing on a dry run', async () => {
    const { firestore, participant } = participantOn(seed())
    firestore.resetWrites()
    expect(await runPhase(participant, G, {}, 'carry', { dryRun: true })).toEqual({ refusals: 1 })
    expect(firestore.writes()).toBe(0)
  })
})

describe('MOVE — sites that become one sender', () => {
  const CREATED = { g: { name: 'Northwind', hostIds: ['a', 'b'] } }

  it('folds solo records into the group, the first site to meet the person first, figures summed once', async () => {
    const { firestore, participant } = participantOn({
      [contactPath('p')]: {
        email: 'pat@example.com',
        // B met them first.
        capturedByHostIds: ['b', 'a'],
        facets: {
          a: { sources: {}, interactions: [], ownerUid: 'owner-a', notes: 'Met at the shop', ltvCents: 100, ordersCount: 1, tags: ['vip'] },
          b: { sources: {}, interactions: [], ownerUid: 'owner-b', notes: 'Booked twice', ltvCents: 50, ordersCount: 2, tags: ['regular'] },
        },
      },
    })
    // One person, whose two records became one.
    expect(await runPhase(participant, {}, CREATED, 'rehome')).toEqual({
      combined: 1,
      copied: 0,
      figuresDropped: 0,
    })
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(Object.keys(facets)).toEqual(['g'])
    expect(facets['g']).toMatchObject({
      ownerUid: 'owner-b',
      notes: 'Booked twice\n\nMet at the shop',
      ltvCents: 150,
      ordersCount: 3,
      tags: ['regular', 'vip'],
    })

    firestore.resetWrites()
    await runPhase(participant, {}, CREATED, 'rehome')
    expect(firestore.writes()).toBe(0)
    expect((firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>)['g']).toMatchObject({
      ltvCents: 150,
    })
  })

  it('keeps the group’s own record first when a site joins it', async () => {
    const { firestore, participant } = participantOn({
      [contactPath('p')]: {
        email: 'pat@example.com',
        capturedByHostIds: ['c', 'a'],
        facets: {
          g: { sources: {}, interactions: [], ownerUid: 'owner-g', lifecycleStage: 'customer', ltvCents: 10 },
          c: { sources: {}, interactions: [], ownerUid: 'owner-c', lifecycleStage: 'lead', ltvCents: 5, phone: '+15550100' },
        },
      },
    })
    await runPhase(
      participant,
      { g: { name: 'Northwind', hostIds: ['a', 'b'] } },
      { g: { name: 'Northwind', hostIds: ['a', 'b', 'c'] } },
      'rehome',
    )
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(Object.keys(facets)).toEqual(['g'])
    // The group's values win; the joining site fills only what the group lacked.
    expect(facets['g']).toMatchObject({
      ownerUid: 'owner-g',
      lifecycleStage: 'customer',
      phone: '+15550100',
      ltvCents: 15,
    })
  })

  it('moves the company mirror and counts with the facets', async () => {
    const { firestore, participant } = participantOn({
      [contactPath('p')]: {
        email: 'pat@example.com',
        capturedByHostIds: ['a', 'b'],
        companyIds: ['co-a', 'co-b', 'co-legacy'],
        facets: {
          a: { sources: {}, interactions: [], companyId: 'co-a' },
          b: { sources: {}, interactions: [], companyId: 'co-b' },
        },
      },
      [`orgs/${ORG}/companies/co-a`]: { name: 'A Inc', contactsCount: 4 },
      [`orgs/${ORG}/companies/co-b`]: { name: 'B Inc', contactsCount: 7 },
    })
    await runPhase(participant, {}, { g: { name: 'Northwind', hostIds: ['a', 'b'] } }, 'rehome')
    const contact = firestore.read(contactPath('p'))
    // A met them first, so A's company is the group's; B's is named by no
    // facet now and leaves the mirror. A link older than the facets stays.
    expect((contact?.['facets'] as Record<string, Record<string, unknown>>)['g']['companyId']).toBe('co-a')
    expect(contact?.['companyIds']).toEqual(['co-a', 'co-legacy'])
    expect(firestore.read(`orgs/${ORG}/companies/co-b`)?.['contactsCount']).toBe(6)
    expect(firestore.read(`orgs/${ORG}/companies/co-a`)?.['contactsCount']).toBe(4)
  })

  it('folds a straggler written under the old key after the re-home, once, in the sweep', async () => {
    const { firestore, participant } = participantOn({
      [contactPath('p')]: {
        email: 'pat@example.com',
        capturedByHostIds: ['a'],
        facets: { a: { sources: {}, interactions: [], ltvCents: 100, ordersCount: 1 } },
      },
    })
    const after = { g: { name: 'Northwind', hostIds: ['a', 'b'] } }
    await runPhase(participant, {}, after, 'rehome')
    // An order webhook that resolved the group before the flip lands late.
    const stored = firestore.read(contactPath('p')) as Record<string, unknown>
    firestore.seed(contactPath('p'), {
      ...stored,
      facets: {
        ...(stored['facets'] as Record<string, unknown>),
        a: { sources: {}, interactions: [], ltvCents: 40, ordersCount: 1 },
      },
    })
    await runPhase(participant, {}, after, 'sweep')
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(Object.keys(facets)).toEqual(['g'])
    expect(facets['g']).toMatchObject({ ltvCents: 140, ordersCount: 2 })
    firestore.resetWrites()
    await runPhase(participant, {}, after, 'sweep')
    expect(firestore.writes()).toBe(0)
  })
})

describe('SPLIT — sites that stop being one sender', () => {
  const INTERACTIONS = [
    { type: 'order', atMs: 3, hostId: 'x' },
    { type: 'booking', atMs: 2, hostId: 'r' },
    { type: 'note', atMs: 1 },
  ]
  const record = (capturedByHostIds: string[]) => ({
    email: 'pat@example.com',
    capturedByHostIds,
    facets: {
      g: {
        sources: { form: true },
        interactions: INTERACTIONS,
        ownerUid: 'owner-g',
        notes: 'Prefers mornings',
        ltvCents: 900,
        ordersCount: 3,
        lastPurchaseAtMs: 3,
      },
    },
  })
  const LEAVE = { g: { name: 'Northwind', hostIds: ['r', 'x'] } }
  const STAY = { g: { name: 'Northwind', hostIds: ['r', 's'] } }
  const BEFORE_LEAVE = { g: { name: 'Northwind', hostIds: ['r', 's', 'x'] } }

  it('copies the record to the leaving site that met the person, with its figures when only it did', async () => {
    const { firestore, participant } = participantOn({ [contactPath('p')]: record(['x']) })
    expect(await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')).toMatchObject({ copied: 1 })
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(facets['x']).toMatchObject({
      ownerUid: 'owner-g',
      notes: 'Prefers mornings',
      ltvCents: 900,
      ordersCount: 3,
      // Its own site's entries and the ones no site owns — never a sibling's.
      interactions: [INTERACTIONS[0], INTERACTIONS[2]],
      [COPIED_BY_CHANGE_FIELD]: { g: CHANGE },
    })
    // The group keeps its record, and the figures went with the only site
    // that earned them.
    expect(facets['g']).toMatchObject({ ownerUid: 'owner-g', notes: 'Prefers mornings' })
    expect(facets['g']).not.toHaveProperty('ltvCents')
    expect(facets['g']).not.toHaveProperty('ordersCount')

    firestore.resetWrites()
    await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')
    expect(firestore.writes()).toBe(0)
  })

  it('leaves the figures with the group when the stayers met the person too', async () => {
    const { firestore, participant } = participantOn({ [contactPath('p')]: record(['r', 'x']) })
    await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(facets['x']).not.toHaveProperty('ltvCents')
    expect(facets['g']).toMatchObject({ ltvCents: 900, ordersCount: 3 })
  })

  it('copies nothing for a person the leaving site never met', async () => {
    const { firestore, participant } = participantOn({ [contactPath('p')]: record(['r']) })
    firestore.resetWrites()
    expect(await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')).toMatchObject({ copied: 0 })
    expect(firestore.writes()).toBe(0)
  })

  it('merges a copy under the record the leaving site already kept, its own values first', async () => {
    const seeded = record(['x'])
    ;(seeded.facets as Record<string, unknown>)['x'] = {
      sources: {},
      interactions: [],
      ownerUid: 'owner-x',
      notes: 'Own note',
      [COPIED_BY_CHANGE_FIELD]: { older: 'change-0' },
    }
    const { firestore, participant } = participantOn({ [contactPath('p')]: seeded })
    await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')
    const facets = firestore.read(contactPath('p'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(facets['x']).toMatchObject({
      ownerUid: 'owner-x',
      notes: 'Own note\n\nPrefers mornings',
      [COPIED_BY_CHANGE_FIELD]: { older: 'change-0', g: CHANGE },
    })
    firestore.resetWrites()
    await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')
    expect(firestore.writes()).toBe(0)
  })

  it('dissolving a group copies to every site that met the person and drops figures it cannot split', async () => {
    const { firestore, participant } = participantOn({
      [contactPath('both')]: record(['r', 'x']),
      [contactPath('nobody')]: { ...record([]), capturedByHostIds: [] },
    })
    const counts = await runPhase(participant, LEAVE, {}, 'rehome')
    expect(counts).toMatchObject({ copied: 4, figuresDropped: 2 })
    const both = firestore.read(contactPath('both'))?.['facets'] as Record<string, Record<string, unknown>>
    expect(Object.keys(both).sort()).toEqual(['r', 'x'])
    expect(both['r']).not.toHaveProperty('ltvCents')
    expect(both['r']['interactions']).toEqual([INTERACTIONS[1], INTERACTIONS[2]])
    // A record no site met goes to every successor rather than nowhere.
    const nobody = firestore.read(contactPath('nobody'))?.['facets'] as Record<string, unknown>
    expect(Object.keys(nobody).sort()).toEqual(['r', 'x'])
  })

  it('a sweep never re-copies from a key that survived the split', async () => {
    const { firestore, participant } = participantOn({ [contactPath('p')]: record(['x']) })
    await runPhase(participant, BEFORE_LEAVE, STAY, 'rehome')
    // A new order on a staying site lands on the surviving group's record.
    const stored = firestore.read(contactPath('p')) as Record<string, unknown>
    const facets = stored['facets'] as Record<string, Record<string, unknown>>
    firestore.seed(contactPath('p'), {
      ...stored,
      facets: { ...facets, g: { ...facets['g'], ltvCents: 25, ordersCount: 1 } },
    })
    firestore.resetWrites()
    await runPhase(participant, BEFORE_LEAVE, STAY, 'sweep')
    expect(firestore.writes()).toBe(0)
  })
})

describe('planHolderRecords', () => {
  it('answers null for a contact no flow touches', () => {
    const plan = planConsentGroupChange({}, { g: { name: 'N', hostIds: ['a', 'b'] } })
    expect(planHolderRecords({ facets: { z: { sources: {}, interactions: [] } } }, plan, CHANGE)).toBeNull()
    expect(planHolderRecords({}, plan, CHANGE)).toBeNull()
  })
})

describe('the preview', () => {
  it('counts what each kind of move would touch, in the review step’s terms', async () => {
    const { participant } = participantOn({
      [contactPath('1')]: {
        // Met on both sites and bought: the totals cannot follow one of them.
        capturedByHostIds: ['x', 'r'],
        visibleTo: ['host:r', 'host:x'],
        facets: { g: { sources: {}, interactions: [], ordersCount: 2, ltvCents: 500 } },
        marketingConsentByHost: {
          x: { marketingConsent: true, consentGroupId: 'g' },
          r: { marketingConsent: false },
        },
      },
      [contactPath('2')]: {
        capturedByHostIds: ['r'],
        visibleTo: ['host:r', 'host:x'],
        facets: { g: { sources: {}, interactions: [] } },
        // A grant stamped with the group that a later refusal replaced.
        marketingConsentByHost: { x: { marketingConsent: false, consentGroupId: 'g' } },
      },
      [contactPath('3')]: {
        capturedByHostIds: ['y'],
        facets: { g: { sources: {}, interactions: [] }, y: { sources: {}, interactions: [] } },
      },
    })
    const lines = await participant.preview({ orgId: ORG, plan: planConsentGroupChange(G, {}) })
    expect(lines.map((line) => [line.id, line.count])).toEqual([
      // Every record the dissolving group holds goes somewhere.
      ['crm.copy', 3],
      // Only the grant still in force.
      ['crm.grants', 1],
      // X sees person 2 without having met them; R met everyone it sees.
      ['crm.visibility', 1],
      ['crm.figures', 1],
      // R's refusal on person 1 reaches X; X's on person 2 reaches R.
      ['crm.refusals', 2],
    ])
    expect(lines.find((line) => line.id === 'crm.figures')?.severity).toBe('warning')

    const joins = await participant.preview({
      orgId: ORG,
      plan: planConsentGroupChange({}, { h: { name: 'H', hostIds: ['g', 'y'] } }),
    })
    // Here `g` and `y` are solo sites: only person 3 has records under both.
    expect(joins.map((line) => [line.id, line.count])).toEqual([['crm.combine', 1]])
  })

  it('says "some" rather than guess when a count needs more records than it reads', async () => {
    const seed: Record<string, Record<string, unknown>> = {}
    for (let index = 0; index <= PREVIEW_SCAN_LIMIT; index += 1) {
      seed[contactPath(`c${index}`)] = { facets: { a: { sources: {}, interactions: [] } } }
    }
    const { participant } = participantOn(seed)
    const [line] = await participant.preview({
      orgId: ORG,
      plan: planConsentGroupChange({}, { g: { name: 'G', hostIds: ['a', 'b'] } }),
    })
    expect(line).toMatchObject({ id: 'crm.combine', count: null })
    expect(line.text).toContain('for some people')
  })
})
