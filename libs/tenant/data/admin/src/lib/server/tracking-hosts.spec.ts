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

import { TRACKING_HOST_PROBE_PATH } from '@aglyn/shared-util-email'
import { domainStatus, type DomainProvider, type ProjectDomainState } from './domain-provider'
import {
  listTrackingHosts,
  removeTrackingHost,
  resolveTrackingLinkOrigin,
  setUpTrackingHost,
  verifyTrackingHost,
} from './tracking-hosts'

/**
 * A CLICK-TRACKING HOST'S LIFECYCLE (AGL-3306): attached by the domain
 * driver, verified by asking the host itself, and used by the send path only
 * once verified.
 */

type Docs = Map<string, Record<string, unknown>>

/** Just enough Firestore for documents addressed by path. */
function memoryFirestore(docs: Docs = new Map()) {
  const doc = (path: string) => ({
    id: path.split('/').pop() as string,
    path,
    async get() {
      const data = docs.get(path)
      return { exists: Boolean(data), id: path.split('/').pop(), data: () => data }
    },
    async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data })
    },
    async delete() {
      docs.delete(path)
    },
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string) => ({
    doc: (id: string) => doc(`${path}/${id}`),
    async get() {
      const prefix = `${path}/`
      const rows = [...docs.entries()].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      return { docs: rows.map(([key, data]) => ({ exists: true, id: key.slice(prefix.length), data: () => data })) }
    },
  })
  return { firestore: { collection } as unknown as FirebaseFirestore.Firestore, docs }
}

function provider(id: string, state: ProjectDomainState = 'serving', outcome = 'attached'): DomainProvider & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    id,
    calls,
    configured: () => true,
    attach: async (scope, domain) => {
      calls.push(`attach ${scope} ${domain}`)
      return { outcome: outcome as 'attached', domain }
    },
    detach: async (scope, domain) => {
      calls.push(`detach ${scope} ${domain}`)
      return { outcome: 'detached', domain }
    },
    status: async (_scope, domain) => domainStatus(domain, state),
  }
}

const probeAnswer = (body: unknown, status = 200) =>
  jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

const ORG = 'org1'
const NOW = 1_000

beforeEach(() => {
  delete process.env['AGLYN_LINK_HOST_TARGET']
})

describe('setting a host up', () => {
  it('attaches links.<domain> to the console through the driver and records the CNAME', async () => {
    const { firestore } = memoryFirestore()
    const vercel = provider('vercel')
    const result = await setUpTrackingHost({ firestore, orgId: ORG, domain: 'zach@Acme.io', nowMs: NOW, provider: vercel })
    expect(vercel.calls).toEqual(['attach console links.acme.io'])
    expect(result.record).toMatchObject({
      domain: 'acme.io',
      host: 'links.acme.io',
      status: 'records-issued',
      target: 'cname.vercel-dns.com',
      provider: 'vercel',
    })
  })

  it('works with no driver at all — the operator points the name at the app', async () => {
    const { firestore } = memoryFirestore()
    process.env['AGLYN_LINK_HOST_TARGET'] = 'proxy.example.net'
    const result = await setUpTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: provider('none', 'skipped', 'skipped') })
    expect(result.record).toMatchObject({ status: 'records-issued', target: 'proxy.example.net', provider: 'none' })
  })

  it('records a driver that could not attach as requested, with a reason', async () => {
    const { firestore } = memoryFirestore()
    const result = await setUpTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: provider('vercel', 'serving', 'failed') })
    expect(result.record).toMatchObject({ status: 'requested', lastDetail: 'attach-failed' })
  })

  it('refuses a domain whose links host already belongs to campaign mail', async () => {
    const { firestore } = memoryFirestore(
      new Map([[`orgs/${ORG}/sendingDomains/acme.io`, { trackingTarget: 'links1.resend-dns.com' }]]),
    )
    const vercel = provider('vercel')
    const result = await setUpTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: vercel })
    expect(result.status).toBe(409)
    expect(result.error).toMatch(/campaign mail/)
    expect(vercel.calls).toEqual([])
  })

  it('refuses a mailbox provider’s domain', async () => {
    const { firestore } = memoryFirestore()
    const result = await setUpTrackingHost({ firestore, orgId: ORG, domain: 'gmail.com', nowMs: NOW, provider: provider('vercel') })
    expect(result.status).toBe(400)
  })
})

describe('checking a host', () => {
  async function setUp(state: ProjectDomainState = 'serving') {
    const { firestore, docs } = memoryFirestore()
    const vercel = provider('vercel', state)
    await setUpTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: vercel })
    return { firestore, docs, vercel }
  }

  it('verifies a host that answers the probe as this app, over https', async () => {
    const { firestore, vercel } = await setUp()
    const fetch = probeAnswer({ service: 'aglyn-link-host', host: 'links.acme.io' })
    const result = await verifyTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: 2_000, provider: vercel, fetch })
    expect(fetch).toHaveBeenCalledWith(`https://links.acme.io${TRACKING_HOST_PROBE_PATH}`, expect.objectContaining({ redirect: 'manual' }))
    expect(result.record).toMatchObject({ status: 'verified', verifiedAtMs: 2_000, lastDetail: null })
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'zach@acme.io')).toBe('https://links.acme.io')
  })

  it('does not ask the host while the driver says the certificate is pending', async () => {
    const { firestore, vercel } = await setUp('certificate-pending')
    const fetch = probeAnswer({})
    const result = await verifyTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: 2_000, provider: vercel, fetch })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.record).toMatchObject({ status: 'records-issued', lastDetail: 'certificate-pending' })
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'zach@acme.io')).toBeNull()
  })

  it('fails a host that answers as something else', async () => {
    const { firestore, vercel } = await setUp()
    const fetch = probeAnswer({ service: 'nginx' })
    const result = await verifyTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: 2_000, provider: vercel, fetch })
    expect(result.record).toMatchObject({ status: 'failed', lastDetail: 'not-this-app' })
  })

  it('keeps a verified host verified through one unreachable probe', async () => {
    const { firestore, vercel } = await setUp()
    await verifyTrackingHost({
      firestore, orgId: ORG, domain: 'acme.io', nowMs: 2_000, provider: vercel,
      fetch: probeAnswer({ service: 'aglyn-link-host', host: 'links.acme.io' }),
    })
    const down = jest.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const result = await verifyTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: 3_000, provider: vercel, fetch: down })
    expect(result.record).toMatchObject({ status: 'verified', lastDetail: 'unreachable', verifiedAtMs: 2_000 })
  })

  it('asks for a set-up first', async () => {
    const { firestore } = memoryFirestore()
    const result = await verifyTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: 1, provider: provider('vercel') })
    expect(result.status).toBe(404)
  })
})

describe('removing a host and resolving links', () => {
  it('detaches the name and forgets the record, so links go back to the app address', async () => {
    const { firestore } = memoryFirestore()
    const vercel = provider('vercel')
    await setUpTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: vercel })
    await verifyTrackingHost({
      firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: vercel,
      fetch: probeAnswer({ service: 'aglyn-link-host', host: 'links.acme.io' }),
    })
    await removeTrackingHost({ firestore, orgId: ORG, domain: 'acme.io', nowMs: NOW, provider: vercel })
    expect(vercel.calls).toContain('detach console links.acme.io')
    expect(await listTrackingHosts(firestore, ORG)).toEqual([])
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'zach@acme.io')).toBeNull()
  })

  it('resolves nothing for another organization or another domain', async () => {
    const { firestore } = memoryFirestore(
      new Map([[`orgs/${ORG}/trackingHosts/acme.io`, { domain: 'acme.io', host: 'links.acme.io', status: 'verified' }]]),
    )
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'zach@acme.io')).toBe('https://links.acme.io')
    expect(await resolveTrackingLinkOrigin(firestore, 'org2', 'zach@acme.io')).toBeNull()
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'zach@other.io')).toBeNull()
    expect(await resolveTrackingLinkOrigin(firestore, ORG, 'not an address')).toBeNull()
  })
})
