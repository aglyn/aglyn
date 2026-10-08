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
 * AGL-3616: a follow-up on what a build made. "Make the about page shorter",
 * asked away from that page's Besigner, is a card that opens the draft's own
 * Besigner — an address from the panel's record of its build, never the
 * server's — and the panel asks the request again once that draft's canvas
 * is open, where the edit rung answers it. Confirming writes nothing.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  registerEditorSession,
  resetEditorSessionsForTests,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}

const posts: Array<[string, Record<string, unknown>]> = []
const aiPermissions = { loaded: true, use: true, generate: true }
const route = { pathname: '/acme/hosts/host-1/screens' }

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({ __esModule: true, trackEvent: () => undefined }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))
jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => ({ title: '', excerpt: '', href: '' }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  HelpTip: () => null,
  AppLink: ({ href, children, onClick }: { href: string; children: unknown; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children as string}
    </a>
  ),
  MdiIcon: () => <span />,
}))
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => route.pathname }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

import '../declarations'
import AssistPanelComponent, { assistThreadDraftLinks } from './assist-panel.component'
import { resetAiJobsStoreForTests } from './ai-jobs-store'

const ABOUT_HREF = '/acme/hosts/site-sub/screens/scr-about/versions/v-about/besigner'

/** A finished build, as the panel last saw it on its message. */
const BUILD_JOB = {
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'build',
  status: 'done',
  brief: 'Pages and a contact form',
  batch: null,
  steps: [],
  outputs: [
    { resource: 'form', id: 'form-1', hostId: 'host-1', hostSubdomain: 'site-sub', label: 'Contact' },
    { resource: 'screen', id: 'scr-home', versionId: 'v-home', hostId: 'host-1', hostSubdomain: 'site-sub', label: 'Home' },
    { resource: 'screen', id: 'scr-about', versionId: 'v-about', hostId: 'host-1', hostSubdomain: 'site-sub', label: 'About' },
  ],
  creditsReserved: 0,
  creditsSpent: 40,
  createdBy: 'viewer',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  items: [],
}

const THREAD = [
  { role: 'user', text: 'Build me a few pages and a contact form' },
  {
    role: 'assistant',
    text: 'I will plan that.',
    build: { id: 'build', hostId: 'host-1', brief: 'Pages and a contact form', publish: false, summary: 'Plan pages' },
    buildJob: BUILD_JOB,
    buildNotice: null,
  },
]

const OPEN_ABOUT = {
  id: 'open.build.draft',
  label: 'Open “About” in the Besigner',
  outcome: 'the page “About” in the Besigner, where your request is asked again',
  href: '/acme/hosts/host-1/screens',
  values: [],
  prefill: false,
  draft: { ref: 'd2', label: 'About', noun: 'page' },
}

let proposal: unknown = OPEN_ABOUT

function chatStream(text: string, proposed: unknown) {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text })}\n\n`,
    `data: ${JSON.stringify({ type: 'done', exchangeId: 'exchange-1', docs: [], proposal: proposed })}\n\n`,
  ]
  const chunks = frames.map((frame) => new TextEncoder().encode(frame))
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
      }),
    },
  }
}

function dockProps() {
  return {
    orgId: 'org-1',
    org: { plan: 'pro' as const, billingStatus: 'active' as const },
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

async function ask(question: string): Promise<void> {
  fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
  fireEvent.change(await screen.findByPlaceholderText('How do I…'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
}

/** An open editor as the seam sees it; nothing here can save. */
const editor = (versionId: string) =>
  ({
    documentKind: 'screen',
    documentId: 'scr-about',
    versionId,
    isLiveVersion: () => false,
    selectedNodeId: () => null,
  }) as never

const chatPosts = () => posts.filter(([url]) => url === '/api/assist/chat')

beforeEach(() => {
  posts.length = 0
  proposal = OPEN_ABOUT
  route.pathname = '/acme/hosts/host-1/screens'
  sessionStorage.clear()
  sessionStorage.setItem('aglyn-assist:org-1', JSON.stringify(THREAD))
  resetAiJobsStoreForTests()
  resetEditorSessionsForTests()
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const path = String(url)
    if (path.startsWith('/api/ai/jobs')) return { ok: true, status: 200, json: async () => ({ jobs: [], job: BUILD_JOB }) }
    posts.push([path, JSON.parse(String(init?.body ?? '{}'))])
    if (path === '/api/assist/chat') {
      const turn = chatPosts().length
      return turn === 1 ? chatStream('I can open the About draft for that.', proposal) : chatStream('Here is a shorter version.', null)
    }
    throw new Error(`unarmed request to ${path}`)
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a follow-up on a draft the build made (AGL-3616)', () => {
  it('lists the build’s Besigner drafts by ref and label, never by id or address', async () => {
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the about page shorter')
    await waitFor(() => expect(chatPosts()).toHaveLength(1))
    const body = chatPosts()[0][1]
    expect(body['drafts']).toEqual([
      { ref: 'd1', label: 'Home', noun: 'page' },
      { ref: 'd2', label: 'About', noun: 'page' },
    ])
    expect(JSON.stringify(body['drafts'])).not.toMatch(/scr-|v-about|besigner/)
  })

  it('opens the named draft’s own Besigner, says the request is asked again there, and writes nothing on confirm', async () => {
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the about page shorter')
    const confirm = (await screen.findByText('Take me there')).closest('a')
    expect(confirm?.getAttribute('href')).toBe(ABOUT_HREF)
    expect(screen.getByText(/asks “Make the about page shorter” again there/)).toBeTruthy()
    expect(screen.queryByText(/fill the form in/)).toBeNull()
    const before = posts.length
    fireEvent.click(confirm as Element)
    expect(posts.length).toBe(before)
    expect(JSON.parse(sessionStorage.getItem('aglyn-assist-follow-up:org-1') ?? 'null')).toMatchObject({
      path: ABOUT_HREF,
      question: 'Make the about page shorter',
    })
  })

  it('asks the request again once the draft’s own canvas is open, and only then', async () => {
    const { rerender } = render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the about page shorter')
    fireEvent.click((await screen.findByText('Take me there')).closest('a') as Element)
    await waitFor(() => expect(chatPosts()).toHaveLength(1))

    // Arrived, but the editor holds another version: not yet.
    route.pathname = ABOUT_HREF
    act(() => {
      registerEditorSession(editor('v-other'))
    })
    rerender(<AssistPanelComponent {...dockProps()} />)
    expect(chatPosts()).toHaveLength(1)

    // The draft's own version opens: the request is asked once, from here.
    resetEditorSessionsForTests()
    act(() => {
      registerEditorSession(editor('v-about'))
    })
    rerender(<AssistPanelComponent {...dockProps()} />)
    await waitFor(() => expect(chatPosts()).toHaveLength(2))
    expect(chatPosts()[1][1]).toMatchObject({ question: 'Make the about page shorter' })
    expect(sessionStorage.getItem('aglyn-assist-follow-up:org-1')).toBeNull()
    expect(await screen.findByText('Here is a shorter version.')).toBeTruthy()
    rerender(<AssistPanelComponent {...dockProps()} />)
    expect(chatPosts()).toHaveLength(2)
  })

  it('drops a proposal naming a draft the panel does not hold', async () => {
    proposal = { ...OPEN_ABOUT, draft: { ref: 'd9', label: 'Ghost', noun: 'page' } }
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the ghost page shorter')
    await screen.findByText('I can open the About draft for that.')
    expect(screen.queryByText('Take me there')).toBeNull()
  })

  it('does not ask a follow-up kept past its time', async () => {
    sessionStorage.setItem(
      'aglyn-assist-follow-up:org-1',
      JSON.stringify({ path: ABOUT_HREF, question: 'Make it shorter', at: Date.now() - 10 * 60_000 }),
    )
    route.pathname = ABOUT_HREF
    registerEditorSession(editor('v-about'))
    render(<AssistPanelComponent {...dockProps()} />)
    await waitFor(() => expect(sessionStorage.getItem('aglyn-assist-follow-up:org-1')).toBeNull())
    expect(chatPosts()).toHaveLength(0)
  })
})

describe('assistThreadDraftLinks', () => {
  it('reads newest build first, only outputs that open in the Besigner on a version', () => {
    const older = { buildJob: { ...BUILD_JOB, outputs: [BUILD_JOB.outputs[1]] } }
    const newer = { buildJob: { ...BUILD_JOB, outputs: [BUILD_JOB.outputs[2], BUILD_JOB.outputs[0]] } }
    const links = assistThreadDraftLinks([older, { buildJob: null }, newer] as never, 'acme')
    expect(links.map(({ ref, label }) => [ref, label])).toEqual([
      ['d1', 'About'],
      ['d2', 'Home'],
    ])
    expect(links[0].href).toBe(ABOUT_HREF)
  })
})
