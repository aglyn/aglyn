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
 * AGL-4116, from a test site's chat: "make the image in the top of the home
 * page fill the entire background" came back as a second Home page, and each
 * follow-up to the plan made another plan.
 *
 * - A change to a page the site has starts ONE `edit` job on that page, with
 *   no plan, and the card links the draft it made in the Besigner.
 * - A further change to the same page starts from that draft.
 * - A new plan in the chat replaces the one still waiting to be confirmed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}

const posts: Array<[string, Record<string, unknown>]> = []
const aiPermissions = { loaded: true, use: true, generate: true }

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
  AppLink: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as string}</a>,
  MdiIcon: () => <span />,
}))
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/acme/hosts/site-sub',
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

import '../declarations'
import AssistPanelComponent, { ASSIST_BUILD_REPLACED_COPY } from './assist-panel.component'
import { resetAiJobsStoreForTests } from './ai-jobs-store'
import { resetAiUsageMetersForTests } from './use-ai-usage-meter'

const CHANGE = {
  id: 'page-change',
  hostId: 'host-1',
  pageId: 'scr-home',
  pageName: 'Home',
  brief: 'Make the image at the top fill the whole background of the top section.',
  summary: 'Make the top image fill the background on Home',
}

const BUILD = {
  id: 'build',
  hostId: 'host-1',
  brief: 'An about page and a contact form.',
  publish: false,
  summary: 'Plan an about page and a contact form',
}

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'edit',
  status: 'done',
  brief: CHANGE.brief,
  batch: null,
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 12,
  createdBy: 'viewer',
  createdAt: '2026-10-29T23:00:00.000Z',
  updatedAt: '2026-10-29T23:00:00.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  ...over,
})

const drafted = (versionId: string, id = 'job-edit') =>
  job({
    id,
    outputs: [
      {
        resource: 'screen',
        id: 'scr-home',
        versionId,
        hostId: 'host-1',
        hostSubdomain: 'site-sub',
        label: 'Home',
      },
    ],
  })

const planned = (id: string) =>
  job({
    id,
    kind: 'build',
    status: 'needs_review',
    brief: BUILD.brief,
    plan: {
      reuse: [],
      create: [],
      screens: [],
      items: [],
      status: 'proposed',
      labels: {},
      proposedAt: null,
      confirmedAt: null,
      confirmedBy: null,
    },
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
  })

function chatStream(done: Record<string, unknown>) {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text: 'I will make that change as a draft of Home.' })}\n\n`,
    `data: ${JSON.stringify({ type: 'done', exchangeId: 'exchange-1', docs: [], proposal: null, edit: null, build: null, pageChange: null, ...done })}\n\n`,
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

/** What the next chat turn proposes, and what the next job each door starts comes back as. */
let turns: Array<Record<string, unknown>> = []
let editJobs: Array<ReturnType<typeof job>> = []
let buildJobs: Array<ReturnType<typeof job>> = []

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
  if (!screen.queryByPlaceholderText('How do I…')) fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
  fireEvent.change(await screen.findByPlaceholderText('How do I…'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
}

const jobPosts = () => posts.filter(([url]) => url === '/api/ai/jobs').map(([, body]) => body)

beforeEach(() => {
  posts.length = 0
  turns = []
  editJobs = []
  buildJobs = []
  sessionStorage.clear()
  localStorage.clear()
  resetAiJobsStoreForTests()
  resetAiUsageMetersForTests()
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const path = String(url)
    if (path.startsWith('/api/ai/jobs?')) return { ok: true, status: 200, json: async () => ({ jobs: [] }) }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    posts.push([path, body])
    if (path === '/api/assist/chat') return chatStream(turns.shift() ?? {})
    if (path === '/api/ai/jobs') {
      const next = body['kind'] === 'edit' ? editJobs.shift() : buildJobs.shift()
      return { ok: true, status: 200, json: async () => ({ job: next }) }
    }
    const cancel = /^\/api\/ai\/jobs\/([^/]+)\/cancel$/.exec(path)
    if (cancel) {
      return { ok: true, status: 200, json: async () => ({ job: { ...planned(cancel[1]), status: 'canceled', review: null } }) }
    }
    throw new Error(`unarmed request to ${path}`)
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a change to a page the site has (AGL-4116)', () => {
  it('starts one edit job on that page, with no plan, and links the draft in the Besigner', async () => {
    turns = [{ pageChange: CHANGE }]
    editJobs = [drafted('v-draft-1')]
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the image in the top of the home page fill the entire background')
    expect(await screen.findByText('Your draft of Home is ready. Visitors see the page as it is until you publish the draft.')).toBeTruthy()
    expect(jobPosts()).toEqual([
      {
        orgId: 'org-1',
        hostId: 'host-1',
        kind: 'edit',
        brief: CHANGE.brief,
        inputs: { target: 'scr-home', targetKind: 'screen' },
      },
    ])
    const open = screen.getByText('Open in the Besigner').closest('a')
    expect(open?.getAttribute('href')).toBe('/acme/hosts/site-sub/screens/scr-home/versions/v-draft-1/besigner')
    expect(screen.queryByRole('button', { name: 'Confirm plan' })).toBeNull()
  })

  it('starts a further change to the same page from the draft the first one made', async () => {
    turns = [{ pageChange: CHANGE }, { pageChange: { ...CHANGE, brief: 'Darken the image a little.' } }]
    editJobs = [drafted('v-draft-1'), drafted('v-draft-2', 'job-edit-2')]
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the image in the top of the home page fill the entire background')
    await screen.findByText('Open in the Besigner')
    await ask('Darken it a little')
    await waitFor(() => expect(jobPosts()).toHaveLength(2))
    expect(jobPosts()[1]).toMatchObject({
      kind: 'edit',
      inputs: { target: 'scr-home', targetKind: 'screen', versionId: 'v-draft-1' },
    })
  })

  it('says why a change failed, and Try again starts it again', async () => {
    turns = [{ pageChange: CHANGE }]
    editJobs = [
      job({ id: 'job-failed', status: 'failed', error: 'No change could be made from that request.' }),
      drafted('v-draft-1'),
    ]
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Make the image in the top of the home page fill the entire background')
    expect(await screen.findByText('No change could be made from that request.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Open in the Besigner')).toBeTruthy()
    expect(jobPosts()).toHaveLength(2)
    expect(jobPosts()[1]).toMatchObject({ kind: 'edit', inputs: { target: 'scr-home', targetKind: 'screen' } })
  })
})

describe('one plan per conversation (AGL-4116)', () => {
  it('a new plan replaces the one still waiting: its job is canceled and its card gives way', async () => {
    turns = [{ build: BUILD }, { build: { ...BUILD, brief: 'An about page only.' } }]
    buildJobs = [planned('job-plan-1'), planned('job-plan-2')]
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Add an about page and a contact form')
    await screen.findByRole('button', { name: 'Confirm plan' })
    await ask('Leave out the contact form')
    await waitFor(() => expect(posts.some(([url]) => url === '/api/ai/jobs/job-plan-1/cancel')).toBe(true))
    expect(await screen.findByText(ASSIST_BUILD_REPLACED_COPY)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Confirm plan' })).toHaveLength(1))
  })
})
