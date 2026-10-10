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
 * AGL-3616: one request in the chat → one plan card → confirm → one build
 * job. A turn that proposes a build starts exactly one `build` job through
 * the job door, shows that job's plan card in place, and confirms through
 * the same resume door the AI jobs drawer uses. A stored thread never starts
 * a build again.
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
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/acme/hosts/host-1/screens' }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

import '../declarations'
import AssistPanelComponent from './assist-panel.component'
import { resetAiJobsStoreForTests } from './ai-jobs-store'

const BUILD = {
  id: 'build',
  hostId: 'host-1',
  brief: 'Three pages, a contact form and an about page.',
  publish: false,
  summary: 'Plan three pages and a contact form',
}

const PLAN = {
  reuse: [],
  create: [{ kind: 'form', name: 'Contact', why: 'People write in.', duplicateOf: null, fields: ['email'] }],
  screens: [
    {
      title: 'About',
      slug: '/about',
      layout: null,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About',
      seoDescription: 'About us',
      sections: [{ name: 'story', uses: [], items: 0 }],
      record: null,
    },
  ],
  items: [],
  status: 'proposed',
  labels: {},
  proposedAt: null,
  confirmedAt: null,
  confirmedBy: null,
}

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'build',
  status: 'needs_review',
  brief: BUILD.brief,
  batch: null,
  steps: [],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 2,
  createdBy: 'viewer',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  error: null,
  running: false,
  plan: PLAN,
  review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
  ...over,
})

function chatStream(build: unknown) {
  const frames = [
    `data: ${JSON.stringify({ type: 'delta', text: 'I will plan that.' })}\n\n`,
    `data: ${JSON.stringify({ type: 'done', exchangeId: 'exchange-1', docs: [], proposal: null, edit: null, build })}\n\n`,
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

let chatBuild: unknown = BUILD

function dockProps() {
  return {
    orgId: 'org-1',
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

async function ask(question: string): Promise<void> {
  fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
  fireEvent.change(await screen.findByPlaceholderText('How do I…'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
}

const jobPosts = () => posts.filter(([url]) => url === '/api/ai/jobs')

beforeEach(() => {
  posts.length = 0
  chatBuild = BUILD
  sessionStorage.clear()
  resetAiJobsStoreForTests()
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const path = String(url)
    if (path.startsWith('/api/ai/jobs?')) return { ok: true, status: 200, json: async () => ({ jobs: [] }) }
    posts.push([path, JSON.parse(String(init?.body ?? '{}'))])
    if (path === '/api/assist/chat') return chatStream(chatBuild)
    if (path === '/api/ai/jobs') return { ok: true, status: 200, json: async () => ({ job: job() }) }
    if (path === '/api/ai/jobs/job-1/resume') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          job: job({
            status: 'done',
            review: null,
            plan: { ...PLAN, status: 'confirmed' },
            items: [
              { slot: 'c0', op: 'form', label: 'Contact', status: 'succeeded', attempt: 1, creditsSpent: 3, creditsRefunded: 0, outputs: ['f'] },
              {
                slot: 'p0',
                op: 'page',
                label: 'About',
                status: 'failed',
                attempt: 1,
                creditsSpent: 4,
                creditsRefunded: 4,
                outputs: [],
                failure: { ours: true, reason: 'step-failure', message: 'It could not be built this time.' },
              },
            ],
          }),
        }),
      }
    }
    throw new Error(`unarmed request to ${path}`)
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a build asked in the chat (AGL-3616)', () => {
  it('starts one build job on the proposal’s site and shows its plan card in place', async () => {
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Create a few new pages and a contact form, then an about page')
    expect(await screen.findByRole('button', { name: 'Confirm plan' })).toBeTruthy()
    expect(jobPosts()).toEqual([
      ['/api/ai/jobs', { orgId: 'org-1', hostId: 'host-1', kind: 'build', brief: BUILD.brief, inputs: {} }],
    ])
    expect(screen.getByText('Plan three pages and a contact form')).toBeTruthy()
  })

  it('confirms through the resume door, then shows each item and what a failure on our side gave back', async () => {
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('Create a few new pages and a contact form, then an about page')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm plan' }))
    await waitFor(() => expect(posts.some(([url]) => url === '/api/ai/jobs/job-1/resume')).toBe(true))
    expect(await screen.findByText(/Page: About — failed/)).toBeTruthy()
    expect(screen.getByText(/you weren’t charged/)).toBeTruthy()
    // Try again says what it is likely to cost, and at most (AGL-3722).
    expect(screen.getByRole('button', { name: /^Try again what failed · About \d+ credits \(up to \d+\)$/ })).toBeTruthy()
  })

  it('a turn that proposed nothing starts no job', async () => {
    chatBuild = null
    render(<AssistPanelComponent {...dockProps()} />)
    await ask('How do I add a page?')
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(jobPosts()).toEqual([])
  })

  it('a stored build whose job never came back is not started again', async () => {
    sessionStorage.setItem(
      'aglyn-assist:org-1',
      JSON.stringify([
        { role: 'user', text: 'Build it' },
        { role: 'assistant', text: 'I will plan that.', build: BUILD },
      ]),
    )
    render(<AssistPanelComponent {...dockProps()} />)
    fireEvent.click(screen.getByLabelText('Open Aglyn Assist'))
    expect(await screen.findByText('This build was not started. Ask again to plan it.')).toBeTruthy()
    expect(jobPosts()).toEqual([])
  })
})
