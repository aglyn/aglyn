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
 * THINGS THAT CHANGE A LIVE PAGE WITHOUT A PUBLISH (AGL-1152).
 *
 * A tenant page reaches a visitor from the ISR cache, and that cache is dropped
 * on demand only by things that call the tenant's `/api/revalidate`. Until this
 * change exactly one non-publish action did: a lockdown. A plan change and a
 * plugin revocation did not, so both waited out the page's ISR window.
 *
 * That was easy to under-rate at a 60s window, and it was ALREADY wrong at 60s:
 * the window only bounds a page somebody is requesting. On a quiet site "at most
 * 60s" really meant "until the next two visits", which for a revoked plugin —
 * i.e. code we have decided must stop executing — is not a bound at all.
 *
 * Raising the window to 600s (`apps/tenant/app/[host]/[[...slug]]/page.tsx`)
 * makes the gap visible rather than creating it, and these are the busts that
 * pay for the raise. They are BEST EFFORT by design: the tenant still refuses a
 * revoked plugin at render time and still enforces suspension in middleware, so
 * a failed drop shortens nothing but never lets anything through.
 */
import {
  revalidateEntireHost,
  revalidateHostsWithPlugin,
  revalidateOrgHosts,
} from '../utils/server/tenant-revalidate'

const OLD_ENV = process.env['REVALIDATE_SECRET']

/** Minimal Firestore double: only the shapes these three helpers touch. */
function makeFirestore(options: {
  hosts?: Record<string, { subdomain?: string; screens?: Record<string, string>; orgId?: string }>
  installs?: Array<{ owner: 'hosts' | 'orgs'; ownerId: string }>
}) {
  const hosts = options.hosts ?? {}
  const installs = options.installs ?? []
  const hostDoc = (id: string) => ({
    exists: Boolean(hosts[id]),
    get: (field: string) => (hosts[id] as Record<string, unknown> | undefined)?.[field],
    id,
  })
  return {
    collection(name: string) {
      if (name !== 'hosts') throw new Error(`unexpected collection ${name}`)
      return {
        doc: (id: string) => ({ get: async () => hostDoc(id) }),
        where: (field: string, _op: string, value: string) => ({
          get: async () => ({
            docs: Object.entries(hosts)
              .filter(([, host]) => (host as Record<string, unknown>)[field] === value)
              .map(([id]) => hostDoc(id)),
          }),
        }),
      }
    },
    collectionGroup(name: string) {
      if (name !== 'installs') throw new Error(`unexpected group ${name}`)
      return {
        where: () => ({
          get: async () => ({
            empty: installs.length === 0,
            size: installs.length,
            docs: installs.map((install) => ({
              ref: {
                parent: {
                  parent: { id: install.ownerId, parent: { id: install.owner } },
                },
              },
            })),
          }),
        }),
      }
    },
  } as never
}

describe('cache drops for changes that are not a publish (AGL-1152)', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    process.env['REVALIDATE_SECRET'] = 'test-secret'
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ revalidated: ['/h/'], truncated: 0 }),
    }))
    global.fetch = fetchMock as never
  })
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env['REVALIDATE_SECRET']
    else process.env['REVALIDATE_SECRET'] = OLD_ENV
  })

  /** Which hostIds were asked for, read off the request bodies. */
  const bustedHostIds = () =>
    fetchMock.mock.calls
      .map(([, init]) => JSON.parse((init as { body: string }).body).hostId)
      .sort()

  it('drops EVERY routed page of a host, not just its root', async () => {
    const firestore = makeFirestore({
      // The host doc stores bare ROUTE paths (`about`), not URLs;
      // `screenRoutePathToUrl` is what adds the slash. A fixture that stored
      // `/about` would assert against `//about` and quietly pass a broken map.
      hosts: { h1: { subdomain: 'acme', screens: { s1: 'about', s2: 'menu' } } },
    })
    const result = await revalidateEntireHost(firestore, 'h1')

    expect(result.reason).toBe('ok')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // The root is always included; a screens map that misses it would leave the
    // most-requested page of the site serving the old answer.
    expect(body.paths).toEqual(expect.arrayContaining(['/', '/about', '/menu']))
    // `hostId` is what busts `tenant-data:{hostId}`; without it the page
    // regenerates faithfully from the stale doc cache (AGL-1302).
    expect(body.hostId).toBe('h1')
  })

  it('A PLUGIN REVOCATION reaches host-scoped AND org-scoped installs', async () => {
    // An org-tier pin (AGL-237) applies to every host in the org, and it is
    // those hosts that hold the cached HTML — the org renders nothing. A
    // fan-out that only understood host installs would leave every org-tier
    // site running the bundle we just killed.
    const firestore = makeFirestore({
      hosts: {
        direct: { subdomain: 'direct', screens: {} },
        orgA1: { subdomain: 'a1', screens: {}, orgId: 'orgA' },
        orgA2: { subdomain: 'a2', screens: {}, orgId: 'orgA' },
        unrelated: { subdomain: 'nope', screens: {}, orgId: 'orgB' },
      },
      installs: [
        { owner: 'hosts', ownerId: 'direct' },
        { owner: 'orgs', ownerId: 'orgA' },
      ],
    })

    const result = await revalidateHostsWithPlugin(firestore, 'listing-1')

    expect(result.installsFound).toBe(2)
    expect(bustedHostIds()).toEqual(['direct', 'orgA1', 'orgA2'])
    expect(result.hostsDropped).toBe(0)
  })

  it('a revocation with no installs makes no requests at all', async () => {
    const firestore = makeFirestore({ hosts: {}, installs: [] })
    const result = await revalidateHostsWithPlugin(firestore, 'listing-1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.installsFound).toBe(0)
  })

  it('A PLAN CHANGE drops every host in the org and nobody else’s', async () => {
    const firestore = makeFirestore({
      hosts: {
        mine1: { subdomain: 'm1', screens: {}, orgId: 'orgA' },
        mine2: { subdomain: 'm2', screens: {}, orgId: 'orgA' },
        theirs: { subdomain: 't1', screens: {}, orgId: 'orgB' },
      },
    })
    await revalidateOrgHosts(firestore, 'orgA')
    expect(bustedHostIds()).toEqual(['mine1', 'mine2'])
  })

  it('never throws when the tenant refuses — a cache hint is not the operation', async () => {
    // The revocation itself has already been written by the time the fan-out
    // runs. If a drop failing could throw, a tenant outage would turn a
    // completed kill switch into a 500 and invite the operator to retry it.
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const firestore = makeFirestore({
      hosts: { h1: { subdomain: 'acme', screens: {}, orgId: 'orgA' } },
      installs: [{ owner: 'hosts', ownerId: 'h1' }],
    })

    const revoked = await revalidateHostsWithPlugin(firestore, 'listing-1')
    expect(revoked.hosts[0].reason).toBe('tenant-503')

    const planned = await revalidateOrgHosts(firestore, 'orgA')
    expect(planned[0].reason).toBe('tenant-503')
  })

  it('says so rather than silently doing nothing when the secret is unset', async () => {
    delete process.env['REVALIDATE_SECRET']
    const firestore = makeFirestore({ hosts: { h1: { subdomain: 'acme', screens: {} } } })
    const result = await revalidateEntireHost(firestore, 'h1')
    expect(result.reason).toBe('not-configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
