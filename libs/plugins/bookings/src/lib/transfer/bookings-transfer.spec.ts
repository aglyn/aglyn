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
 * @jest-environment node
 */

/**
 * THE `bookings` TRANSFER RESOURCE, over an in-memory Firestore: the
 * catalog, every page read (all, the selection, each filter), paging with a
 * stable cursor, the count, and the registration against the real
 * declaration — export only, so no import hook.
 */

import {
  buildTransferFieldCatalog,
  isTransferFieldWritable,
  transferFieldProblems,
} from '@aglyn/aglyn/data-transfer'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import {
  pluginTransferResourceProblems,
  resetTransferResourcesForTests,
  resolveTransferResource,
  transferRecordsHooks,
  type TransferReadOptions,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { registerBookingsConsoleServerDeclarations } from '../declarations.console-server'
import { BOOKINGS_TRANSFER_RESOURCE } from './bookings-transfer-common'
import { createBookingsTransferResource } from './bookings-transfer'

const DOC_ID = '__name__'
jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
}))

/*==========================================
 * A MINIMAL IN-MEMORY FIRESTORE
 *=========================================*/

const docs = new Map<string, Record<string, unknown>>()
const queries: string[] = []

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

type Filter = [string, string, unknown]
type Order = [string, 'asc' | 'desc']

function collectionRef(path: string): any {
  const make = (
    filters: Filter[],
    orders: Order[],
    after: unknown[] | null,
    max: number | null,
  ): any => {
    const valueOf = (id: string, field: string) =>
      field === DOC_ID ? id : docs.get(`${path}/${id}`)?.[field]
    const compare = (a: unknown, b: unknown) =>
      a === b ? 0 : (a as number) < (b as number) ? -1 : 1
    const run = () => {
      let ids = [...docs.keys()]
        .filter(
          (key) =>
            key.startsWith(`${path}/`) &&
            !key.slice(path.length + 1).includes('/'),
        )
        .map((key) => key.slice(path.length + 1))
      for (const [field, op, value] of filters) {
        ids = ids.filter((id) => {
          const held = valueOf(id, field)
          if (op === '==') return held === value
          if (op === '>=')
            return held !== undefined && (held as number) >= (value as number)
          if (op === 'in') return (value as unknown[]).includes(held)
          throw new Error(`the fake does not answer ${op}`)
        })
      }
      // Firestore leaves out a document missing an ordered field.
      ids = ids.filter((id) =>
        orders.every(([field]) => valueOf(id, field) !== undefined),
      )
      ids.sort((a, b) => {
        for (const [field, direction] of orders) {
          const order = compare(valueOf(a, field), valueOf(b, field))
          if (order) return direction === 'asc' ? order : -order
        }
        return 0
      })
      if (after) {
        ids = ids.filter((id) => {
          for (let index = 0; index < orders.length; index += 1) {
            const [field, direction] = orders[index]
            const order = compare(valueOf(id, field), after[index])
            if (order) return direction === 'asc' ? order > 0 : order < 0
          }
          return false
        })
      }
      return max === null ? ids : ids.slice(0, max)
    }
    const describe = () =>
      [
        path,
        ...filters.map(
          ([field, op, value]) => `${field} ${op} ${JSON.stringify(value)}`,
        ),
        ...orders.map(([field, direction]) => `by ${field} ${direction}`),
      ].join(' | ')
    return {
      where: (field: string, op: string, value: unknown) =>
        make([...filters, [field, op, value]], orders, after, max),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
        make(filters, [...orders, [field, direction]], after, max),
      startAfter: (...values: unknown[]) => make(filters, orders, values, max),
      limit: (count: number) => make(filters, orders, after, count),
      doc: (id: string) => docRef(`${path}/${id}`),
      get: async () => {
        queries.push(describe())
        return {
          docs: run().map((id) => snapshot(`${path}/${id}`)),
          size: run().length,
        }
      },
      count: () => ({
        get: async () => {
          queries.push(`count ${describe()}`)
          return { data: () => ({ count: run().length }) }
        },
      }),
    }
  }
  return make([], [], null, null)
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => snapshot(ref.path)),
}

/*==========================================
 * THE SITE
 *=========================================*/

const HOST = 'host-1'
const NOW = Date.UTC(2026, 9, 5, 12, 0)
const HOUR = 60 * 60_000
const ctx: TransferResourceContext = {
  resource: 'bookings',
  orgId: 'org-1',
  hostId: HOST,
  actorUid: 'uid-1',
}
const resource = createBookingsTransferResource({
  firestore: () => firestore,
  now: () => NOW,
})

const put = (path: string, data: Record<string, unknown>) =>
  docs.set(path, data)
const booking = (id: string, data: Record<string, unknown>) =>
  put(`hosts/${HOST}/bookings/${id}`, data)
const stamp = (ms: number) => ({ toMillis: () => ms })

const ALL_FIELDS = buildTransferFieldCatalog(
  resource.fields?.(ctx) as never,
).fields.map((field) => field.id)

async function readAll(
  options: TransferReadOptions,
  fieldIds: readonly string[] = ['id'],
) {
  const pages: Array<Array<Record<string, unknown>>> = []
  let cursor: string | null = null
  do {
    const page = await (
      resource.readPage as NonNullable<typeof resource.readPage>
    )(ctx, cursor, fieldIds, options)
    pages.push(page.rows)
    cursor = page.next
  } while (cursor !== null && pages.length < 50)
  return pages
}

const idsOf = (pages: Array<Array<Record<string, unknown>>>) =>
  pages.flat().map((row) => row['id'])
const count = (options: TransferReadOptions) =>
  (resource.count as NonNullable<typeof resource.count>)(ctx, options)

beforeEach(() => {
  docs.clear()
  queries.length = 0
  put('orgs/org-1', { timeZone: 'America/New_York' })
  put(`hosts/${HOST}`, { orgId: 'org-1', timeZone: 'America/Denver' })
  put(`hosts/${HOST}/services/svc-cut`, {
    name: 'Haircut (45 min)',
    timezone: 'America/Chicago',
  })
  put(`hosts/${HOST}/services/svc-gone`, {
    name: 'Old service',
    deletedAt: stamp(NOW - 100 * HOUR),
  })
  put(`hosts/${HOST}/services/svc-nozone`, { name: 'Consult' })
  // A paid, confirmed booking with every field, in Los Angeles.
  booking('b-paid', {
    serviceId: 'svc-cut',
    serviceName: 'Haircut',
    name: 'Rhea Salt',
    email: 'rhea@example.com',
    phone: '+15125550107',
    address: '1 Main St\nAustin TX',
    startsAtMs: NOW + 24 * HOUR,
    endsAtMs: NOW + 24 * HOUR + 45 * 60_000,
    timezone: 'America/Los_Angeles',
    status: 'confirmed',
    crmRef: 'contact:abc',
    createdAt: stamp(NOW - 48 * HOUR),
    confirmedAt: stamp(NOW - 47 * HOUR),
    reminderSentAt: stamp(NOW - HOUR),
    paidAmountCents: 5350,
    taxCents: 350,
    feeCents: 250,
    refundedCents: 1000,
    taxMode: 'manual',
    paymentIntentId: 'pi_123',
    checkoutSessionId: 'cs_123',
  })
  // Older: no stored zone; its service names one.
  booking('b-old', {
    serviceId: 'svc-cut',
    serviceName: 'Haircut',
    name: 'Old Timer',
    email: 'old@example.com',
    startsAtMs: NOW - 72 * HOUR,
    endsAtMs: NOW - 71 * HOUR,
    status: 'confirmed',
  })
  // In progress: started an hour ago, ends in an hour — still "upcoming" on the page.
  booking('b-now', {
    serviceId: 'svc-nozone',
    serviceName: 'Consult',
    name: 'In Chair',
    email: 'rhea@example.com',
    startsAtMs: NOW - HOUR,
    endsAtMs: NOW + HOUR,
    status: 'canceled',
  })
  // Erased customer, on a service since deleted, held for payment.
  booking('b-erased', {
    serviceId: 'svc-gone',
    serviceName: 'Old service',
    email: null,
    customerErasedAtMs: NOW - 2 * HOUR,
    startsAtMs: NOW + 48 * HOUR,
    endsAtMs: NOW + 49 * HOUR,
    status: 'pendingPayment',
    expiresAtMs: NOW + 15 * 60_000,
  })
  // Same start as b-paid: the id breaks the tie.
  booking('a-tie', {
    serviceId: 'svc-nozone',
    serviceName: 'Consult',
    name: 'Tie Breaker',
    email: 'tie@example.com',
    startsAtMs: NOW + 24 * HOUR,
    endsAtMs: NOW + 25 * HOUR,
    status: 'confirmed',
  })
})

/*==========================================
 * THE CATALOG
 *=========================================*/

describe('the catalog', () => {
  const catalog = buildTransferFieldCatalog(resource.fields?.(ctx) as never)

  it('is a catalog the core accepts', () => {
    expect(transferFieldProblems(catalog.fields)).toEqual([])
  })

  it('lists Booking, Customer, Payment and System, in that order', () => {
    expect(catalog.groups.map((group) => group.label)).toEqual([
      'Booking',
      'Customer',
      'Payment',
      'System',
    ])
  })

  it('offers every field a person would want, and writes none of them', () => {
    expect(catalog.fields.map((field) => field.id).sort()).toEqual(
      [
        'id',
        'serviceId',
        'serviceName',
        'serviceCurrentName',
        'startsAt',
        'endsAt',
        'timeZone',
        'startsLocal',
        'endsLocal',
        'durationMinutes',
        'status',
        'name',
        'email',
        'phone',
        'address',
        'crmRef',
        'paidAmount',
        'tax',
        'fee',
        'refunded',
        'taxMode',
        'paymentIntentId',
        'checkoutSessionId',
        'holdExpiresAt',
        'createdAt',
        'confirmedAt',
        'reminderSentAt',
        'customerErasedAt',
      ].sort(),
    )
    expect(catalog.fields.filter(isTransferFieldWritable)).toEqual([])
  })

  it('marks what is computed as derived and what the platform writes as system', () => {
    const flagged = (flag: 'derived' | 'system') =>
      catalog.fields.filter((field) => field[flag]).map((field) => field.id)
    expect(flagged('derived').sort()).toEqual([
      'durationMinutes',
      'endsLocal',
      'serviceCurrentName',
      'startsLocal',
    ])
    expect(flagged('system').sort()).toEqual(
      [
        'checkoutSessionId',
        'confirmedAt',
        'createdAt',
        'customerErasedAt',
        'holdExpiresAt',
        'id',
        'paymentIntentId',
        'reminderSentAt',
      ].sort(),
    )
    expect(catalog.byId.get('paidAmount')?.type).toBe('currency')
    expect(catalog.byId.get('startsAt')?.type).toBe('datetime')
  })
})

/*==========================================
 * READING
 *=========================================*/

describe('a page of bookings', () => {
  it('holds only the fields asked for, read from the booking', async () => {
    const [rows] = await readAll({ ids: ['b-paid'] }, ALL_FIELDS)
    expect(rows).toEqual([
      {
        id: 'b-paid',
        serviceId: 'svc-cut',
        serviceName: 'Haircut',
        serviceCurrentName: 'Haircut (45 min)',
        startsAt: '2026-10-06T12:00:00.000Z',
        endsAt: '2026-10-06T12:45:00.000Z',
        timeZone: 'America/Los_Angeles',
        startsLocal: '2026-10-06 05:00',
        endsLocal: '2026-10-06 05:45',
        durationMinutes: 45,
        status: 'Confirmed',
        name: 'Rhea Salt',
        email: 'rhea@example.com',
        phone: '+15125550107',
        address: '1 Main St\nAustin TX',
        crmRef: 'contact:abc',
        paidAmount: 53.5,
        tax: 3.5,
        fee: 2.5,
        refunded: 10,
        taxMode: 'manual',
        paymentIntentId: 'pi_123',
        checkoutSessionId: 'cs_123',
        holdExpiresAt: null,
        createdAt: '2026-10-03T12:00:00.000Z',
        confirmedAt: '2026-10-03T13:00:00.000Z',
        reminderSentAt: '2026-10-05T11:00:00.000Z',
        customerErasedAt: null,
      },
    ])
    const [narrow] = await readAll({ ids: ['b-paid'] }, ['email', 'paidAmount'])
    expect(narrow).toEqual([{ email: 'rhea@example.com', paidAmount: 53.5 }])
  })

  it('tells an older booking’s time in its service’s zone, then the site’s', async () => {
    const [rows] = await readAll({ ids: ['b-old', 'b-now'] }, [
      'id',
      'timeZone',
      'startsLocal',
    ])
    expect(rows).toEqual([
      {
        id: 'b-old',
        timeZone: 'America/Chicago',
        startsLocal: '2026-10-02 07:00',
      },
      // Its service names no zone: the site's.
      {
        id: 'b-now',
        timeZone: 'America/Denver',
        startsLocal: '2026-10-05 05:00',
      },
    ])
  })

  it('leaves an erased customer blank and a deleted service’s current name empty', async () => {
    const [rows] = await readAll({ ids: ['b-erased'] }, [
      'name',
      'email',
      'phone',
      'serviceName',
      'serviceCurrentName',
      'status',
      'holdExpiresAt',
      'customerErasedAt',
      'paidAmount',
    ])
    expect(rows).toEqual([
      {
        name: null,
        email: null,
        phone: null,
        serviceName: 'Old service',
        serviceCurrentName: null,
        status: 'Awaiting payment',
        holdExpiresAt: '2026-10-05T12:15:00.000Z',
        customerErasedAt: '2026-10-05T10:00:00.000Z',
        paidAmount: null,
      },
    ])
  })

  it('reads nothing past the bookings when no chosen field needs it', async () => {
    await readAll({}, ['id', 'startsAt', 'email'])
    expect(
      queries.every((query) => query.startsWith(`hosts/${HOST}/bookings`)),
    ).toBe(true)
  })
})

describe('which bookings', () => {
  it('reads every booking by start, the id breaking ties, page after page', async () => {
    const pages = await readAll({ pageSize: 2 })
    expect(pages.map((rows) => rows.length)).toEqual([2, 2, 1])
    expect(idsOf(pages)).toEqual([
      'b-old',
      'b-now',
      'a-tie',
      'b-paid',
      'b-erased',
    ])
    expect(queries[0]).toBe(
      `hosts/${HOST}/bookings | by startsAtMs asc | by __name__ asc`,
    )
  })

  it('reads the selection by id, in its order, skipping ids that name nothing', async () => {
    const pages = await readAll({
      ids: ['b-paid', 'nope', 'b-old', 'b-paid', 'a-tie'],
      pageSize: 2,
    })
    expect(idsOf(pages)).toEqual(['b-paid', 'b-old', 'a-tie'])
  })

  it('reads the upcoming list as the page shows it: not yet ended, canceled ones too', async () => {
    const pages = await readAll({
      filter: { upcoming: true, asOfMs: NOW },
      pageSize: 2,
    })
    expect(idsOf(pages)).toEqual(['b-now', 'b-paid', 'a-tie', 'b-erased'])
    expect(queries[0]).toBe(
      `hosts/${HOST}/bookings | endsAtMs >= ${NOW} | by endsAtMs asc | by __name__ asc`,
    )
  })

  it('reads the upcoming list from the clock when the filter names no moment', async () => {
    expect(idsOf(await readAll({ filter: { upcoming: true } }))).toEqual([
      'b-now',
      'b-paid',
      'a-tie',
      'b-erased',
    ])
  })

  it('reads one booker’s bookings, the address as stored', async () => {
    const pages = await readAll({ filter: { email: ' Rhea@Example.com ' } })
    expect(idsOf(pages)).toEqual(['b-now', 'b-paid'])
    expect(queries[0]).toBe(
      `hosts/${HOST}/bookings | email == "rhea@example.com" | by startsAtMs asc | by __name__ asc`,
    )
  })

  it('reads one service’s bookings', async () => {
    const pages = await readAll({ filter: { serviceId: 'svc-cut' } })
    expect(idsOf(pages)).toEqual(['b-old', 'b-paid'])
    expect(queries[0]).toBe(
      `hosts/${HOST}/bookings | serviceId == "svc-cut" | by startsAtMs asc | by __name__ asc`,
    )
  })

  it('refuses a filter it does not read rather than exporting everything', async () => {
    await expect(readAll({ filter: { status: 'confirmed' } })).rejects.toThrow(
      /not by status/,
    )
    await expect(
      readAll({ filter: { email: 'a@b.co', serviceId: 'svc-cut' } }),
    ).rejects.toThrow(/one filter/)
    await expect(readAll({ filter: { upcoming: 'yes' } })).rejects.toThrow(
      /upcoming/,
    )
  })

  it('reads the same bookings whatever scope tokens are handed — the site is the gate', async () => {
    expect(idsOf(await readAll({ scopeTokens: ['host:other'] }))).toEqual(
      idsOf(await readAll({})),
    )
  })

  it('refuses a cursor it did not write, and a read with no site', async () => {
    const readPage = resource.readPage as NonNullable<typeof resource.readPage>
    await expect(readPage(ctx, 'garbage', ['id'])).rejects.toThrow(/cursor/)
    await expect(
      readPage({ ...ctx, hostId: null }, null, ['id']),
    ).rejects.toThrow(/site/)
  })
})

describe('the count', () => {
  it('counts what the read returns, by the same query', async () => {
    expect(await count({})).toBe(5)
    expect(await count({ filter: { upcoming: true, asOfMs: NOW } })).toBe(4)
    expect(await count({ filter: { email: 'rhea@example.com' } })).toBe(2)
    expect(await count({ filter: { serviceId: 'svc-nozone' } })).toBe(2)
  })

  it('counts only the selected ids that name a booking', async () => {
    expect(await count({ ids: ['b-paid', 'nope', 'b-old', 'b-paid'] })).toBe(2)
    const many = Array.from({ length: 70 }, (_, index) => `x-${index}`)
    expect(await count({ ids: [...many, 'a-tie'] })).toBe(1)
    // Firestore's `in` takes 30 at a time.
    expect(queries.filter((query) => query.startsWith('count')).length).toBe(
      1 + 3,
    )
  })
})

/*==========================================
 * REGISTERED AGAINST THE REAL DECLARATION
 *=========================================*/

describe('the registration', () => {
  const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find(
    (one) => one.key === BOOKINGS_TRANSFER_RESOURCE,
  )

  afterEach(() => resetTransferResourcesForTests())

  it('is declared export only, by this plugin, for a site', () => {
    expect(declared).toMatchObject({
      pluginId: 'bookings',
      scope: 'host',
      kinds: ['records'],
    })
    expect(declared?.exportOnly).toBe(true)
  })

  it('answers every hook an export-only resource needs, and no write', () => {
    expect(
      pluginTransferResourceProblems(
        declared as NonNullable<typeof declared>,
        resource,
      ),
    ).toEqual([])
    expect(resource.apply).toBeUndefined()
    expect(resource.revert).toBeUndefined()
  })

  it('registers from the console declarations and resolves', async () => {
    registerBookingsConsoleServerDeclarations()
    const resolved = await resolveTransferResource(BOOKINGS_TRANSFER_RESOURCE)
    expect(resolved.pluginId).toBe('bookings')
    const hooks = transferRecordsHooks(resolved)
    expect(hooks.matchKeys).toEqual([{ fieldId: 'id', normalizer: 'aglynId' }])
    expect(hooks.apply).toBeUndefined()
  })

  it('looks a booking up by its Aglyn ID, and nothing else', async () => {
    const lookup = resource.lookup as NonNullable<typeof resource.lookup>
    const found = await lookup(ctx, [
      { fieldId: 'id', normalizer: 'aglynId', values: ['b-paid', 'b-missing', 'a/b'] },
      { fieldId: 'email', normalizer: 'email', values: ['rhea@example.com'] },
    ])
    expect([...found.records.keys()]).toEqual(['b-paid'])
    expect(found.records.get('b-paid')).toMatchObject({ id: 'b-paid', serviceId: 'svc-cut' })
    expect([...found.lookup.values()]).toEqual([['b-paid']])
  })
})
