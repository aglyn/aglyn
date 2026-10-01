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
 * The identify-moment join, driven from both ends.
 *
 * The four claims this file exists to hold:
 *
 *  1. a visitor who arrived from a campaign and converts three days later is
 *     credited to it;
 *  2. direct traffic is credited to NOTHING — no fallback, no most-recent
 *     campaign, no `utm_source=direct`;
 *  3. a touch past the window expires rather than lingering; and
 *  4. an erasure clears the claim, across every site.
 *
 * The second is the one that fails quietly: an attribution that guesses
 * produces a report that looks populated and healthy while every row in it is
 * wrong, and nothing about the screen says so.
 */

import { FieldValue } from 'firebase-admin/firestore'

/*
 * The site → org index (`hostIndex/{hostId}.orgId`), which the rollups
 * resolve through: sends and sequence reports are the ORG's. One site in
 * one org, and a site with no org at all.
 */
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host1' ? 'org1' : null),
}))

import {
  CAMPAIGN_SEQUENCE_REPORTS_COLLECTION,
  campaignConversionId,
  attributeCampaignConversion,
  creditCampaignSequenceOutcome,
  eraseCampaignAttributionsForPersonKey,
  resolveCampaignTouch,
} from './campaign-conversion-attribution'
import {
  ATTRIBUTION_WINDOW_MS,
  pageTouchWire,
  utmTouchWire,
} from '@aglyn/aglyn/app-utils/utm-touch'
import { EMAIL_ATTRIBUTION_WINDOW_DAYS as ATTRIBUTION_WINDOW_DAYS } from '@aglyn/shared-util-email/email-revenue-window'
// The identify moment's own rule since AGL-3461; an order's is still `last-click`.
import { CAMPAIGN_TOUCH_MODEL as ATTRIBUTION_MODEL } from '../model/campaign-conversions'
import {
  EMAIL_TOUCH_FIELD,
  eraseEmailCampaignTouches,
  readEmailCampaignTouch,
  recordEmailCampaignTouch,
} from './email-campaign-touch'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'

/*==========================================
 * A DOUBLE THAT APPLIES SENTINELS AT DEPTH, models `create()`, and answers
 * COLLECTION-GROUP queries.
 *
 * The first two are `email-revenue-attribution.spec.ts`'s reasons and hold
 * unchanged: the rollup increments inside a nested map, and the ALREADY_EXISTS
 * rejection from `create()` IS the idempotency that stops a retried
 * submission crediting a campaign twice — a double whose `create` behaved
 * like `set` would make the double-count case green over a hole.
 *
 * The third is this file's own. The erasure is a collection-group query, and
 * that is not a convenience: the record is per HOST and an erasure arrives as
 * an ADDRESS, so a double that could only walk one host's collection would
 * assert the erasure against a shape it does not have.
 *=========================================*/

function isIncrement(value: unknown): value is { operand: number } {
  return !!value && typeof value === 'object' && 'operand' in (value as any)
}

function isSentinel(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).isEqual === 'function'
  )
}

function applyWrite(
  target: Record<string, any>,
  update: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(update)) {
    if (isIncrement(value)) {
      next[key] = Number(next[key] ?? 0) + Number(value.operand)
      continue
    }
    if (isSentinel(value) && FieldValue.delete().isEqual(value as any)) {
      delete next[key]
      continue
    }
    if (isSentinel(value)) {
      next[key] = { serverTimestamp: true }
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const held =
        next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])
          ? next[key]
          : {}
      next[key] = applyWrite(held, value)
      continue
    }
    next[key] = value
  }
  return next
}

function fakeFirestore() {
  const store = new Map<string, Record<string, any>>()

  const snapshotOf = (path: string) => ({
    exists: store.has(path),
    id: path.split('/').pop(),
    ref: docRef(path),
    data: () => store.get(path),
    get: (field: string) => store.get(path)?.[field],
  })

  const docRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => snapshotOf(path),
    set: async (update: Record<string, any>) => {
      store.set(path, applyWrite(store.get(path) ?? {}, update))
    },
    create: async (update: Record<string, any>) => {
      if (store.has(path)) {
        const error: any = new Error('ALREADY_EXISTS')
        error.code = 6
        throw error
      }
      store.set(path, applyWrite({}, update))
    },
    update: async (update: Record<string, any>) => {
      if (!store.has(path)) throw new Error('NOT_FOUND')
      store.set(path, applyWrite(store.get(path) ?? {}, update))
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })

  /** A collection's direct documents matching every clause, for a lookup. */
  const collectionQuery = (
    prefix: string,
    clauses: Array<[string, string, unknown]> = [],
    max = Infinity,
  ): any => ({
    where: (field: string, op: string, value: unknown) =>
      collectionQuery(prefix, [...clauses, [field, op, value]], max),
    limit: (n: number) => collectionQuery(prefix, clauses, n),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .filter(([, data]) =>
          clauses.every(([field, op, value]) =>
            op === 'array-contains'
              ? Array.isArray(data[field]) && data[field].includes(value)
              : data[field] === value,
          ),
        )
        .slice(0, max)
        .map(([path]) => snapshotOf(path))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  })

  const collectionRef = (prefix: string): any => ({
    ...collectionQuery(prefix),
    doc: (id: string) => docRef(`${prefix}/${id}`),
  })

  /** Every document whose immediate parent collection has this name. */
  const groupQuery = (
    name: string,
    field?: string,
    value?: unknown,
    max = Infinity,
  ): any => ({
    where: (nextField: string, _op: string, nextValue: unknown) =>
      groupQuery(name, nextField, nextValue, max),
    limit: (n: number) => groupQuery(name, field, value, n),
    get: async () => {
      const matched = [...store.entries()]
        .filter(([path]) => path.split('/').slice(-2)[0] === name)
        .filter(([, data]) => !field || data[field] === value)
        .slice(0, max)
      const docs = matched.map(([path]) => snapshotOf(path))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  })

  return {
    collection: (name: string) => collectionRef(name),
    collectionGroup: (name: string) => groupQuery(name),
    batch: () => {
      const queued: string[] = []
      return {
        delete: (ref: any) => queued.push(ref.path),
        commit: async () => queued.forEach((path) => store.delete(path)),
      }
    },
    runTransaction: async (body: (transaction: any) => Promise<void>) =>
      body({
        get: async (ref: any) => ref.get(),
        set: async (ref: any, update: Record<string, any>) => ref.set(update),
      }),
    /** Spec helper: one conversion's attribution record. */
    attribution: (hostId: string, kind: string, refId: string) =>
      store.get(
        `hosts/${hostId}/campaignAttributions/${campaignConversionId(
          kind as never,
          refId,
        )}`,
      ),
    /** Spec helper: a send's conversion rollup, at the org. */
    conversions: (orgId: string, sendId: string) =>
      store.get(`orgs/${orgId}/campaigns/${sendId}/reports/conversions`),
    /** Spec helper: a send's conversion rollup, at the retired site path. */
    siteConversions: (hostId: string, sendId: string) =>
      store.get(`hosts/${hostId}/campaigns/${sendId}/reports/conversions`),
    /** Spec helper: seed a document. */
    seed: (path: string, data: Record<string, any>) => store.set(path, data),
    /** Spec helper: a campaign's sequences rollup (AGL-3254), at the org. */
    sequences: (orgId: string, campaignId: string) =>
      store.get(`orgs/${orgId}/${CAMPAIGN_SEQUENCE_REPORTS_COLLECTION}/${campaignId}`),
    paths: () => [...store.keys()],
  }
}

const HOST = 'host1'
const ORG = 'org1'
const VISITOR = 'visitor@example.com'
const DAY = 24 * 60 * 60 * 1000
const LANDED_AT = 1_700_000_000_000

/** The wire form a browser would have sent with the conversion. */
function webTouch(campaign: string, atMs: number): string {
  return utmTouchWire({ source: 'google', campaign, atMs })
}

/** Record a click on our own mail, the way the delivery webhook does. */
async function clickedMail(
  firestore: any,
  campaignId: string,
  atMs: number,
  email = VISITOR,
) {
  return recordEmailCampaignTouch(
    { email, hostId: HOST, campaignId, atMs },
    firestore,
  )
}

describe('resolveCampaignTouch', () => {
  it('THE WEB CHANNEL — labels the visitor carried, with no address in sight', async () => {
    const firestore = fakeFirestore()

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('sept-launch', LANDED_AT), atMs: LANDED_AT + 3 * DAY },
      firestore,
    )

    expect(touch).toEqual({
      channel: 'web',
      source: 'google',
      campaign: 'sept-launch',
      touchedAtMs: LANDED_AT,
    })
  })

  it('THE EMAIL CHANNEL — the click the delivery webhook already recorded', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)

    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + 3 * DAY },
      firestore,
    )

    expect(touch).toEqual({
      channel: 'email',
      campaignId: 'spring',
      touchedAtMs: LANDED_AT,
      personKey: personKey(VISITOR),
    })
  })

  it('DIRECT — no wire, no click, nothing invented', async () => {
    const firestore = fakeFirestore()

    expect(
      await resolveCampaignTouch(
        { hostId: HOST, email: VISITOR, atMs: LANDED_AT },
        firestore,
      ),
    ).toBe(null)
  })

  it('LAST TOUCH — the later web touch beats the earlier click', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: webTouch('autumn', LANDED_AT + DAY),
        atMs: LANDED_AT + 2 * DAY,
      },
      firestore,
    )

    expect(touch?.channel).toBe('web')
    expect(touch?.campaign).toBe('autumn')
  })

  it('LAST TOUCH — the later click beats the earlier web touch', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT + DAY)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: webTouch('autumn', LANDED_AT),
        atMs: LANDED_AT + 2 * DAY,
      },
      firestore,
    )

    expect(touch?.channel).toBe('email')
    expect(touch?.campaignId).toBe('spring')
  })

  it('a tie goes to the click, which is the evidence we recorded ourselves', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: webTouch('autumn', LANDED_AT),
        atMs: LANDED_AT + DAY,
      },
      firestore,
    )

    expect(touch?.channel).toBe('email')
  })

  it('an EXPIRED web touch leaves the click standing', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT + 6 * DAY)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: webTouch('autumn', LANDED_AT),
        atMs: LANDED_AT + ATTRIBUTION_WINDOW_MS + 1,
      },
      firestore,
    )

    expect(touch?.channel).toBe('email')
    expect(touch?.campaignId).toBe('spring')
  })

  it('an EXPIRED click leaves the web touch standing', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: webTouch('autumn', LANDED_AT + 6 * DAY),
        atMs: LANDED_AT + ATTRIBUTION_WINDOW_MS + 1,
      },
      firestore,
    )

    expect(touch?.channel).toBe('web')
    expect(touch?.campaign).toBe('autumn')
  })

  it('BOTH EXPIRED — the visitor reads as direct rather than as the least stale', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)

    expect(
      await resolveCampaignTouch(
        {
          hostId: HOST,
          email: VISITOR,
          wire: webTouch('autumn', LANDED_AT),
          atMs: LANDED_AT + ATTRIBUTION_WINDOW_MS + 1,
        },
        firestore,
      ),
    ).toBe(null)
  })

  it("a click on ANOTHER site is not this site's touch", async () => {
    const firestore = fakeFirestore()
    await recordEmailCampaignTouch(
      { email: VISITOR, hostId: 'host2', campaignId: 'spring', atMs: LANDED_AT },
      firestore,
    )

    expect(
      await resolveCampaignTouch(
        { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
        firestore,
      ),
    ).toBe(null)
  })

  it('an anonymous conversion costs no keyed read', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)
    const reads: string[] = []
    const counted = {
      ...firestore,
      collection: (name: string) => {
        reads.push(name)
        return (firestore as any).collection(name)
      },
    }

    await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('autumn', LANDED_AT), atMs: LANDED_AT + DAY },
      counted,
    )

    // The email channel is only askable of somebody who named an address, and
    // asking anyway would put a Firestore read on every anonymous form
    // submission on the platform. The one question a LABELED arrival does ask
    // is whether a campaign declares its label (AGL-3461), of the org.
    expect(reads.filter((name) => name !== 'orgs')).toEqual([])
  })

  it('an arrival from nowhere asks nothing at all', async () => {
    const firestore = fakeFirestore()
    const reads: string[] = []
    const counted = {
      ...firestore,
      collection: (name: string) => {
        reads.push(name)
        return (firestore as any).collection(name)
      },
    }

    expect(await resolveCampaignTouch({ hostId: HOST, atMs: LANDED_AT }, counted)).toBe(null)
    expect(reads).toEqual([])
  })
})

/*==========================================
 * CREDIT WITHOUT A LABEL (AGL-3461): a page filed under a campaign, and a
 * label a campaign declares as its own.
 *=========================================*/

const SCREEN = 'scr_landing'
const PAGE = '/ai-website-draft'

/** The org's campaign `id`, placed on every site, declaring `labels`. */
function seedCampaign(
  firestore: ReturnType<typeof fakeFirestore>,
  id: string,
  extra: Record<string, unknown> = {},
) {
  firestore.seed(`orgs/${ORG}/emailCampaigns/${id}`, {
    name: `Campaign ${id}`,
    visibleTo: ['org'],
    ...extra,
  })
}

/** The landing page, filed under `campaignIds`. */
function seedScreen(firestore: ReturnType<typeof fakeFirestore>, campaignIds: string[]) {
  firestore.seed(`hosts/${HOST}/screens/${SCREEN}`, { campaignIds })
}

/** The wire a browser sends from a page filed under `campaignIds`, viewed at `atMs`. */
function pageWire(campaignIds: string[], atMs: number): string {
  return pageTouchWire({ containerIds: campaignIds, screenId: SCREEN, path: PAGE, atMs })
}

describe('a page filed under a campaign is a campaign touch', () => {
  it('credits the campaign with no label on the address at all', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: pageWire(['camp_ai'], LANDED_AT), atMs: LANDED_AT + 60_000 },
      firestore,
    )

    expect(touch).toEqual({
      channel: 'page',
      campaignId: 'camp_ai',
      screenId: SCREEN,
      path: PAGE,
      touchedAtMs: LANDED_AT,
    })
  })

  it('is written to the record with the rule it was credited under', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])
    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: pageWire(['camp_ai'], LANDED_AT), atMs: LANDED_AT + 60_000 },
      firestore,
    )

    await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 'sub1', touch, convertedAtMs: LANDED_AT + 60_000 },
      firestore,
    )

    expect(firestore.attribution(HOST, 'form', 'sub1')).toMatchObject({
      channel: 'page',
      campaignId: 'camp_ai',
      screenId: SCREEN,
      path: PAGE,
      model: 'last-touch',
      windowDays: ATTRIBUTION_WINDOW_DAYS,
    })
    // No per-send rollup: the campaign's page counts its own id's records.
    expect(firestore.paths().some((path) => path.includes('/reports/'))).toBe(false)
  })

  it('credits nothing once the page is no longer filed under the campaign', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, [])

    expect(
      await resolveCampaignTouch(
        { hostId: HOST, wire: pageWire(['camp_ai'], LANDED_AT), atMs: LANDED_AT + DAY },
        firestore,
      ),
    ).toBe(null)
  })

  it('credits nothing for a campaign that was deleted', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai', { deletedAt: 1 })
    seedScreen(firestore, ['camp_ai'])

    expect(
      await resolveCampaignTouch(
        { hostId: HOST, wire: pageWire(['camp_ai'], LANDED_AT), atMs: LANDED_AT + DAY },
        firestore,
      ),
    ).toBe(null)
  })

  it('a page under two campaigns credits the first that still stands', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_b')
    seedScreen(firestore, ['camp_a', 'camp_b'])

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: pageWire(['camp_a', 'camp_b'], LANDED_AT), atMs: LANDED_AT + DAY },
      firestore,
    )

    expect(touch?.campaignId).toBe('camp_b')
  })

  it('a visitor whose clock runs a minute fast is still credited', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: pageWire(['camp_ai'], LANDED_AT + 60_000), atMs: LANDED_AT },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'page', touchedAtMs: LANDED_AT })
  })

  it('THE SAME VISIT — the campaign email that sent the reader keeps the credit', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])
    await clickedMail(firestore, 'send_1', LANDED_AT)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: pageWire(['camp_ai'], LANDED_AT + 5_000),
        atMs: LANDED_AT + 10 * 60_000,
      },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'email', campaignId: 'send_1' })
  })

  it('A LATER VISIT — the page beats a click from days before', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])
    await clickedMail(firestore, 'send_1', LANDED_AT)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: pageWire(['camp_ai'], LANDED_AT + 2 * DAY),
        atMs: LANDED_AT + 2 * DAY + 60_000,
      },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'page', campaignId: 'camp_ai' })
  })

  it('a click days AFTER the page beats it', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])
    await clickedMail(firestore, 'send_1', LANDED_AT + 2 * DAY)

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        email: VISITOR,
        wire: pageWire(['camp_ai'], LANDED_AT),
        atMs: LANDED_AT + 3 * DAY,
      },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'email', campaignId: 'send_1' })
  })

  it('THE SAME VISIT — a label no campaign declares yields to the page', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedScreen(firestore, ['camp_ai'])

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        wire: `${webTouch('random-push', LANDED_AT + 60_000)}&${pageWire(['camp_ai'], LANDED_AT)}`,
        atMs: LANDED_AT + 2 * 60_000,
      },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'page', campaignId: 'camp_ai' })
  })
})

describe('a utm_campaign label a campaign declares names the campaign', () => {
  it('credits the campaign document, keeping the labels on the record', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai', { utmCampaigns: ['onejob-ai'] })

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('OneJob-AI', LANDED_AT), atMs: LANDED_AT + DAY },
      firestore,
    )

    expect(touch).toEqual({
      channel: 'web',
      campaignId: 'camp_ai',
      source: 'google',
      campaign: 'OneJob-AI',
      touchedAtMs: LANDED_AT,
    })
  })

  it('a label two campaigns claim credits neither — the label stays text', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_a', { utmCampaigns: ['spring'] })
    seedCampaign(firestore, 'camp_b', { utmCampaigns: ['spring'] })

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('spring', LANDED_AT), atMs: LANDED_AT + DAY },
      firestore,
    )

    expect(touch?.campaignId).toBeUndefined()
    expect(touch?.campaign).toBe('spring')
  })

  it('a campaign placed only on another site does not claim this site’s label', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_a', { utmCampaigns: ['spring'], visibleTo: ['host:other'] })

    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('spring', LANDED_AT), atMs: LANDED_AT + DAY },
      firestore,
    )

    expect(touch?.campaignId).toBeUndefined()
  })

  it('THE SAME VISIT — a declared label keeps the credit over the page it landed on', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai', { utmCampaigns: ['onejob-ai'] })
    seedCampaign(firestore, 'camp_other')
    seedScreen(firestore, ['camp_other'])

    const touch = await resolveCampaignTouch(
      {
        hostId: HOST,
        wire: `${webTouch('onejob-ai', LANDED_AT)}&${pageWire(['camp_other'], LANDED_AT + 1_000)}`,
        atMs: LANDED_AT + 60_000,
      },
      firestore,
    )

    expect(touch).toMatchObject({ channel: 'web', campaignId: 'camp_ai' })
  })
})

describe('attributeCampaignConversion', () => {
  it('THREE DAYS LATER — the form submission is credited to the campaign', async () => {
    const firestore = fakeFirestore()
    const convertedAtMs = LANDED_AT + 3 * DAY
    const touch = await resolveCampaignTouch(
      { hostId: HOST, wire: webTouch('sept-launch', LANDED_AT), atMs: convertedAtMs },
      firestore,
    )

    const record = await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 'submission1', touch, convertedAtMs },
      firestore,
    )

    expect(record).toMatchObject({
      kind: 'form',
      refId: 'submission1',
      channel: 'web',
      source: 'google',
      campaign: 'sept-launch',
      touchedAtMs: LANDED_AT,
      convertedAtMs,
    })
    expect(firestore.attribution(HOST, 'form', 'submission1')).toMatchObject({
      campaign: 'sept-launch',
      model: ATTRIBUTION_MODEL,
      windowDays: ATTRIBUTION_WINDOW_DAYS,
    })
  })

  it('DIRECT TRAFFIC — nothing is written anywhere', async () => {
    const firestore = fakeFirestore()

    const record = await attributeCampaignConversion(
      {
        hostId: HOST,
        kind: 'lead',
        refId: 'lead1',
        touch: null,
        convertedAtMs: LANDED_AT,
      },
      firestore,
    )

    expect(record).toBe(null)
    // Not an empty record, not a record naming "direct". The absence IS the
    // report's answer, and a miss must cost no write at all.
    expect(firestore.paths()).toEqual([])
  })

  it('a touch that aged out between the resolve and the write is refused', async () => {
    const firestore = fakeFirestore()

    const record = await attributeCampaignConversion(
      {
        hostId: HOST,
        kind: 'form',
        refId: 'submission1',
        touch: { channel: 'web', campaign: 'sept', touchedAtMs: LANDED_AT },
        convertedAtMs: LANDED_AT + ATTRIBUTION_WINDOW_MS + 1,
      },
      firestore,
    )

    expect(record).toBe(null)
    expect(firestore.attribution(HOST, 'form', 'submission1')).toBeUndefined()
  })

  it('stamps the address hash so an erasure can find it', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)
    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )

    await attributeCampaignConversion(
      {
        hostId: HOST,
        kind: 'lead',
        refId: 'lead1',
        touch,
        convertedAtMs: LANDED_AT + DAY,
      },
      firestore,
    )

    expect(firestore.attribution(HOST, 'lead', 'lead1').personKey).toBe(
      personKey(VISITOR),
    )
  })

  it('THE EMAIL CHANNEL rolls up under the campaign, by kind', async () => {
    const firestore = fakeFirestore()
    firestore.seed(`orgs/${ORG}/campaigns/spring`, { hostId: HOST })
    await clickedMail(firestore, 'spring', LANDED_AT)
    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )

    await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 's1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )
    await attributeCampaignConversion(
      { hostId: HOST, kind: 'lead', refId: 'l1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )

    // Never summed across kinds: one visitor action writes a submission AND a
    // lead, and adding them would double every campaign's conversions.
    expect(firestore.conversions(ORG, 'spring')).toMatchObject({
      byKind: { form: 1, lead: 1 },
      model: ATTRIBUTION_MODEL,
      windowDays: ATTRIBUTION_WINDOW_DAYS,
    })
    expect(firestore.siteConversions(HOST, 'spring')).toBeUndefined()
  })

  it('THE EMAIL CHANNEL rolls up at the site for a send the migration has not reached', async () => {
    const firestore = fakeFirestore()
    firestore.seed(`hosts/${HOST}/campaigns/spring`, { subject: 'Spring' })
    await clickedMail(firestore, 'spring', LANDED_AT)
    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )

    await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 's1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )

    expect(firestore.siteConversions(HOST, 'spring')).toMatchObject({ byKind: { form: 1 } })
    expect(firestore.conversions(ORG, 'spring')).toBeUndefined()
  })

  it('THE EMAIL CHANNEL writes the record and no rollup for a send that is gone', async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'discarded', LANDED_AT)
    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )

    const record = await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 's1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )

    expect(record).toMatchObject({ channel: 'email', campaignId: 'discarded' })
    expect(firestore.paths().filter((path) => path.includes('/reports/'))).toEqual([])
  })

  /*
   * A SEQUENCE touch (AGL-3254): the Outreach click route stamps the same
   * touch map with the sequence and the enrollment beside the campaign the
   * sequence is in, so the booking door credits a meeting made from a
   * sequence link with no knowledge of what a sequence is.
   */
  it('THE SEQUENCE CHANNEL — a click on a sequence email reads as the sequence, under its campaign', async () => {
    const firestore = fakeFirestore()
    await recordEmailCampaignTouch(
      {
        email: VISITOR,
        hostId: HOST,
        campaignId: 'founder-icp2',
        atMs: LANDED_AT,
        sequenceId: 'seq-1',
        enrollmentId: 'seq-1_lead-key',
      },
      firestore,
    )

    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )
    expect(touch).toMatchObject({
      channel: 'sequence',
      campaignId: 'founder-icp2',
      sequenceId: 'seq-1',
      enrollmentId: 'seq-1_lead-key',
    })

    await attributeCampaignConversion(
      { hostId: HOST, kind: 'booking', refId: 'b1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )
    await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 's1', touch, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )

    // The record names the sequence, so the booking's page can say which
    // rep's outreach it came from.
    expect(firestore.attribution(HOST, 'booking', 'b1')).toMatchObject({
      channel: 'sequence',
      campaignId: 'founder-icp2',
      sequenceId: 'seq-1',
      enrollmentId: 'seq-1_lead-key',
    })
    // The meeting rolls up under the campaign's SEQUENCES report; the form
    // stands as a record and never in `byKind`, which promises the reader
    // campaign emails only.
    expect(firestore.sequences(ORG, 'founder-icp2')).toMatchObject({
      byOutcome: { meetings: 1 },
      updatedAtMs: LANDED_AT + DAY,
    })
    expect(firestore.conversions(ORG, 'founder-icp2')).toBeUndefined()
  })

  it('a later campaign click takes the sequence off the touch', async () => {
    const firestore = fakeFirestore()
    await recordEmailCampaignTouch(
      {
        email: VISITOR,
        hostId: HOST,
        campaignId: 'founder-icp2',
        atMs: LANDED_AT,
        sequenceId: 'seq-1',
        enrollmentId: 'seq-1_lead-key',
      },
      firestore,
    )
    await clickedMail(firestore, 'spring', LANDED_AT + 1)

    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )
    expect(touch).toEqual({
      channel: 'email',
      campaignId: 'spring',
      touchedAtMs: LANDED_AT + 1,
      personKey: personKey(VISITOR),
    })
  })

  it('THE WEB CHANNEL writes no rollup — a label is not a campaign document', async () => {
    const firestore = fakeFirestore()

    await attributeCampaignConversion(
      {
        hostId: HOST,
        kind: 'form',
        refId: 's1',
        touch: { channel: 'web', campaign: 'sept', touchedAtMs: LANDED_AT },
        convertedAtMs: LANDED_AT,
      },
      firestore,
    )

    // A rollup keyed on a marketer-typed label is a map anybody who can vary
    // a query string can grow without bound.
    expect(firestore.paths()).toEqual([
      `hosts/${HOST}/campaignAttributions/form:s1`,
    ])
  })

  it('IDEMPOTENT — a retried conversion does not credit the campaign twice', async () => {
    const firestore = fakeFirestore()
    firestore.seed(`orgs/${ORG}/campaigns/spring`, { hostId: HOST })
    await clickedMail(firestore, 'spring', LANDED_AT)
    const touch = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )
    const call = () =>
      attributeCampaignConversion(
        {
          hostId: HOST,
          kind: 'booking',
          refId: 'booking1',
          touch,
          convertedAtMs: LANDED_AT + DAY,
        },
        firestore,
      )

    expect(await call()).not.toBe(null)
    expect(await call()).toBe(null)

    expect(firestore.conversions(ORG, 'spring').byKind.booking).toBe(1)
  })

  it('refuses a reference that is not one path component', async () => {
    const firestore = fakeFirestore()

    expect(
      await attributeCampaignConversion(
        {
          hostId: HOST,
          kind: 'form',
          refId: 'half/path',
          touch: { channel: 'web', campaign: 'sept', touchedAtMs: LANDED_AT },
          convertedAtMs: LANDED_AT,
        },
        firestore,
      ),
    ).toBe(null)
    expect(firestore.paths()).toEqual([])
  })
})

/*
 * The Outreach runtime's own credits (AGL-3254): one increment per campaign
 * per outcome, idempotency being the caller's.
 */
describe('creditCampaignSequenceOutcome', () => {
  it('credits every campaign named, once each, and skips an unusable id', async () => {
    const firestore = fakeFirestore()
    const credited = await creditCampaignSequenceOutcome(
      {
        hostId: HOST,
        campaignIds: ['founder-icp2', 'founder-icp1', 'founder-icp2', 'bad/id', ''],
        outcome: 'enrolled',
        atMs: LANDED_AT,
      },
      firestore,
    )
    await creditCampaignSequenceOutcome(
      { hostId: HOST, campaignIds: ['founder-icp2'], outcome: 'sent', atMs: LANDED_AT + 1 },
      firestore,
    )

    expect(credited).toBe(2)
    expect(firestore.sequences(ORG, 'founder-icp2')).toMatchObject({
      byOutcome: { enrolled: 1, sent: 1 },
      updatedAtMs: LANDED_AT + 1,
    })
    expect(firestore.sequences(ORG, 'founder-icp1')).toMatchObject({ byOutcome: { enrolled: 1 } })
    expect(firestore.paths().filter((path) => path.includes('bad'))).toEqual([])
    expect(firestore.paths().filter((path) => path.startsWith('hosts/'))).toEqual([])
  })

  it('credits the org the caller names without resolving the site', async () => {
    const firestore = fakeFirestore()
    await creditCampaignSequenceOutcome(
      { hostId: 'unindexed-site', orgId: 'org2', campaignIds: ['c1'], outcome: 'replied' },
      firestore,
    )
    expect(firestore.sequences('org2', 'c1')).toMatchObject({ byOutcome: { replied: 1 } })
  })

  it('writes nothing for a site that belongs to no org', async () => {
    const firestore = fakeFirestore()
    expect(
      await creditCampaignSequenceOutcome(
        { hostId: 'unindexed-site', campaignIds: ['c1'], outcome: 'sent' },
        firestore,
      ),
    ).toBe(0)
    expect(firestore.paths()).toEqual([])
  })

  it('writes nothing for an outcome it does not name, or a host that is not a document id', async () => {
    const firestore = fakeFirestore()
    expect(
      await creditCampaignSequenceOutcome(
        { hostId: HOST, campaignIds: ['a'], outcome: 'opened' as never },
        firestore,
      ),
    ).toBe(0)
    expect(
      await creditCampaignSequenceOutcome(
        { hostId: 'hosts/x', campaignIds: ['a'], outcome: 'sent' },
        firestore,
      ),
    ).toBe(0)
    expect(firestore.paths()).toEqual([])
  })
})

describe('eraseCampaignAttributionsForPersonKey', () => {
  async function seed(firestore: any) {
    await clickedMail(firestore, 'spring', LANDED_AT)
    await recordEmailCampaignTouch(
      {
        email: 'other@example.com',
        hostId: 'host2',
        campaignId: 'spring',
        atMs: LANDED_AT,
      },
      firestore,
    )
    const mine = await resolveCampaignTouch(
      { hostId: HOST, email: VISITOR, atMs: LANDED_AT + DAY },
      firestore,
    )
    const theirs = await resolveCampaignTouch(
      { hostId: 'host2', email: 'other@example.com', atMs: LANDED_AT + DAY },
      firestore,
    )
    await attributeCampaignConversion(
      { hostId: HOST, kind: 'form', refId: 's1', touch: mine, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )
    await attributeCampaignConversion(
      { hostId: 'host2', kind: 'lead', refId: 'l1', touch: mine, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )
    await attributeCampaignConversion(
      { hostId: 'host2', kind: 'form', refId: 's2', touch: theirs, convertedAtMs: LANDED_AT + DAY },
      firestore,
    )
  }

  it("removes the person's claims on EVERY site", async () => {
    const firestore = fakeFirestore()
    await seed(firestore)

    const removed = await eraseCampaignAttributionsForPersonKey(
      personKey(VISITOR),
      firestore,
    )

    // Per address, not per host: an erasure request names an address and
    // knows nothing about which sites it ever visited.
    expect(removed).toBe(2)
    expect(firestore.attribution(HOST, 'form', 's1')).toBeUndefined()
    expect(firestore.attribution('host2', 'lead', 'l1')).toBeUndefined()
  })

  it("leaves everybody else's claims exactly where they are", async () => {
    const firestore = fakeFirestore()
    await seed(firestore)

    await eraseCampaignAttributionsForPersonKey(personKey(VISITOR), firestore)

    expect(firestore.attribution('host2', 'form', 's2')).toMatchObject({
      personKey: personKey('other@example.com'),
    })
  })

  it('erases nothing for an unusable key', async () => {
    const firestore = fakeFirestore()
    await seed(firestore)

    expect(await eraseCampaignAttributionsForPersonKey(null, firestore)).toBe(0)
    expect(await eraseCampaignAttributionsForPersonKey('', firestore)).toBe(0)
    expect(firestore.attribution(HOST, 'form', 's1')).toBeDefined()
  })
})

describe('eraseEmailCampaignTouches', () => {
  it("forgets the person's click on every site, and only theirs", async () => {
    const firestore = fakeFirestore()
    await clickedMail(firestore, 'spring', LANDED_AT)
    await recordEmailCampaignTouch(
      { email: VISITOR, hostId: 'host2', campaignId: 'autumn', atMs: LANDED_AT },
      firestore,
    )
    await recordEmailCampaignTouch(
      { email: 'other@example.com', hostId: HOST, campaignId: 'spring', atMs: LANDED_AT },
      firestore,
    )

    expect(await eraseEmailCampaignTouches(personKey(VISITOR), firestore)).toBe(true)

    // The strongest personal fact on the delivery document — it names the
    // person AND what they were reading — so nothing may go on crediting
    // their future orders to mail they asked us to forget.
    expect(await readEmailCampaignTouch(VISITOR, HOST, firestore)).toBeNull()
    expect(await readEmailCampaignTouch(VISITOR, 'host2', firestore)).toBeNull()
    expect(await readEmailCampaignTouch('other@example.com', HOST, firestore)).toMatchObject({
      campaignId: 'spring',
    })
  })

  it('leaves no document behind for a person the log never held', async () => {
    const firestore = fakeFirestore()

    expect(await eraseEmailCampaignTouches(personKey(VISITOR), firestore)).toBe(false)
    expect(await eraseEmailCampaignTouches(null, firestore)).toBe(false)
    expect(firestore.paths()).toEqual([])
  })

  it('keeps the field name the delivery log has always stored', () => {
    // A rename here would strand every touch already written.
    expect(EMAIL_TOUCH_FIELD).toBe('campaignTouches')
  })
})
