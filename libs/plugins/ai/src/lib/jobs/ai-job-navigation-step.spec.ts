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
 * The navigation step (AGL-3728). Its promises, each held against what the
 * store holds after:
 *
 *  - A menu change lands where no visitor sees it: a new version beside the
 *    layout's live one, which stays current. Without version history there
 *    is nowhere to land, and it is refused as a plan limit.
 *  - Only a member who may edit the site's content, while nothing freezes
 *    it — the editor's own rule — at the door and again at the write.
 *  - No model and no credits; every destination is the site's own page, a
 *    page the build made, a path on the site or an https address.
 *  - One version per job: a run asked again writes nothing.
 *  - A build plans it as an item, built after the pages it links.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { AI_BUILD_MADE_INPUT, aiBuildItemArgRefs, aiBuildOrder, aiBuildUnits } from '../model/ai-build-job'
import type { AiBuildPlan } from '../model/ai-build-plan'
import { AI_EDIT_NEEDS_VERSIONING_COPY } from '../model/ai-edit-job'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_NAVIGATION_STEP_MINIMUM_MS,
  AI_NAVIGATION_LOCKED_COPY,
  AI_NAVIGATION_NO_LAYOUT_COPY,
  AI_NAVIGATION_NOTHING_COPY,
  AI_NAVIGATION_ROLE_COPY,
  AI_NAVIGATION_VERSION_NAME,
  aiNavigationLayoutOf,
  aiNavigationTarget,
  createAiJobNavigationStep,
  createAiNavigationJobAdmission,
  registerAiNavigationJob,
  type AiNavigationSitePage,
} from './ai-job-navigation-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const PRO = { plan: 'pro', billingStatus: 'active' }
const STARTER = { plan: 'starter', billingStatus: 'active' }

// ── A store the step's reads and its transaction run against ─────────────

const docs = new Map<string, Record<string, unknown>>()

function fieldOf(data: Record<string, unknown> | undefined, field: string): unknown {
  return field.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data)
}

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').at(-1) as string,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => fieldOf(data, field),
  }
}

function refOf(path: string): any {
  return {
    path,
    id: path.split('/').at(-1),
    get: async () => snapshotOf(path),
    collection: (name: string) => collectionOf(`${path}/${name}`),
  }
}

function collectionOf(path: string) {
  return { doc: (id: string) => refOf(`${path}/${id}`) }
}

const firestore = {
  collection: (name: string) => collectionOf(name),
  runTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const tx = {
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        if (docs.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`)
        writes.push(() => docs.set(ref.path, data))
      },
    }
    const result = await run(tx)
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── The site ──────────────────────────────────────────────────────────────

const link = (id: string, parentId: string, children: string, to: Record<string, unknown>) => ({
  $id: id,
  componentId: 'muiScreenLink',
  pluginId: 'mui',
  parentId,
  props: { children, renderAs: 'link', color: 'inherit', ...to },
  nodes: [],
})

const FRAME = {
  root: { $id: 'root', componentId: 'div', nodes: ['bar', 'footer'] },
  bar: { $id: 'bar', componentId: 'muiAppBar', parentId: 'root', nodes: ['nav'] },
  nav: { $id: 'nav', componentId: 'muiStack', parentId: 'bar', props: { component: 'nav' }, nodes: ['home', 'about', 'blog'] },
  home: link('home', 'nav', 'Home', { screenId: 'p-home' }),
  about: link('about', 'nav', 'About', { screenId: 'p-about' }),
  blog: link('blog', 'nav', 'Blog', { href: '/blog' }),
  footer: { $id: 'footer', componentId: 'section', parentId: 'root', props: { element: 'footer' }, nodes: ['f-list'] },
  'f-list': { $id: 'f-list', componentId: 'muiStack', parentId: 'footer', nodes: ['f-home', 'f-about'] },
  'f-home': link('f-home', 'f-list', 'Home', { screenId: 'p-home' }),
  'f-about': link('f-about', 'f-list', 'About', { screenId: 'p-about' }),
}

const HOST = 'hosts/host-1'
const LAYOUT = `${HOST}/layouts/frame`
const PAGES: AiNavigationSitePage[] = [
  { id: 'p-home', title: 'Home', slug: '/', template: false, layoutId: 'frame' },
  { id: 'p-about', title: 'About', slug: 'about', template: false, layoutId: 'frame' },
  { id: 'p-pricing', title: 'Pricing', slug: 'pricing', template: false, layoutId: 'frame' },
  { id: 'p-post', title: 'Post', slug: 'post', template: true, layoutId: null },
]

function seed(role = 'editor') {
  docs.clear()
  docs.set(HOST, { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': role } })
  docs.set(LAYOUT, { displayName: 'Site', versionId: 'v-live' })
  docs.set(`${LAYOUT}/versions/v-live`, { layoutId: 'frame', displayName: 'Initial version', nodes: Buffer.from(encodeStoredNodes(FRAME as never) as Uint8Array) })
}

function job(inputs: Record<string, unknown>, overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-nav-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'navigation',
    status: 'running',
    brief: 'Add Pricing to the menu and take Blog out.',
    inputs,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    ...overrides,
  } as AiJob
}

const lockdownOpen = jest.fn(async () => null)
const run = (inputs: Record<string, unknown>, org: object = PRO, lockdown = lockdownOpen) =>
  createAiJobNavigationStep({ readPages: async () => PAGES, lockdown: lockdown as never })({
    job: job(inputs),
    stepIndex: 0,
    now: NOW,
    firestore,
    org: org as never,
  })

const labelsOf = (nodes: Record<string, any>, list: string) => (nodes[list].nodes as string[]).map((id) => nodes[id].props.children)

beforeEach(() => {
  seed()
  lockdownOpen.mockClear()
})

describe('what a menu item may link (AGL-3728)', () => {
  const made = { pages: [{ title: 'Pricing', id: 'p-pricing' }, { title: 'Gone', id: 'p-gone' }], layouts: [] }

  it('links the site’s pages, the pages this build made, paths on the site and https addresses, and nothing else', () => {
    expect(aiNavigationTarget('new:pricing', { pages: PAGES, made })).toEqual({ screenId: 'p-pricing' })
    // A page the build was to make and the site does not have is no destination.
    expect(aiNavigationTarget('new:Gone', { pages: PAGES, made })).toBeNull()
    expect(aiNavigationTarget('p-about', { pages: PAGES, made })).toEqual({ screenId: 'p-about' })
    expect(aiNavigationTarget('page:p-about', { pages: PAGES, made })).toEqual({ screenId: 'p-about' })
    // A record or entry template renders at no address of its own.
    expect(aiNavigationTarget('p-post', { pages: PAGES, made })).toBeNull()
    expect(aiNavigationTarget('/contact', { pages: PAGES, made })).toEqual({ href: '/contact' })
    expect(aiNavigationTarget('https://instagram.com/juniper', { pages: PAGES, made })).toEqual({ href: 'https://instagram.com/juniper' })
    for (const refused of ['http://example.com', '//evil.example', 'javascript:alert(1)', 'p-nowhere', 'contact page']) {
      expect([refused, aiNavigationTarget(refused, { pages: PAGES, made })]).toEqual([refused, null])
    }
  })

  it('changes the layout it names, a layout the build made, else the one the site’s home renders in', () => {
    const made2 = { pages: [], layouts: [{ name: 'studio frame', id: 'lay-new' }] }
    expect(aiNavigationLayoutOf('lay-1', { pages: PAGES, made: made2 })).toBe('lay-1')
    expect(aiNavigationLayoutOf('new:Studio frame', { pages: PAGES, made: made2 })).toBe('lay-new')
    expect(aiNavigationLayoutOf('', { pages: PAGES, made: made2 })).toBe('frame')
    expect(aiNavigationLayoutOf('', { pages: [], made: made2 })).toBeNull()
  })
})

describe('the navigation step (AGL-3728)', () => {
  it('saves the change as a new version beside the live layout, at no cost, and names what it did', async () => {
    const outcome = await run({ menu: 'both', add: ['Pricing => p-pricing'], remove: ['Blog'], order: ['About'] })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    const version = docs.get(`${LAYOUT}/versions/job-nav-1`) as Record<string, unknown>
    expect(version).toMatchObject({ displayName: AI_NAVIGATION_VERSION_NAME, createdBy: 'uid-1', aiJobId: 'job-nav-1', layoutId: 'frame' })
    const nodes = decodeStoredNodes<Record<string, any>>(version['nodes']) as Record<string, any>
    expect(labelsOf(nodes, 'nav')).toEqual(['About', 'Home', 'Pricing'])
    expect(labelsOf(nodes, 'f-list')).toEqual(['About', 'Home', 'Pricing'])
    // What visitors see is unchanged: the live version and the pointer.
    expect(docs.get(LAYOUT)?.['versionId']).toBe('v-live')
    expect(labelsOf(decodeStoredNodes<Record<string, any>>(docs.get(`${LAYOUT}/versions/v-live`)?.['nodes']) as Record<string, any>, 'nav')).toEqual([
      'Home',
      'About',
      'Blog',
    ])
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'layout', id: 'frame', versionId: 'job-nav-1', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Site' }),
    ])
    const note = outcome.outputs[0].note as string
    expect(note).toContain('Added “Pricing” to the header.')
    expect(note).toContain('Took “Blog” out of the header.')
    expect(note).toContain('publish it when it is ready')
    // The footer had no Blog to take out, and says so.
    expect(note).toContain('Not done: No “Blog” in the footer to take out.')
    expect(lockdownOpen).toHaveBeenCalledWith(expect.objectContaining({ staff: false, uid: 'uid-1', intent: 'write' }))
  })

  it('finds what it wrote when asked again, and writes nothing more', async () => {
    await run({ add: ['Pricing => p-pricing'] })
    const first = docs.get(`${LAYOUT}/versions/job-nav-1`)
    const again = await run({ add: ['Pricing => p-pricing'] })
    expect(again.outputs).toEqual([expect.objectContaining({ resource: 'layout', versionId: 'job-nav-1' })])
    expect(docs.get(`${LAYOUT}/versions/job-nav-1`)).toBe(first)
  })

  it('refuses a member who may not edit the site, a frozen site and a plan without version history, writing nothing', async () => {
    seed('viewer')
    expect((await run({ add: ['Pricing => p-pricing'] })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_NAVIGATION_ROLE_COPY }))
    seed()
    expect((await run({ add: ['Pricing => p-pricing'] }, PRO, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(
      AI_NAVIGATION_LOCKED_COPY,
    )
    expect((await run({ add: ['Pricing => p-pricing'] }, STARTER)).review?.message).toBe(AI_EDIT_NEEDS_VERSIONING_COPY)
    expect(docs.has(`${LAYOUT}/versions/job-nav-1`)).toBe(false)
  })

  it('says why when there is nothing it can change', async () => {
    expect((await run({ add: ['Shop => p-nowhere'] })).failure).toBe(
      `${AI_NAVIGATION_NOTHING_COPY} “Shop” links “p-nowhere”, which is no page or address on this site, so it was left out.`,
    )
    expect((await run({ remove: ['Gallery'] })).failure).toBe('No “Gallery” in the header to take out.')
    expect(
      (
        await createAiJobNavigationStep({ readPages: async () => [], lockdown: lockdownOpen as never })({
          job: job({ add: ['Contact => /contact'] }),
          stepIndex: 0,
          now: NOW,
          firestore,
          org: PRO as never,
        })
      ).failure,
    ).toBe(AI_NAVIGATION_NO_LAYOUT_COPY)
  })
})

describe('the navigation door (AGL-3728)', () => {
  const admission = createAiNavigationJobAdmission({
    ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'),
    readPages: async () => PAGES,
    lockdown: lockdownOpen as never,
  })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { add: ['Pricing => p-pricing'] }, org: PRO, uid: 'uid-1', ...overrides })

  it('admits an editor on a plan with version history, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_NAVIGATION_ROLE_COPY })
    expect(await ask({ org: STARTER })).toEqual({ status: 403, error: AI_EDIT_NEEDS_VERSIONING_COPY })
    expect(await ask({ inputs: { add: ['Shop => nowhere'] } })).toEqual(expect.objectContaining({ status: 400 }))
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiNavigationJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('navigation', expect.any(Function), { minimumMs: AI_JOB_NAVIGATION_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('navigation')).toBeTruthy()
  })
})

describe('the navigation operation a build plans (AGL-3728)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'navigation')

  it('is offered as one item a plan, costs no credits, and holds the planner to its arguments', () => {
    expect(capability).toMatchObject({ runnerKind: 'navigation', maxPerPlan: 1, freeAllowed: false, feature: 'versioning', degrade: 'omit' })
    expect(capability?.estimateCredits({ add: ['A => /a'] })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(pluginAiCapabilityArgsProblems(schema, { menu: 'header', add: ['Pricing => new:Pricing'], order: ['Home'] })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { menu: 'sidebar' })).toEqual(['"menu" must be one of header, footer, both'])
    expect(pluginAiCapabilityArgsProblems(schema, { add: 'Pricing => /pricing' })).toEqual(['"add" must be a list of text'])
  })

  it('is built after the pages its arguments link, whatever the plan’s dependsOn says', () => {
    expect(aiBuildItemArgRefs({ menu: 'header', add: ['Pricing => new:Pricing', 'Blog => /blog'], layout: 'new:Studio frame' })).toEqual([
      'new:Pricing',
      'new:Studio frame',
    ])
    const plan = {
      reuse: [],
      create: [],
      screens: [
        { title: 'Pricing', slug: 'pricing', layout: null, template: null, duplicateOf: null, nav: true, seoTitle: '', seoDescription: '', sections: [], record: null },
      ],
      items: [{ slot: 'i0', op: 'navigation', name: 'Menu', why: 'Link Pricing.', dependsOn: [], degrade: 'omit', args: { add: ['Pricing => new:Pricing'] } }],
    } as unknown as AiBuildPlan
    const units = aiBuildUnits(plan)
    expect(units.find((unit) => unit.slot === 'i0')?.deps).toEqual(['p0'])
    expect(aiBuildOrder(units)?.map((unit) => unit.slot)).toEqual(['p0', 'i0'])
    expect(AI_BUILD_MADE_INPUT).toBe('buildMade')
  })
})
