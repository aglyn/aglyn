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

import type { PluginDraftRequest, PluginDraftWrite } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { matchRedirect } from '../model/redirects'
import {
  REDIRECT_AI_LOCKED_REFUSAL,
  REDIRECT_AI_PLAN_REFUSAL,
  REDIRECT_AI_ROLE_REFUSAL,
  createRedirectAiWriter,
  redirectAiLimitRefusal,
} from './redirect-ai-writer'

/**
 * The `redirect` writer (AGL-3745) against an in-memory Firestore: who may
 * change a rule, what a create, an update and a remove write, the page's
 * refusals (duplicates, loops, lookalikes, a published page's path), the
 * plan's allowance on a create only, the provenance stamp, the cache
 * announcement, and a change asked again that writes nothing twice.
 */

type Data = Record<string, unknown>

const docs = new Map<string, Data>()

function isDelete(value: unknown): boolean {
  return value instanceof FieldValue && value.isEqual(FieldValue.delete())
}

function withoutDeletes(data: Data): Data {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => !isDelete(value)))
}

class Snapshot {
  constructor(readonly ref: DocRef) {}
  get id() {
    return this.ref.id
  }
  get exists() {
    return docs.has(this.ref.path)
  }
  data() {
    const data = docs.get(this.ref.path)
    return data ? { ...data } : undefined
  }
  get(field: string) {
    return docs.get(this.ref.path)?.[field]
  }
}

class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  collection(name: string) {
    return new CollectionRef(`${this.path}/${name}`)
  }
  async get() {
    return new Snapshot(this)
  }
  async set(data: Data, options?: { merge?: boolean }) {
    docs.set(this.path, withoutDeletes(options?.merge ? { ...(docs.get(this.path) ?? {}), ...data } : data))
  }
}

class CollectionRef {
  constructor(readonly path: string) {}
  doc(id: string) {
    return new DocRef(`${this.path}/${id}`)
  }
  private children() {
    return [...docs.keys()].filter((path) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
  }
  async get() {
    return { docs: this.children().map((path) => new Snapshot(new DocRef(path))) }
  }
  count() {
    return { get: async () => ({ data: () => ({ count: this.children().length }) }) }
  }
  /** The live count's second aggregate (AGL-3918): Firestore's `!=` matches a document that HAS the field. */
  where(field: string, op: string, value: unknown) {
    if (op !== '!=') throw new Error(`the double does not evaluate ${op}`)
    const matching = () =>
      this.children().filter((path) => {
        const stored = docs.get(path)?.[field]
        return stored !== undefined && stored !== value
      })
    return { count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }) }
  }
}

const firestore = {
  collection: (name: string) => new CollectionRef(name),
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn({
      get: (target: { get(): Promise<unknown> }) => target.get(),
      create: (ref: DocRef, data: Data) => {
        if (docs.has(ref.path)) throw new Error('6 ALREADY_EXISTS')
        docs.set(ref.path, withoutDeletes(data))
      },
    })
  },
}

const HOST = 'host-1'
const EDITOR = 'uid-editor'
const AUTHOR = 'uid-author'
const RULES = `hosts/${HOST}/redirects`
const NOW = new Date('2026-10-12T12:00:00Z')

let locked = false
const announced: Array<readonly string[]> = []
const logged: string[] = []

const writer = createRedirectAiWriter({
  firestore: () => firestore as unknown as FirebaseFirestore.Firestore,
  lockdown: async () => locked,
  announcePaths: async (_hostId, paths) => {
    announced.push(paths)
  },
  logCreated: async (_hostId, _uid, ruleId) => {
    logged.push(ruleId)
  },
})

function request(content: Record<string, unknown>, overrides: Partial<PluginDraftRequest> = {}): PluginDraftRequest {
  return {
    orgId: 'org-1',
    hostId: HOST,
    uid: EDITOR,
    org: { plan: 'starter' },
    now: NOW,
    id: 'build-1-i0',
    name: 'Redirect',
    content,
    ...overrides,
  }
}

function rule(id: string): Data | undefined {
  return docs.get(`${RULES}/${id}`)
}

function liveRules(): Array<Data & { $id: string }> {
  return [...docs.entries()]
    .filter(([path, data]) => path.startsWith(`${RULES}/`) && !data['deletedAt'])
    .map(([path, data]) => ({ ...data, $id: path.slice(RULES.length + 1) }))
}

beforeEach(() => {
  docs.clear()
  announced.length = 0
  logged.length = 0
  locked = false
  docs.set(`hosts/${HOST}`, {
    memberRoles: { [EDITOR]: 'editor', [AUTHOR]: 'author' },
    subdomain: 'acme',
    screens: { home: '/', menu: 'menu', about: 'about' },
  })
  docs.set(`${RULES}/r1`, { source: '/shop', destination: '/menu', statusCode: 302, kind: 'exact', priority: 100, enabled: true, lastHitAt: 'kept' })
  docs.set(`${RULES}/r2`, { source: '/gone', destination: '/about', statusCode: 302, kind: 'exact', enabled: false, deletedAt: 'then' })
})

function refused(write: PluginDraftWrite): string | null {
  return write.ok === false ? write.error : null
}

describe('who may change a redirect', () => {
  it('admits a publisher on a plan with redirects', async () => {
    expect(await writer.refusal(request({}))).toBeNull()
  })

  it('refuses an author, a plan without redirects, a lockdown and a site that does not exist, in the page’s words', async () => {
    expect(await writer.refusal(request({}, { uid: AUTHOR }))).toEqual({ status: 403, error: REDIRECT_AI_ROLE_REFUSAL })
    expect(await writer.refusal(request({}, { org: { plan: 'free' } }))).toEqual({ status: 403, error: REDIRECT_AI_PLAN_REFUSAL })
    locked = true
    expect(await writer.refusal(request({}))).toEqual({ status: 403, error: REDIRECT_AI_LOCKED_REFUSAL })
    locked = false
    expect(await writer.refusal(request({}, { hostId: 'nope' }))).toEqual({ status: 404, error: 'Unknown site' })
  })

  it('makes the same checks when it writes', async () => {
    const write = await writer.write(request({ action: 'create', source: '/old-menu', destination: '/menu' }, { uid: AUTHOR }))
    expect(refused(write)).toBe(REDIRECT_AI_ROLE_REFUSAL)
    expect(rule('build-1-i0')).toBeUndefined()
  })
})

describe('creating a redirect', () => {
  it('writes the page’s rule with its defaults, live, and announces the path', async () => {
    const write = await writer.write(request({ action: 'create', source: '/Old-Menu/', destination: '/menu' }))
    expect(write).toMatchObject({
      ok: true,
      replayed: false,
      id: 'build-1-i0',
      name: '/old-menu → /menu',
      facts: { action: 'create', source: '/old-menu', destination: '/menu', statusCode: 302, kind: 'exact', enabled: true, live: true },
    })
    expect(rule('build-1-i0')).toEqual({
      source: '/old-menu',
      destination: '/menu',
      statusCode: 302,
      kind: 'exact',
      priority: 100,
      enabled: true,
      createdAt: Timestamp.fromDate(NOW),
      updatedAt: Timestamp.fromDate(NOW),
      createdBy: EDITOR,
    })
    expect(announced).toEqual([['/old-menu']])
    expect(logged).toEqual(['build-1-i0'])
    // The serve path fires it.
    expect(matchRedirect(liveRules() as never, '/old-menu')).toMatchObject({ destination: '/menu', statusCode: 302 })
  })

  it('stamps an off-site destination with the member the change is for', async () => {
    await writer.write(request({ action: 'create', source: '/order', destination: 'https://order.example.com/acme', statusCode: 301 }))
    expect(rule('build-1-i0')).toMatchObject({ statusCode: 301, externalDestinationApprovedBy: EDITOR })
    expect(matchRedirect(liveRules() as never, '/order')?.destination).toBe('https://order.example.com/acme')
  })

  it('asked again under the same id, answers with the rule it wrote', async () => {
    await writer.write(request({ action: 'create', source: '/old-menu', destination: '/menu' }))
    const again = await writer.write(request({ action: 'create', source: '/old-menu', destination: '/menu' }))
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'build-1-i0' })
    expect(logged).toHaveLength(1)
  })

  it('refuses a duplicate, a loop, a path to itself and a lookalike destination', async () => {
    expect(refused(await writer.write(request({ action: 'create', source: '/shop', destination: '/about' })))).toBe(
      'A rule for /shop already exists',
    )
    expect(refused(await writer.write(request({ action: 'create', source: '/menu-old', destination: '/shop' })))).toBeNull()
    docs.set(`${RULES}/r3`, { source: '/a', destination: '/b', statusCode: 302, kind: 'exact', enabled: true })
    expect(refused(await writer.write(request({ action: 'create', source: '/b', destination: '/a' }, { id: 'x2' })))).toBe(
      'That destination chains back to this rule — a redirect loop',
    )
    docs.set(`${RULES}/r4`, { source: '/b', destination: '/a', statusCode: 302, kind: 'exact', enabled: true })
    expect(refused(await writer.write(request({ action: 'create', source: '/c', destination: '/a' }, { id: 'x3' })))).toBe(
      'That destination leads into a redirect loop other rules already make',
    )
    expect(refused(await writer.write(request({ action: 'create', source: '/x', destination: '/x/' }, { id: 'x4' })))).toBe(
      'That would redirect the path to itself',
    )
    expect(refused(await writer.write(request({ action: 'create', source: '/pay', destination: 'https://paypa1.com/' }, { id: 'x5' })))).toMatch(
      /looks like another company's website/,
    )
  })

  it('keeps a published page unless the person asked for it to be redirected', async () => {
    const write = await writer.write(request({ action: 'create', source: '/about', destination: '/menu' }))
    expect(refused(write)).toMatch(/^\/about is a published page/)
    expect(rule('build-1-i0')).toBeUndefined()
    const asked = await writer.write(request({ action: 'create', source: '/about', destination: '/menu', replacesLivePage: true }))
    expect(asked.ok).toBe(true)
  })

  it('meets the plan’s allowance inside the write, counting live rules as the create route does (AGL-3918)', async () => {
    // Starter includes 25. `r1` and 23 more are 24 live; the deleted `r2` frees its slot, so one more fits.
    for (let index = 0; index < 23; index += 1) docs.set(`${RULES}/f${index}`, { source: `/f${index}`, destination: '/', statusCode: 302 })
    expect(refused(await writer.write(request({ action: 'create', source: '/one-more', destination: '/menu' })))).toBeNull()
    // 25 live now: the next is refused.
    expect(refused(await writer.write(request({ action: 'create', source: '/past-cap', destination: '/menu' }, { id: 'build-1-i1' })))).toBe(
      redirectAiLimitRefusal(25),
    )
  })
})

describe('changing a redirect', () => {
  it('updates the rule at the from-path, keeping what the page keeps', async () => {
    const write = await writer.write(request({ action: 'update', source: '/shop', destination: '/about', statusCode: 301 }))
    expect(write).toMatchObject({ ok: true, replayed: false, id: 'r1', facts: { action: 'update', destination: '/about', statusCode: 301 } })
    expect(rule('r1')).toMatchObject({
      source: '/shop',
      destination: '/about',
      statusCode: 301,
      lastHitAt: 'kept',
      updatedAt: Timestamp.fromDate(NOW),
    })
    expect(announced).toEqual([['/shop']])
  })

  it('moves a rule, announcing both paths, and keeps a published page there unless asked', async () => {
    expect(refused(await writer.write(request({ action: 'update', source: '/shop', newSource: '/about' })))).toMatch(/published page/)
    expect((await writer.write(request({ action: 'update', source: '/shop', newSource: '/store' }))).ok).toBe(true)
    expect(rule('r1')).toMatchObject({ source: '/store' })
    expect(announced).toEqual([['/store', '/shop']])
  })

  it('switches a rule off, and an update that changes nothing writes nothing', async () => {
    await writer.write(request({ action: 'update', source: '/shop', enabled: false }))
    expect(rule('r1')).toMatchObject({ enabled: false })
    announced.length = 0
    const again = await writer.write(request({ action: 'update', source: '/shop', enabled: false }))
    expect(again).toMatchObject({ ok: true, replayed: true })
    expect(announced).toEqual([])
  })

  it('removes the stamp when the destination comes back on the site', async () => {
    await writer.write(request({ action: 'update', source: '/shop', destination: 'https://order.example.com/' }))
    expect(rule('r1')).toMatchObject({ externalDestinationApprovedBy: EDITOR })
    await writer.write(request({ action: 'update', source: '/shop', destination: '/menu' }))
    expect(rule('r1')).not.toHaveProperty('externalDestinationApprovedBy')
  })

  it('refuses a rule the site does not have, and asks which when two modes share the path', async () => {
    expect(refused(await writer.write(request({ action: 'update', source: '/nope', destination: '/menu' })))).toBe(
      'The site has no redirect from /nope',
    )
    docs.set(`${RULES}/r5`, { source: '/shop', destination: '/about', statusCode: 302, kind: 'prefix', enabled: true })
    expect(refused(await writer.write(request({ action: 'update', source: '/shop', destination: '/' })))).toMatch(/say which match mode/)
    expect((await writer.write(request({ action: 'update', source: '/shop', kind: 'prefix', destination: '/' }))).ok).toBe(true)
    expect(rule('r5')).toMatchObject({ destination: '/' })
  })
})

describe('removing a redirect', () => {
  it('marks it deleted and off, as the page’s Delete does, and the serve path stops', async () => {
    const write = await writer.write(request({ action: 'remove', source: '/shop' }))
    expect(write).toMatchObject({ ok: true, replayed: false, id: 'r1', facts: { action: 'remove', removed: true, enabled: false } })
    expect(rule('r1')).toMatchObject({ enabled: false, deletedAt: Timestamp.fromDate(NOW) })
    expect(announced).toEqual([['/shop']])
    expect(matchRedirect(liveRules() as never, '/shop')).toBeNull()
  })

  it('asked again, is already done; a rule never there is refused', async () => {
    expect(await writer.write(request({ action: 'remove', source: '/gone' }))).toMatchObject({ ok: true, replayed: true, id: 'r2' })
    expect(refused(await writer.write(request({ action: 'remove', source: '/never' })))).toBe('The site has no redirect from /never')
  })
})

describe('reading', () => {
  it('reads the rule written under an id', async () => {
    expect(await writer.read({ hostId: HOST, id: 'r1' })).toMatchObject({ id: 'r1', name: '/shop → /menu' })
    expect(await writer.read({ hostId: HOST, id: 'nope' })).toBeNull()
  })

  it('refuses content the check refuses, before it reads the site', async () => {
    expect(refused(await writer.write(request({ action: 'create', source: '/a' })))).toBe(
      'Destinations are internal paths or https:// URLs',
    )
  })
})
