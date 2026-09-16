/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The email design writer (AGL-2912), against the real document builder, the
 * real renderer and the real screen arithmetic: only the Admin SDK is a
 * double, one that honors transactions, and the non-page ceiling is lowered so
 * a site can reach it in three documents.
 *
 *  - THE DOCUMENTS are the pair the console's create makes, plus the stamps
 *    the resources route adds and the subject lines a campaign opens on.
 *  - THE ROOM AND THE ROLE are refused in the resources route's own words.
 *  - THE CHECK renders through the send path's renderer.
 *  - THE PROVENANCE of what it writes reads as the site's own template.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

jest.mock('@aglyn/aglyn/app-utils/screen-route', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/screen-route'),
  NON_PAGE_SCREEN_MAX_PER_HOST: 3,
}))

import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { emailDesignDocuments } from './model/email-design-document'
import { templateProvenance } from './model/template-provenance'
import {
  checkEmailDesignContent,
  createEmailDesignDraftWriter,
  EMAIL_DESIGN_DRAFT_RESOURCE,
  EMAIL_DESIGN_LIMIT_REFUSAL,
  EMAIL_DESIGN_ROLE_REFUSAL,
  emailDesignDraftWriter,
  registerEmailDesignDraftWriter,
} from './server-email-drafts'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T20:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query = {
    kind: 'query',
    get: async () => ({
      docs: [...store.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf),
    }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const writer = createEmailDesignDraftWriter({ firestore: () => firestore, mintId: () => 'v-1' })

// ── Fixtures ─────────────────────────────────────────────────────────────

const NODES = {
  [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['band'] },
  band: {
    $id: 'band',
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: CANVAS_ROOT_ELEMENT_ID,
    props: { backgroundColor: '#f4e3c1' },
    nodes: ['hello', 'cta'],
  },
  hello: {
    $id: 'hello',
    componentId: 'emailText',
    pluginId: 'email',
    parentId: 'band',
    props: { variant: 'body', children: 'Hi {{contact.firstName}}, the cardamom buns are back this weekend.' },
  },
  cta: {
    $id: 'cta',
    componentId: 'emailButton',
    pluginId: 'email',
    parentId: 'band',
    props: { children: 'See the menu', href: '{{site.url}}/menu' },
  },
}

const CONTENT = {
  nodes: NODES,
  subject: 'Cardamom buns are back',
  preheader: 'Saturday and Sunday mornings, while they last.',
  subjectVariants: ['Cardamom buns are back', 'Guess what is back this weekend', 'Your weekend bun is here'],
  preheaderVariants: ['Saturday and Sunday mornings, while they last.', 'Warm from 7 am.', 'Come early.'],
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: null,
  now: NOW,
  id: 'job-1',
  name: 'Weekend buns',
  content: CONTENT,
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { subdomain: 'tidewater', memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the email design writer', () => {
  it('writes the screen and first version the console’s create writes, with the route’s stamps and the subject lines', async () => {
    const written = await writer.write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'job-1',
      name: 'Weekend buns',
      versionId: 'v-1',
      facts: {
        subject: CONTENT.subject,
        preheader: CONTENT.preheader,
        subjectVariants: CONTENT.subjectVariants,
        preheaderVariants: CONTENT.preheaderVariants,
      },
    })
    expect(commits).toEqual(['hosts/host-1/screens/job-1', 'hosts/host-1/screens/job-1/versions/v-1'])

    const { screen, version } = emailDesignDocuments({
      screenId: 'job-1',
      versionId: 'v-1',
      displayName: 'Weekend buns',
      nodes: NODES,
    })
    expect(store.get('hosts/host-1/screens/job-1')).toEqual({
      ...screen,
      nameLower: 'weekend buns',
      emailSubject: CONTENT.subject,
      emailPreheader: CONTENT.preheader,
      emailSubjectVariants: CONTENT.subjectVariants,
      emailPreheaderVariants: CONTENT.preheaderVariants,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    const stored = store.get('hosts/host-1/screens/job-1/versions/v-1') as Record<string, unknown>
    expect({ ...stored, nodes: decodeStoredNodes(stored['nodes']) }).toEqual({
      ...version,
      hostId: 'host-1',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-1',
    })
    // The host document and its routing map are untouched: a design is routed nowhere.
    expect(store.get('hosts/host-1')).not.toHaveProperty('screens')
  })

  it('reads as the site’s own template, never an installed one', async () => {
    await writer.write(request())
    expect(templateProvenance(store.get('hosts/host-1/screens/job-1') as never)).toMatchObject({
      origin: 'local',
      standing: 'local',
      warn: false,
    })
  })

  it('makes the name unique among the site’s live screens, and lets a deleted one’s name go', async () => {
    store.set('hosts/host-1/screens/scr-a', { displayName: 'Weekend buns', kind: 'email' })
    store.set('hosts/host-1/screens/scr-b', { displayName: 'Weekend buns 2', kind: 'email', deletedAt: NOW })
    const written = await writer.write(request())
    expect(written).toMatchObject({ ok: true, name: 'Weekend buns 2' })
  })

  it('reports the design a run already wrote under the id, and writes nothing', async () => {
    await writer.write(request())
    commits = []
    const again = await writer.write(request({ name: 'Something else', content: { ...CONTENT, subject: 'Other' } }))
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'job-1', name: 'Weekend buns', versionId: 'v-1' })
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'job-1' })).toMatchObject({
      name: 'Weekend buns',
      facts: { subject: CONTENT.subject, subjectVariants: CONTENT.subjectVariants },
    })
    store.set('hosts/host-1/screens/page-1', { displayName: 'Home' })
    expect(await writer.write(request({ id: 'page-1' }))).toEqual({
      ok: false,
      status: 409,
      error: 'That id already names a screen that is not an email design',
    })
    expect(await writer.read({ hostId: 'host-1', id: 'page-1' })).toBeNull()
  })

  it('refuses in the resources route’s words: an unknown site, a member who may not write, a site with no room', async () => {
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-9', uid: 'uid-1', org: null, now: NOW })).toEqual({
      status: 404,
      error: 'Unknown site',
    })
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-2', org: null, now: NOW })).toEqual({
      status: 403,
      error: EMAIL_DESIGN_ROLE_REFUSAL,
    })
    expect(await writer.write(request({ uid: 'uid-2' }))).toEqual({
      ok: false,
      status: 403,
      error: EMAIL_DESIGN_ROLE_REFUSAL,
    })
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-1', org: null, now: NOW })).toBeNull()
    for (const id of ['e1', 'e2', 'e3']) store.set(`hosts/host-1/screens/${id}`, { displayName: id, kind: 'email' })
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-1', org: null, now: NOW })).toEqual({
      status: 403,
      error: EMAIL_DESIGN_LIMIT_REFUSAL,
    })
    expect(await writer.write(request())).toEqual({ ok: false, status: 403, error: EMAIL_DESIGN_LIMIT_REFUSAL })
    expect(EMAIL_DESIGN_LIMIT_REFUSAL).toBe(
      'This site is at its limit of 3 email and template screens — delete some to make room',
    )
    const route = readFileSync(join(REPO_ROOT, 'apps/console/app/api/hosts/resources/route.ts'), 'utf8')
    expect(route).toContain("'Editing requires the editor role'")
    expect(route).toContain('email and template screens — ')
    expect(route).toContain("'delete some to make room'")
  })

  it('refuses content that is no design, in words a caller can show', async () => {
    expect(await writer.write(request({ content: { nodes: {} } }))).toEqual({
      ok: false,
      status: 400,
      error: 'The design has no blocks',
    })
    expect(commits).toEqual([])
  })
})

describe('checkEmailDesignContent', () => {
  it('renders a design through the send path’s renderer and reports what it rendered', () => {
    const checked = checkEmailDesignContent(CONTENT, { hostId: 'host-1' })
    expect(checked).toMatchObject({
      ok: true,
      facts: { blocks: 4, plainText: { source: 'generated', stale: false } },
    })
    const facts = (checked as { facts: Record<string, unknown> }).facts
    expect(facts['messageText']).toContain('the cardamom buns are back this weekend')
    expect(facts['messageText']).toContain('See the menu: https://example.com/menu')
    expect(facts['htmlBytes']).toBeGreaterThan(500)
  })

  it('names every reason a design would not arrive as written', () => {
    expect(checkEmailDesignContent({ nodes: { x: { componentId: 'emailText' } } }, { hostId: 'host-1' })).toEqual({
      ok: false,
      problems: ['The design has no root to render from'],
    })
    const broken = {
      nodes: {
        ...NODES,
        band: { ...NODES.band, nodes: ['hello', 'cta', 'nowhere', 'path', 'mine'] },
        cta: { ...NODES.cta, props: { children: 'See the menu' } },
        path: { componentId: 'emailButton', props: { children: 'Menu', href: '/menu' } },
        mine: { componentId: 'emailButton', props: { children: 'Me', href: 'https://example.com/?e={{contact.email}}' } },
        stray: { componentId: 'emailText', props: { children: 'Never placed' } },
      },
      subject: 'x'.repeat(201),
    }
    expect(checkEmailDesignContent(broken, { hostId: 'host-1' })).toEqual({
      ok: false,
      problems: [
        'The design lists a block it does not hold',
        '1 block is not placed in the design, so it would not be sent',
        'A subject line is longer than 200 characters',
      ],
    })
    const links = { ...broken, subject: 'Fine', nodes: { ...broken.nodes, band: { ...broken.nodes.band, nodes: ['hello', 'cta', 'path', 'mine'] } } }
    delete (links.nodes as Record<string, unknown>)['stray']
    expect(checkEmailDesignContent(links, { hostId: 'host-1' })).toEqual({
      ok: false,
      problems: [
        "A button puts the reader's own details in its link, which is never filled",
        'A button links to a path with no site in front of it, which an inbox cannot open',
        'A button links nowhere',
      ],
    })
    const silent = {
      nodes: {
        [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['band'] },
        band: { componentId: 'emailSection', nodes: ['gap'] },
        gap: { componentId: 'emailSpacer', props: { height: '24' } },
      },
    }
    expect(checkEmailDesignContent(silent, { hostId: 'host-1' })).toEqual({
      ok: false,
      problems: ['The design renders no message: it needs at least one block of text'],
    })
  })
})

describe('registration', () => {
  it('registers the writer as the email plugin’s, from both server surfaces', () => {
    registerEmailDesignDraftWriter()
    expect(pluginResourceDraftWriter(EMAIL_DESIGN_DRAFT_RESOURCE)).toEqual({
      pluginId: 'email',
      writer: emailDesignDraftWriter,
    })
    const tenant = readFileSync(join(__dirname, 'server.ts'), 'utf8')
    const consoleApi = readFileSync(join(__dirname, 'server-console.ts'), 'utf8')
    expect(tenant).toMatch(/export function registerEmailApi\(\): void \{[^}]*registerEmailDesignDraftWriter\(\)/)
    expect(consoleApi).toMatch(
      /export function registerEmailConsoleApi\(\): void \{[\s\S]*?registerEmailDesignDraftWriter\(\)[\s\S]*?\n\}/,
    )
  })
})
