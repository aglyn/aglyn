/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
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
 * A SECURITY DROP IS WRITTEN DOWN BEFORE IT IS SENT (AGL-4121).
 *
 * The tenant now holds every page, and the plugin set behind it, for a week.
 * That is only safe if the drop that removes a plugin cannot be lost: a single
 * refused call used to leave the site loading it until the TTL. So each drop
 * is staged in the publish outbox first, sent with retries, and released only
 * once the tenant answered `ok`; a refused one stays for the console's drain.
 * When neither the call nor the entry landed, it is LOUD — an operator alert,
 * and an incomplete answer a stop path fails on.
 */

const mockAlerts: Array<{ type: string; options: unknown }> = []
jest.mock('../utils/server/raise-operator-alert', () => ({
  raiseConsoleOperatorAlert: async (type: string, options: unknown) => {
    mockAlerts.push({ type, options })
    return null
  },
}))

import {
  dropPluginsEverywhere,
  dropSiteCaches,
  revalidateHostAliases,
  revalidateOrgHosts,
} from '../utils/server/tenant-revalidate'

const OLD_ENV = process.env['REVALIDATE_SECRET']

interface Outbox {
  entries: Map<string, Record<string, unknown>>
  released: string[]
}

/** Hosts plus a publish outbox the helpers can batch into and release from. */
function makeFirestore(options: {
  hosts: Record<string, { subdomain?: string; orgId?: string; cname?: string }>
  outboxFails?: boolean
}) {
  const outbox: Outbox = { entries: new Map(), released: [] }
  const hostDoc = (id: string) => ({
    id,
    exists: Boolean(options.hosts[id]),
    get: (field: string) =>
      (options.hosts[id] as Record<string, unknown> | undefined)?.[field],
  })
  const firestore = {
    batch() {
      const staged: Array<[string, Record<string, unknown>]> = []
      return {
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          staged.push([ref.id, data])
        },
        commit: async () => {
          if (options.outboxFails) throw new Error('outbox unavailable')
          for (const [id, data] of staged) outbox.entries.set(id, data)
        },
      }
    },
    collection(name: string) {
      if (name === 'publishOutbox') {
        return {
          doc: (id: string) => ({
            id,
            delete: async () => {
              outbox.released.push(id)
              outbox.entries.delete(id)
            },
          }),
        }
      }
      if (name !== 'hosts') throw new Error(`unexpected collection ${name}`)
      return {
        doc: (id: string) => ({ get: async () => hostDoc(id) }),
        where: (field: string, _op: string, value: string) => ({
          get: async () => ({
            docs: Object.keys(options.hosts)
              .filter((id) => (options.hosts[id] as Record<string, unknown>)[field] === value)
              .map(hostDoc),
          }),
        }),
        orderBy: () => ({
          limit: () => ({
            get: async () => ({
              docs: Object.keys(options.hosts)
                .filter((id) => options.hosts[id].subdomain)
                .slice(0, 1)
                .map(hostDoc),
            }),
          }),
        }),
      }
    },
  }
  return { firestore: firestore as never, outbox }
}

/** The bodies the tenant was sent. */
let fetchMock: jest.Mock
const bodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body))

function tenantAnswers(status: number) {
  fetchMock = jest.fn(async () => ({
    ok: status === 200,
    status,
    json: async () => ({ revalidated: [], truncated: 0 }),
  }))
  global.fetch = fetchMock as never
}

beforeEach(() => {
  process.env['REVALIDATE_SECRET'] = 'test-secret'
  mockAlerts.length = 0
  tenantAnswers(200)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (OLD_ENV === undefined) delete process.env['REVALIDATE_SECRET']
  else process.env['REVALIDATE_SECRET'] = OLD_ENV
})

describe('a site-scoped plugin change (an uninstall, a switchboard toggle)', () => {
  it('stages each site, sends the plugin scope, and releases what landed', async () => {
    const { firestore, outbox } = makeFirestore({
      hosts: { one: { subdomain: 'one' }, two: { subdomain: 'two' } },
    })
    const result = await dropSiteCaches(firestore, {
      hostIds: ['one', 'two'],
      reason: 'uninstalled',
      plugins: 'host',
    })
    expect(result.lost).toBe(0)
    expect(bodies().map((body) => [body.hostId, body.plugins])).toEqual([
      ['one', 'host'],
      ['two', 'host'],
    ])
    // Both were staged, and both released once the tenant said `ok`.
    expect(outbox.released).toHaveLength(2)
    expect(outbox.entries.size).toBe(0)
    expect(mockAlerts).toEqual([])
  })

  it('keeps the entry of a site the tenant refused, for the drain to retry', async () => {
    tenantAnswers(503)
    const { firestore, outbox } = makeFirestore({ hosts: { one: { subdomain: 'one' } } })
    const result = await dropSiteCaches(firestore, {
      hostIds: ['one'],
      reason: 'uninstalled',
      plugins: 'host',
    })
    expect(result.lost).toBe(0)
    const [entry] = [...outbox.entries.values()]
    expect(entry).toEqual(
      expect.objectContaining({
        hostId: 'one',
        entireHost: true,
        plugins: 'host',
        attempts: 0,
        reason: 'uninstalled',
      }),
    )
    // Asked again before giving the site to the drain (AGL-2573's retry).
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('is loud when neither the drop nor its entry landed', async () => {
    tenantAnswers(503)
    const { firestore } = makeFirestore({
      hosts: { one: { subdomain: 'one' } },
      outboxFails: true,
    })
    const result = await dropSiteCaches(firestore, {
      hostIds: ['one'],
      reason: 'uninstalled',
      plugins: 'host',
    })
    expect(result.lost).toBe(1)
    expect(mockAlerts.map((alert) => alert.type)).toEqual(['ops.pluginJobFailed'])
  })

  it('a workspace change stages every site in it, with the plugin scope', async () => {
    const { firestore, outbox } = makeFirestore({
      hosts: {
        a: { subdomain: 'a', orgId: 'org-1' },
        b: { subdomain: 'b', orgId: 'org-1' },
        other: { subdomain: 'other', orgId: 'org-2' },
      },
    })
    tenantAnswers(503)
    await revalidateOrgHosts(firestore, 'org-1', { reason: 'switchboard changed' })
    const staged = [...outbox.entries.values()]
    expect(staged.map((entry) => entry['hostId']).sort()).toEqual(['a', 'b'])
    expect(staged.every((entry) => entry['plugins'] === 'host')).toBe(true)
  })
})

describe('a platform event (a takedown, a revoked version, withdrawn trust)', () => {
  it('is ONE call that expires the plugin set everywhere, staged and released', async () => {
    const { firestore, outbox } = makeFirestore({
      hosts: { carrier: { subdomain: 'carrier' }, other: { subdomain: 'other' } },
    })
    await expect(
      dropPluginsEverywhere(firestore, { reason: 'listing stopped' }),
    ).resolves.toBe(true)
    expect(bodies()).toEqual([
      { host: 'carrier', hostId: 'carrier', paths: ['/'], plugins: 'everywhere' },
    ])
    expect(outbox.released).toHaveLength(1)
    expect(outbox.entries.size).toBe(0)
  })

  it('sends through a site the caller named when it has one', async () => {
    const { firestore } = makeFirestore({
      hosts: { first: { subdomain: 'first' }, named: { subdomain: 'named' } },
    })
    await dropPluginsEverywhere(firestore, {
      reason: 'listing stopped',
      carrierHostIds: ['named'],
    })
    expect(bodies()[0].host).toBe('named')
  })

  it('leaves a refused call in the outbox, marked for every site', async () => {
    tenantAnswers(429)
    const { firestore, outbox } = makeFirestore({ hosts: { c: { subdomain: 'c' } } })
    await expect(
      dropPluginsEverywhere(firestore, { reason: 'listing stopped' }),
    ).resolves.toBe(true)
    expect([...outbox.entries.values()]).toEqual([
      expect.objectContaining({ hostId: 'c', plugins: 'everywhere' }),
    ])
  })

  it('answers false, loudly, when it can neither send nor queue it', async () => {
    tenantAnswers(503)
    const { firestore } = makeFirestore({
      hosts: { c: { subdomain: 'c' } },
      outboxFails: true,
    })
    await expect(
      dropPluginsEverywhere(firestore, { reason: 'listing stopped' }),
    ).resolves.toBe(false)
    expect(mockAlerts).toHaveLength(1)
  })
})

describe('a released name (a detached domain, a renamed subdomain)', () => {
  it('is staged with the address to send it to, and released once it lands', async () => {
    const { firestore, outbox } = makeFirestore({ hosts: {} })
    await expect(
      revalidateHostAliases({
        subdomain: 'acme',
        hostId: 'h1',
        cname: 'acme.com',
        firestore,
      }),
    ).resolves.toBe(true)
    expect(bodies()).toEqual([
      { host: 'acme', hostId: 'h1', paths: [], aliases: ['cname--acme.com'] },
    ])
    expect(outbox.released).toHaveLength(1)
  })

  it('stays in the outbox when the tenant refused it', async () => {
    tenantAnswers(503)
    const { firestore, outbox } = makeFirestore({ hosts: {} })
    await expect(
      revalidateHostAliases({ subdomain: 'acme', hostId: 'h1', aliases: ['old'], firestore }),
    ).resolves.toBe(false)
    expect([...outbox.entries.values()]).toEqual([
      expect.objectContaining({ hostId: 'h1', aliases: ['old'], subdomain: 'acme' }),
    ])
  })
})
