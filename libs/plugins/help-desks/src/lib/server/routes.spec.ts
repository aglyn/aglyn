/**
 * @jest-environment node
 */
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

import { randomBytes } from 'node:crypto'
import { createSecretBoxKey, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { ProviderError } from '../providers/http'
import type { HelpDeskCredential, HelpDeskProvider } from '../providers/provider'
import { createMemoryStore } from '../testing/memory-store'
import { openCredential, readHelpDesksConfig, type HelpDesksConfig } from './config'
import { createCredentialOpener } from './credentials'
import { createHelpDeskRoutes, fail, type HelpDeskRole, type HelpDeskRouteDeps } from './routes'
import { customerDocId } from './store'

const HOST = 'host-1'
const NOW = Date.UTC(2026, 9, 15, 12)
const key = createSecretBoxKey(randomBytes(32))
const keyring: SecretBoxKeyring = { current: key, keys: [key] }

function setup(
  options: {
    config?: Partial<HelpDesksConfig>
    role?: HelpDeskRole | null
    verify?: HelpDeskProvider['verify']
  } = {},
) {
  const memory = createMemoryStore()
  const activity: string[] = []
  const syncs: string[] = []
  const verified: HelpDeskCredential[] = []
  const config: HelpDesksConfig = { keyring, ...options.config }
  const deps: HelpDeskRouteDeps = {
    now: () => NOW,
    config: () => config,
    store: memory.store,
    provider: (id) => ({
      id,
      verify: async (credential) => {
        verified.push(credential)
        return options.verify ? options.verify(credential) : { accountName: 'Acme', targets: [{ id: 'support', name: 'Support' }] }
      },
      upsertCustomer: async () => ({ remoteId: 'x' }),
      pushOrder: async () => undefined,
      createTicket: async () => undefined,
    }),
    gate: async (request, role) => {
      const granted = options.role === undefined ? 'admin' : options.role
      if (!granted) return fail(401, 'Unauthenticated')
      if (granted === 'editor' && role === 'admin') return fail(403, 'Not permitted')
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'u1', body }
    },
    syncNow: async (id) => void syncs.push(id),
    logActivity: async (input) => void activity.push(`${input.action}:${input.provider}`),
  }
  return { routes: createHelpDeskRoutes(deps), memory, activity, syncs, verified }
}

const send = (body: unknown, method = 'POST') =>
  new Request('https://app.test/api/x', { method, body: JSON.stringify({ hostId: HOST, ...(body as object) }) })
const get = (query = '') => new Request(`https://app.test/api/x?hostId=${HOST}${query}`)

const gorgias = { provider: 'gorgias', account: 'https://Acme.gorgias.com/', login: 'Agent@Example.com', token: 'key-123' }

describe('listing', () => {
  it('offers every help desk once the token key exists, and none without it', async () => {
    const { routes } = setup()
    expect((await (await routes.list(get())).json()).available).toEqual(['gorgias', 'reamaze', 'kustomer', 'gladly', 'richpanel'])
    const bare = setup({ config: { keyring: null } })
    expect((await (await bare.routes.list(get())).json()).available).toEqual([])
  })

  it('reads the key from env, and an unreadable key is no key', () => {
    expect(readHelpDesksConfig({}).keyring).toBeNull()
    expect(readHelpDesksConfig({ HELP_DESKS_TOKEN_KEY: 'not a key' }).keyring).toBeNull()
    expect(readHelpDesksConfig({ HELP_DESKS_TOKEN_KEY: randomBytes(32).toString('base64') }).keyring).not.toBeNull()
  })

  it('refuses a member without access', async () => {
    const { routes } = setup({ role: null })
    expect((await routes.list(get())).status).toBe(401)
  })
})

describe('connecting', () => {
  it('checks the credential, seals it, and never answers it back', async () => {
    const { routes, memory, activity, verified } = setup()
    const response = await routes.connect(send(gorgias))
    expect(response.status).toBe(200)
    const answer = await response.json()
    expect(JSON.stringify(answer)).not.toContain('key-123')
    expect(answer.connection).toMatchObject({ provider: 'gorgias', status: 'active', accountName: 'Acme', syncCustomers: true, sendTickets: false })
    // The account typed as an address is the subdomain; the login is an email.
    expect(verified[0]).toMatchObject({ account: 'acme', login: 'agent@example.com', token: 'key-123' })
    const stored = memory.connections.get(`${HOST}_gorgias`)!
    expect(stored.sealedToken).not.toContain('key-123')
    expect(openCredential(stored.sealedToken!, `${HOST}_gorgias`, keyring).parts).toEqual({ token: 'key-123', login: 'agent@example.com', appClientId: null })
    expect(stored.targetId).toBe('support')
    expect(activity).toEqual(['connected:gorgias'])
    const opened = await createCredentialOpener({ store: memory.store, config: () => ({ keyring }) })(`${HOST}_gorgias`, stored)
    expect(opened).toEqual({ account: 'acme', login: 'agent@example.com', token: 'key-123', appClientId: null, supportEmail: null })
  })

  it('asks for every field the help desk needs, in words', async () => {
    const { routes } = setup()
    const missing = await routes.connect(send({ provider: 'richpanel', token: 'k', appClientId: 'store' }))
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toBe('Enter your Support email address')
    const badAccount = await routes.connect(send({ ...gorgias, account: 'acme corp' }))
    expect((await badAccount.json()).error).toContain('like acme')
  })

  it('says so when the help desk refuses the credential', async () => {
    const { routes, memory } = setup({
      verify: async () => {
        throw new ProviderError('auth', 'Gorgias refused the connection: nope', { status: 401 })
      },
    })
    const response = await routes.connect(send(gorgias))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Gorgias did not accept those details. Check them and try again.')
    expect(memory.connections.size).toBe(0)
  })

  it('refuses to connect without the token key, and refuses an editor', async () => {
    expect((await setup({ config: { keyring: null } }).routes.connect(send(gorgias))).status).toBe(404)
    expect((await setup({ role: 'editor' }).routes.connect(send(gorgias))).status).toBe(403)
  })

  it('keeps the merchant’s choices and progress when the same account connects again, and starts over for another', async () => {
    const { routes, memory } = setup()
    await routes.connect(send(gorgias))
    const id = `${HOST}_gorgias`
    await routes.connection(send({ provider: 'gorgias', sendTickets: true }, 'PATCH'))
    memory.connections.get(id)!.cursors = { people: 'c9', ordersMs: 5 }
    await memory.store.putCustomer(id, {
      orgId: 'org-1',
      connectionId: id,
      hostId: HOST,
      email: 'pat@example.com',
      remoteId: '9',
      name: null,
      orders: [],
      updatedAtMs: NOW,
    })
    await routes.connect(send({ ...gorgias, token: 'key-456' }))
    expect(memory.connections.get(id)).toMatchObject({ sendTickets: true, cursors: { people: 'c9', ordersMs: 5 } })
    expect(memory.customers.has(customerDocId(id, 'pat@example.com'))).toBe(true)

    await routes.connect(send({ ...gorgias, account: 'other' }))
    expect(memory.connections.get(id)).toMatchObject({ sendTickets: true, cursors: { people: null, ordersMs: null } })
    expect(memory.customers.size).toBe(0)
  })
})

describe('settings', () => {
  it('turns contact form messages on, picks from the menu only, and pauses', async () => {
    const { routes } = setup()
    await routes.connect(send(gorgias))
    const on = await (await routes.connection(send({ provider: 'gorgias', sendTickets: true }, 'PATCH'))).json()
    expect(on.connection.sendTickets).toBe(true)
    const bad = await routes.connection(send({ provider: 'gorgias', targetId: 'nowhere' }, 'PATCH'))
    expect(bad.status).toBe(400)
    const paused = await (await routes.connection(send({ provider: 'gorgias', paused: true }, 'PATCH'))).json()
    expect(paused.connection.status).toBe('paused')
    expect((await routes.syncNow(send({ provider: 'gorgias' }))).status).toBe(409)
  })

  it('disconnects, deleting what the connection held', async () => {
    const { routes, memory, activity } = setup()
    await routes.connect(send(gorgias))
    const response = await routes.connection(send({ provider: 'gorgias' }, 'DELETE'))
    expect(response.status).toBe(200)
    expect(memory.connections.size).toBe(0)
    expect(activity).toEqual(['connected:gorgias', 'disconnected:gorgias'])
  })

  it('runs the sync now on request and answers the connection after', async () => {
    const { routes, syncs } = setup()
    await routes.connect(send(gorgias))
    const answer = await (await routes.syncNow(send({ provider: 'gorgias' }))).json()
    expect(syncs).toEqual([`${HOST}_gorgias`])
    expect(answer.connection.provider).toBe('gorgias')
  })

  it('answers the log newest first to an editor', async () => {
    const { routes, memory } = setup()
    await routes.connect(send(gorgias))
    await memory.store.appendLog(`${HOST}_gorgias`, { atMs: NOW + 5, kind: 'run', message: 'later' })
    const editor = setup({ role: 'editor' })
    expect((await editor.routes.log(get('&provider=gorgias'))).status).toBe(200)
    const answer = await (await routes.log(get('&provider=gorgias'))).json()
    expect(answer.entries.map((entry: any) => entry.message)).toEqual(['later', 'Connected'])
  })
})
