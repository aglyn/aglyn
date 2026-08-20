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
 *
 * @jest-environment node
 */

/**
 * A paid listing under the price floor is REFUSED (AGL-2343).
 *
 * THE DEFECT. Marketplace checkout is a destination charge with a fixed
 * `transfer_data[amount]` and deliberately no `application_fee_amount`, so the
 * sales tax stays with the platform that owes it (AGL-1544) — which means
 * Stripe debits its processing fee from the PLATFORM's balance. Stripe's fixed
 * 30¢ does not shrink with the price while the platform's cut does, so a $1
 * sale left Aglyn at −$0.13 and every publish door accepted one: five doors
 * validated the price against the MAXIMUM only, and `publish-theme.ts` and
 * `publish-layout.ts` validated it not at all.
 *
 * THREE LAYERS, because none of them is sufficient alone:
 *
 * 1. the DECISION, unit-tested — including the free listing, which is not
 *    "below the floor" and must stay publishable;
 * 2. two doors driven END TO END to a real 400 with a real Firestore double,
 *    with the publish that SUCCEEDS at the floor as the negative control — a
 *    validator that refused everything would pass a refusal-only suite;
 * 3. a coverage guard that DERIVES the door list from the directory, so the
 *    eighth publish route somebody writes next year is in scope the day it
 *    lands.
 *
 * `publish-layout.ts` is one of the two driven doors on purpose: it is one of
 * the pair that had no price validation at all, so it is the one where a floor
 * that lived only in a constant would still be a $1 listing.
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  marketplaceMinPriceUsd,
  marketplaceSaleEconomics,
  bindingMarketplaceFeePct,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PUBLISHER_AGREEMENT_VERSION } from '@aglyn/aglyn/app-utils/publisher-agreement'
import {
  MARKETPLACE_MAX_PRICE_USD,
  MARKETPLACE_MIN_PRICE_USD,
  marketplacePriceRefusal,
} from '../model/marketplace'
import { publishPreconditionRefusal } from './publish-preconditions'

/** The canvas root-collection wrapper — `CANVAS_ROOT_ELEMENT_ID`. */
const ROOT = '_@_'
/** The node marking where a bound screen's content grafts in. */
const LAYOUT_SLOT_COMPONENT_ID = 'layoutSlot'

/** A publishable layout: wrapper root, chrome, and the content slot. */
const LAYOUT_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['bar', 'slot'] },
  bar: { componentId: 'muiAppBar', parentId: ROOT, nodes: [] },
  slot: { componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
}

/** A publishable screen: wrapper root, one allowlisted child. */
const SCREEN_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['hero'] },
  hero: {
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'Welcome' },
  },
}

/**
 * The document store the firestore mock serves, keyed by path. Reset per test
 * so a handler's own writes cannot leak into the next one.
 *
 * The same double as `publish-stored-nodes.spec.ts`, repeated rather than
 * imported: jest module factories are per FILE, so a shared harness would have
 * to be a module these specs both mock, and importing another spec file would
 * re-run its suite here.
 */
let store: Record<string, Record<string, any>> = {}
/** Every `set` the handlers performed, in order. */
let writes: Array<{ path: string; data: any }> = []

jest.mock('@aglyn/aglyn/server', () => ({
  CANVAS_ROOT_ELEMENT_ID: '_@_',
  checkEntitlement: () => true,
  createResourceUid: () => 'listing-new',
  decodeStoredNodes: (
    jest.requireActual('@aglyn/aglyn/app-utils/stored-nodes') as {
      decodeStoredNodes: (raw: unknown) => unknown
    }
  ).decodeStoredNodes,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => ({
    orgId: 'org-1',
    handle: 'acme',
    stripeChargesEnabled: true,
    agreement: (
      jest.requireMock('./publisher-profile') as {
        __agreement: { version: string } | undefined
      }
    ).__agreement,
  }),
  __agreement: undefined as { version: string } | undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = () =>
    jest.requireMock('@aglyn/tenant-data-admin') as {
      __store: Record<string, Record<string, any>>
      __writes: Array<{ path: string; data: any }>
    }
  const snapshotFor = (path: string) => {
    const data = state().__store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    get: async () => snapshotFor(path),
    set: async (data: Record<string, unknown>) => {
      state().__writes.push({ path, data })
      state().__store[path] = { ...(state().__store[path] ?? {}), ...data }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => {
    const query: any = {
      where: () => query,
      limit: () => query,
      get: async () => ({ empty: true, docs: [] }),
    }
    return { ...query, doc: (id: string) => docRef(`${path}/${id}`) }
  }
  return {
    __store: {} as Record<string, Record<string, any>>,
    __writes: [] as Array<{ path: string; data: any }>,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-1' }) }),
        firestore: () => ({ collection: (name: string) => collectionRef(name) }),
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
        },
        Timestamp: { now: () => 'TS' },
      },
    },
    getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  }
})

const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __store: Record<string, Record<string, any>>
  __writes: Array<{ path: string; data: any }>
}
const profileMock = jest.requireMock('./publisher-profile') as {
  __agreement: { version: string } | undefined
}

import { publishTemplateHandler } from './publish-template'
import { publishLayoutHandler } from './publish-layout'

function respond() {
  const result: { status: number; body: any } = { status: 0, body: null }
  const res = {
    status(code: number) {
      result.status = code
      return {
        json(body: unknown) {
          result.body = body
          return body
        },
      }
    },
  }
  return { res, result }
}

/** Seeds a host with one publishable screen and one publishable layout. */
function seed() {
  profileMock.__agreement = { version: PUBLISHER_AGREEMENT_VERSION }
  store = {}
  store['hosts/host-1'] = {
    memberRoles: { 'uid-1': 'admin' },
    screens: { 'screen-1': '/home' },
    theme: { palette: 'light' },
  }
  store['hosts/host-1/screens/screen-1'] = {
    displayName: 'Home',
    versionId: 'v1',
  }
  store['hosts/host-1/screens/screen-1/versions/v1'] = { nodes: SCREEN_NODES }
  store['hosts/host-1/layouts/layout-1'] = { versionId: 'v1' }
  store['hosts/host-1/layouts/layout-1/versions/v1'] = { nodes: LAYOUT_NODES }
  writes = []
  adminMock.__store = store
  adminMock.__writes = writes
}

async function publishTemplateAt(priceUsd: unknown) {
  const { res, result } = respond()
  await publishTemplateHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', displayName: 'Starter site', priceUsd },
    } as never,
    res as never,
  )
  return result
}

async function publishLayoutAt(priceUsd: unknown) {
  const { res, result } = respond()
  await publishLayoutHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        hostId: 'host-1',
        layoutId: 'layout-1',
        displayName: 'Shell',
        priceUsd,
      },
    } as never,
    res as never,
  )
  return result
}

/** The `versions/<n>` write a successful publish makes, or undefined. */
const versionWrite = () =>
  writes.find((write) => /\/versions\/\d+$/.test(write.path))?.data

const FLOOR = MARKETPLACE_MIN_PRICE_USD

describe('the price floor decision (AGL-2343)', () => {
  it('is the derived break-even figure, not a literal typed beside it', () => {
    // The constant the routes enforce and the figure the console forms show
    // must be ONE number. Two copies is how a route comes to refuse a price a
    // form invited.
    expect(MARKETPLACE_MIN_PRICE_USD).toBe(marketplaceMinPriceUsd())
  })

  it('does not lose money AT the floor, and does one dollar below', () => {
    // The property Zach asked for, asserted directly on the money: "a minimum
    // price floor that does not cause us to lose money" (2026-08-19). Both
    // directions, because a floor set too HIGH also passes a one-sided test.
    const fee = bindingMarketplaceFeePct()
    expect(
      marketplaceSaleEconomics(FLOOR, fee).platformNetCents,
    ).toBeGreaterThanOrEqual(0)
    expect(
      marketplaceSaleEconomics(FLOOR - 1, fee).platformNetCents,
    ).toBeLessThan(0)
  })

  it('refuses a paid price below the floor, and says the minimum', () => {
    const refusal = marketplacePriceRefusal(1)
    expect(refusal).toBeDefined()
    expect(refusal).toContain(`$${FLOOR}`)
    // The publisher is told what to do instead, not only what is wrong.
    expect(refusal).toContain('Use 0 for a free listing')
  })

  it('lets a FREE listing through — zero is not below the floor', () => {
    // A $0 listing takes no payment at all, so it costs nothing to process.
    // The obvious wrong fix — `priceUsd < MIN` — would block every free
    // listing on the marketplace.
    expect(marketplacePriceRefusal(0)).toBeUndefined()
  })

  it('lets an ordinary price through', () => {
    // The negative control for a validator that refused everything.
    expect(marketplacePriceRefusal(FLOOR)).toBeUndefined()
    expect(marketplacePriceRefusal(25)).toBeUndefined()
    expect(marketplacePriceRefusal(MARKETPLACE_MAX_PRICE_USD)).toBeUndefined()
  })

  it('still refuses above the ceiling and below zero', () => {
    // The ceiling moved into this validator from five inline copies, and into
    // two doors that never had one. Losing it here would be a silent
    // regression on the other half of the range.
    expect(marketplacePriceRefusal(MARKETPLACE_MAX_PRICE_USD + 1)).toBeDefined()
    expect(marketplacePriceRefusal(-1)).toBeDefined()
    expect(marketplacePriceRefusal(Number.NaN)).toBeDefined()
  })

  it('is enforced by the shared precondition gate, as a 400', () => {
    // 400, not the 412 the setup preconditions use: a price below the floor is
    // a bad REQUEST, fixable in the form, not a missing setup step.
    const refusal = publishPreconditionRefusal(
      {
        orgId: 'org-1',
        handle: 'acme',
        stripeChargesEnabled: true,
        agreement: { version: PUBLISHER_AGREEMENT_VERSION },
      } as never,
      { priceUsd: 1, sells: 'themes' },
    )
    expect(refusal?.status).toBe(400)
    expect(String(refusal?.body.error)).toContain(`$${FLOOR}`)
  })

  it('reports the price before the org-setup refusals', () => {
    // A publisher who is sent to set up payouts and then bounced again on the
    // price they had already typed has been made to do the work twice.
    const refusal = publishPreconditionRefusal(null, {
      priceUsd: 1,
      sells: 'themes',
    })
    expect(refusal?.status).toBe(400)
    expect(String(refusal?.body.error)).toContain(`$${FLOOR}`)
  })
})

describe('a publish route refuses a below-floor listing (AGL-2343)', () => {
  beforeEach(() => seed())

  it('refuses $1 on the site-template door with a 400 and no write', () => {
    return publishTemplateAt(1).then((result) => {
      expect(result.status).toBe(400)
      expect(String(result.body.error)).toContain(`$${FLOOR}`)
      // The refusal has to happen BEFORE the listing exists. A route that
      // wrote the version and then complained would have listed the $1 price.
      expect(versionWrite()).toBeUndefined()
      expect(writes).toEqual([])
    })
  })

  it('refuses $1 on the LAYOUT door, which validated no price at all', () => {
    return publishLayoutAt(1).then((result) => {
      expect(result.status).toBe(400)
      expect(String(result.body.error)).toContain(`$${FLOOR}`)
      expect(writes).toEqual([])
    })
  })

  it('refuses a price ABOVE the ceiling on the layout door too', () => {
    // Same door, other end of the range: it had no ceiling either, so a
    // $250,000 layout was publishable.
    return publishLayoutAt(MARKETPLACE_MAX_PRICE_USD + 1).then((result) => {
      expect(result.status).toBe(400)
      expect(writes).toEqual([])
    })
  })

  it('publishes AT the floor, and stores that price', async () => {
    // THE NEGATIVE CONTROL. Without it every assertion above would pass
    // against a route that refused every publish.
    const result = await publishTemplateAt(FLOOR)

    expect(result.status).toBe(200)
    expect(versionWrite()).toBeDefined()
    const listingWrite = writes.find((write) =>
      /^marketplaceListings\/[^/]+$/.test(write.path),
    )
    expect(listingWrite?.data.priceUsd).toBe(FLOOR)
  })

  it('publishes a FREE listing, which takes no payment to process', async () => {
    const result = await publishLayoutAt(0)

    expect(result.status).toBe(200)
    expect(versionWrite()).toBeDefined()
  })
})

/**
 * THE GUARD. Derived from the directory, never from a hand list — the same
 * discriminator `publish-agreement-gate.spec.ts` uses, for the same reason: a
 * floor that six of seven doors enforce is not a floor.
 */
describe('every publish door validates the price (AGL-2343)', () => {
  const dir = __dirname
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

  const doors = sources.filter(
    (file) =>
      file.name !== 'publisher-profile.ts' &&
      /resolvePublisherProfile\s*\(/.test(file.text) &&
      file.text.includes('profileId: publisher.orgId'),
  )

  it('finds every publish door the repo has', () => {
    // Not vacuous: seven doors exist today. A directory read that returned
    // nothing would otherwise let this whole describe pass.
    expect(doors.map((file) => file.name).sort()).toEqual([
      'publish-dataset-schema.ts',
      'publish-email-template.ts',
      'publish-layout.ts',
      'publish-plugin.ts',
      'publish-template.ts',
      'publish-theme.ts',
      'publish.ts',
    ])
  })

  it.each(
    doors.length ? doors.map((file) => file.name) : ['<no doors found>'],
  )('%s calls marketplacePriceRefusal', (name) => {
    const file = doors.find((entry) => entry.name === name)
    expect(file).toBeDefined()
    expect(file!.text).toContain('marketplacePriceRefusal(priceUsd)')
  })

  it('no door carries its own price range check', () => {
    // The validator is worth having only while it is the single decision. The
    // five inline `priceUsd > MARKETPLACE_MAX_PRICE_USD` comparisons this
    // replaced are exactly what drifted — two doors never had them, and none
    // of them had a minimum.
    const offenders = doors
      .filter((file) => /priceUsd\s*[<>]=?\s*(0|MARKETPLACE_)/.test(file.text))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })
})
