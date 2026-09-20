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
 * AGL-2906: level 3's client half — the edit card, and the guard the issue
 * names: nothing is written before confirm.
 *
 * The canvas is the REAL canvas singleton from `@aglyn/aglyn`, seeded with a
 * small page, and the editor is registered through the real session seam the
 * besigner pages use. So "nothing written" is measured on the document the
 * besigner would save — its JSON and its undo stack — rather than on a
 * double that counts calls, and "applied" is measured the same way. The
 * network is recorded on every case.
 *
 * Kept in its own file beside `assist-panel-proposal.spec.tsx`, which pins
 * the level-2 navigation card and answers a different question.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { canvas, CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import {
  registerEditorSession,
  resetEditorSessionsForTests,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}

/** Every request the panel made, as `[url, parsedBody]`. */
const posts: Array<[string, Record<string, unknown>]> = []
const tracked: Array<[string, Record<string, unknown>]> = []
const snacks: string[] = []

const ROOT = CANVAS_ROOT_ELEMENT_ID
const BESIGNER = '/acme/hosts/host-1/screens/screen-1/versions/v-2/besigner'
const routeScope = { pathname: BESIGNER }
const aiPermissions = { loaded: true, use: true, generate: true }

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: (name: string, params: Record<string, unknown>) => {
    tracked.push([name, params])
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: (message: string) => {
      snacks.push(message)
    },
  }),
}))

jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => ({ title: '', excerpt: '', href: '' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  HelpTip: () => null,
  AppLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as string}</a>
  ),
  MdiIcon: () => <span />,
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => routeScope.pathname,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

import '../declarations'
import AssistPanelComponent from './assist-panel.component'

/** A small page: a hero section with a heading, then a footer. */
const PAGE = {
  [ROOT]: { $id: ROOT, componentId: 'div', props: {}, nodes: ['hero', 'footer'] },
  hero: {
    $id: 'hero',
    componentId: 'muiStack',
    parentId: ROOT,
    props: { component: 'section' },
    sx: { bgcolor: 'background.paper', py: 8 },
    nodes: ['headline'],
  },
  headline: {
    $id: 'headline',
    componentId: 'muiTypography',
    parentId: 'hero',
    props: { children: 'Build faster', variant: 'h1', component: 'h1' },
    nodes: [],
  },
  footer: { $id: 'footer', componentId: 'muiBox', parentId: ROOT, props: {}, nodes: [] },
}

/** A proposal exactly as the chat door sends it on `done`. */
const EDIT = {
  id: 'edit.canvas',
  summary: 'Darken the hero, sharpen the headline and add a quote',
  ops: [
    { op: 'updateSx', nodeId: 'hero', componentId: 'muiStack', sx: { bgcolor: 'grey.900' } },
    {
      op: 'updateProps',
      nodeId: 'headline',
      componentId: 'muiTypography',
      props: { children: 'Ship faster' },
    },
    {
      op: 'insertSubtree',
      parentId: ROOT,
      parentComponentId: 'div',
      index: null,
      rootId: 'q1',
      nodes: {
        q1: { $id: 'q1', componentId: 'muiBox', parentId: ROOT, nodes: ['q2'], props: {} },
        q2: {
          $id: 'q2',
          componentId: 'muiTypography',
          parentId: 'q1',
          nodes: [],
          props: { children: 'Loved it' },
        },
      },
    },
    { op: 'setSeo', fields: { title: 'Ship faster with Acme' } },
  ],
  diff: { added: 2, removed: 0, propsChanged: 1, stylesChanged: 1, moved: 0, renamed: 0, seoFields: 1 },
  dropped: [],
  target: { kind: 'screen', documentId: 'screen-1', versionId: 'v-2', hostId: 'host-1' },
}

let chatResponse: unknown = null

/** Arm one streamed answer carrying an edit proposal. */
function armChat(text: string, edit: unknown = EDIT): void {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text })}\n\n`,
    `data: ${JSON.stringify({ type: 'done', exchangeId: 'exchange-1', docs: [], proposal: null, edit })}\n\n`,
  ]
  const chunks = frames.map((frame) => new TextEncoder().encode(frame))
  chatResponse = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined },
      }),
    },
  }
}

/** The editor as the besigner page registers it, with its own state to inspect. */
function openEditor(options: { documentId?: string; versionId?: string; live?: boolean } = {}) {
  const state = {
    live: options.live ?? false,
    staged: {} as Record<string, string>,
    revealed: 0,
    versionFlows: 0,
  }
  let unregister: () => void = () => undefined
  act(() => {
    unregister = registerEditorSession({
      documentKind: 'screen',
      documentId: options.documentId ?? 'screen-1',
      versionId: options.versionId ?? 'v-2',
      isLiveVersion: () => state.live,
      selectedNodeId: () => 'hero',
      createVersion: () => {
        state.versionFlows += 1
      },
      fields: {
        'seo.title': (value) => {
          state.staged['seo.title'] = value
        },
        'seo.description': (value) => {
          state.staged['seo.description'] = value
        },
      },
      revealFields: () => {
        state.revealed += 1
      },
    })
  })
  return { state, unregister: () => act(() => unregister()) }
}

function dockProps() {
  return {
    orgId: 'org-1',
    // Free carries AI generation as its taste, so the rung is reachable.
    org: { plan: 'free' as const },
    orgReady: true,
    scopedOrgId: 'org-1',
    orgSlug: 'acme',
    hostId: 'host-1',
    productName: 'Aglyn',
    assistVisible: true,
    assistStaffPreview: false,
    generativeVisible: true,
    isStaff: false,
    aiPermissions,
  }
}

async function ask(question = 'Make this hero darker'): Promise<void> {
  fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
  fireEvent.change(await screen.findByPlaceholderText('How do I…'), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
}

const canvasJson = () => JSON.stringify(canvas.toJSON())

beforeEach(() => {
  posts.length = 0
  tracked.length = 0
  snacks.length = 0
  aiPermissions.generate = true
  routeScope.pathname = BESIGNER
  sessionStorage.clear()
  resetEditorSessionsForTests()
  canvas.reset()
  canvas.setNodes(PAGE as never)
  chatResponse = null
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    posts.push([String(url), JSON.parse(String(init?.body ?? '{}'))])
    if (String(url).includes('/api/assist/edit-applied')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (!chatResponse) throw new Error(`unarmed request to ${url}`)
    return chatResponse
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  resetEditorSessionsForTests()
  canvas.reset()
  jest.restoreAllMocks()
})

describe('the question carries the canvas it is about', () => {
  it('sends an outline of the open canvas — ids, components, short values — and the selection', async () => {
    openEditor()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    await waitFor(() => expect(posts).toHaveLength(1))
    const outline = posts[0][1]['canvas'] as {
      selectedId: string
      total: number
      nodes: Array<Record<string, unknown>>
    }
    expect(outline.selectedId).toBe('hero')
    expect(outline.nodes.map((node) => node['id'])).toEqual([ROOT, 'hero', 'footer', 'headline'])
    expect(outline.total).toBe(4)
    expect(outline.nodes.find((node) => node['id'] === 'headline')).toMatchObject({
      componentId: 'muiTypography',
      parentId: 'hero',
      props: { children: 'Build faster', variant: 'h1', component: 'h1' },
    })
  })

  it('sends no canvas while the open editor is on a version other than the one the route names', async () => {
    openEditor({ versionId: 'v-1' })
    armChat('Answer only.', null)
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0][1]['canvas']).toBeUndefined()
  })

  it('sends no canvas for a reader who may not generate, or with no editor open', async () => {
    aiPermissions.generate = false
    openEditor()
    armChat('Answer only.', null)
    const { unmount } = render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0][1]['canvas']).toBeUndefined()
    unmount()

    aiPermissions.generate = true
    resetEditorSessionsForTests()
    posts.length = 0
    sessionStorage.clear()
    armChat('Answer only.', null)
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0][1]['canvas']).toBeUndefined()
  })
})

describe('GUARD: nothing is written before confirm', () => {
  it('shows the proposal while the canvas, its undo stack and the editor’s fields stay untouched', async () => {
    const editor = openEditor()
    const before = canvasJson()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    expect(await screen.findByText('Proposed change')).toBeTruthy()
    expect(screen.getByText('1 element restyled')).toBeTruthy()
    expect(screen.getByText('2 elements added')).toBeTruthy()
    expect(screen.getByText(/changes nothing until you apply/)).toBeTruthy()

    expect(canvasJson()).toBe(before)
    expect(canvas.canUndo).toBe(false)
    expect(editor.state.staged).toEqual({})
    expect(editor.state.revealed).toBe(0)
    expect(posts.map(([url]) => url)).toEqual(['/api/assist/chat'])
  })

  it('declining removes the card, writes nothing and sends nothing', async () => {
    openEditor()
    const before = canvasJson()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    fireEvent.click(await screen.findByText('No thanks'))
    await waitFor(() => expect(screen.queryByText('Proposed change')).toBeNull())
    expect(canvasJson()).toBe(before)
    expect(canvas.canUndo).toBe(false)
    expect(posts.map(([url]) => url)).toEqual(['/api/assist/chat'])
  })

  it('on the version the live site serves, offers the editor’s own new-version flow and applies nothing', async () => {
    const live = openEditor({ live: true })
    const before = canvasJson()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    expect(await screen.findByText(/version your live site shows/)).toBeTruthy()
    expect(screen.queryByText('Apply as draft')).toBeNull()

    fireEvent.click(screen.getByText('Make a new version'))
    expect(live.state.versionFlows).toBe(1)
    expect(canvasJson()).toBe(before)
    expect(posts.map(([url]) => url)).toEqual(['/api/assist/chat'])

    // The new version opens; the same card now offers Apply there.
    live.unregister()
    openEditor({ versionId: 'v-3' })
    expect(await screen.findByText('Apply as draft')).toBeTruthy()
    expect(canvasJson()).toBe(before)
  })

  it('off the document the proposal was made for, there is nothing to apply', async () => {
    openEditor({ documentId: 'screen-9' })
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    expect(await screen.findByText(/Open this page in the Besigner/)).toBeTruthy()
    expect(screen.queryByText('Apply as draft')).toBeNull()
  })
})

describe('Apply as draft', () => {
  it('lands every op as ONE undo step, keeps the settings the element had, and stages the search title', async () => {
    const editor = openEditor()
    const before = canvasJson()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    fireEvent.click(await screen.findByText('Apply as draft'))
    expect(await screen.findByText('Applied to the canvas as unsaved changes.')).toBeTruthy()

    // The AGL-1227 trap: the patch named `children` only, and the heading
    // must still be a heading.
    expect(canvas.getNode('headline')?.props).toEqual({
      children: 'Ship faster',
      variant: 'h1',
      component: 'h1',
    })
    expect(canvas.getNode('hero')?.sx).toEqual({ bgcolor: 'grey.900', py: 8 })
    const rootChildren = canvas.getNode(ROOT)?.nodes ?? []
    expect(rootChildren).toHaveLength(3)
    const added = canvas.getNode(rootChildren[2])
    expect(added?.componentId).toBe('muiBox')
    expect(canvas.getNode(added?.nodes?.[0] as string)?.props).toEqual({ children: 'Loved it' })
    // The search title went to the editor's own form, not to a document.
    expect(editor.state.staged).toEqual({ 'seo.title': 'Ship faster with Acme' })
    expect(editor.state.revealed).toBe(1)

    // One undo takes the whole proposal back.
    act(() => {
      canvas.undo()
    })
    expect(canvasJson()).toBe(before)
    expect(canvas.canUndo).toBe(false)

    // The one request that follows is the record of counts.
    await waitFor(() => expect(posts).toHaveLength(2))
    const [url, report] = posts[1]
    expect(url).toBe('/api/assist/edit-applied')
    expect(report).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      exchangeId: 'exchange-1',
      documentKind: 'screen',
      documentId: 'screen-1',
      versionId: 'v-2',
      opCounts: { restyle: 1, set: 1, insert: 1, seo: 1 },
    })
    expect(JSON.stringify(report)).not.toContain('Ship faster')
    expect(tracked).toContainEqual(['assistant_proposal_confirmed', { action: 'edit.canvas' }])
  })

  it('a proposal the canvas no longer matches is refused whole, and the card says why', async () => {
    openEditor()
    armChat('I would darken the hero.')
    render(<AssistPanelComponent {...dockProps()} />)
    await ask()
    await screen.findByText('Apply as draft')
    // A co-editor removes the heading while the card is open.
    act(() => {
      canvas.deleteNode(canvas.getNode('headline') as never)
    })
    const afterDelete = canvasJson()
    fireEvent.click(screen.getByText('Apply as draft'))
    expect(await screen.findByText(/changed since this was proposed/)).toBeTruthy()
    expect(canvasJson()).toBe(afterDelete)
    expect(posts.map(([requested]) => requested)).toEqual(['/api/assist/chat'])
  })
})
