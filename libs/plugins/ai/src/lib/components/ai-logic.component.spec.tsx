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
 * Logic by AI's widgets (AGL-3603), mounted through the logic plugin's zones'
 * props: each is drawn from the shell's gates alone and asks nothing until
 * it is used (AGL-3601); each sends a job and puts what it proposed in front of the
 * editor only through `propose`, when the person asks — writing nothing.
 */



import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import { AI_LOGIC_COPY, AiLogicCreateButton, AiLogicFixReference, AiLogicFunctionTools } from './ai-logic.component'
import { AI_UPSELL_COPY } from './ai-upsell-dialog.component'

const COPY = AI_LOGIC_COPY
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function sse(events: unknown[]) {
  const chunks = events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
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

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-7',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'logic',
    status: 'queued',
    brief: 'x',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 20,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-10-06T20:00:00.000Z',
    updatedAt: '2026-10-06T20:00:00.000Z',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  }
}

const DEFINITION = {
  name: 'shippingQuote',
  parameters: [{ name: 'order_total', type: 'number', required: true }],
  variables: [{ name: 'quote', type: 'number' }],
  operations: [{ if: { left: '1', comparator: '==', right: '1' }, then: [{ set: 'quote', expression: '5' }], otherwise: [] }],
  returnValue: 'quote',
}
const proposed = (functionId: string | null) =>
  job({
    status: 'done',
    outputs: [
      {
        resource: 'logic',
        id: functionId ?? 'function',
        hostId: 'host-1',
        hostSubdomain: 'shop',
        label: 'shippingQuote',
        proposal: { kind: 'function', functionId, definition: DEFINITION },
        note: 'Checked against the expression grammar and run once.',
      },
    ],
  })

function routes(events: () => unknown = () => sse([])) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/ai/jobs?')) return json({ jobs: [] })
    if (url === '/api/ai/jobs' && init?.method === 'POST') return json({ job: job() })
    if (url.startsWith('/api/ai/jobs/job-7/events?orgId=org-1')) return events()
    throw new Error(`unexpected ${url}`)
  })
}

const created = () =>
  mockFetch.mock.calls
    .filter(([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  mockFetch.mockReset()
})

afterEach(() => {
  // Only the jobs route: nothing here saves a function, a variable or an automation.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('Create with AI on the Functions card', () => {
  it('draws at once and asks nothing of a server until it is used (AGL-3601)', () => {
    render(<AiLogicCreateButton hostId="host-1" orgId="org-1" kind="function" propose={jest.fn()} />)
    expect(screen.getByRole('button', { name: COPY.create })).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('opens the AI add-on on a plan without it, and asks nothing', () => {
    render(
      <AiLogicCreateButton
        hostId="host-1"
        orgId="org-1"
        kind="function"
        propose={jest.fn()}
        entitled={false}
        upgrade={{ billingHref: '/acme/billing#addons', canManageBilling: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: COPY.create }))
    expect(screen.getByText(AI_UPSELL_COPY.logic.title)).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends a logic job for a function, and opens what it proposed in the editor only when asked', async () => {
    routes(() => sse([{ type: 'state', job: proposed(null) }]))
    const propose = jest.fn(() => true)
    render(<AiLogicCreateButton hostId="host-1" orgId="org-1" kind="function" propose={propose} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.create }))
    fireEvent.change(screen.getByLabelText(COPY.label.function), { target: { value: 'A shipping quote' } })
    fireEvent.click(screen.getByRole('button', { name: COPY.submit.function }))
    expect(await screen.findByText(`${COPY.ready}: shippingQuote`)).toBeTruthy()
    expect(created()).toEqual([
      { orgId: 'org-1', hostId: 'host-1', kind: 'logic', brief: 'A shipping quote', inputs: { mode: 'function' } },
    ])
    expect(propose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: COPY.open }))
    expect(propose).toHaveBeenCalledWith({ kind: 'function', functionId: null, definition: DEFINITION })
  })

  it('says so when the editor cannot open it', async () => {
    routes(() => sse([{ type: 'state', job: proposed(null) }]))
    render(<AiLogicCreateButton hostId="host-1" orgId="org-1" kind="variable" propose={() => false} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.create }))
    fireEvent.change(screen.getByLabelText(COPY.label.variable), { target: { value: 'Plan prices' } })
    fireEvent.click(screen.getByRole('button', { name: COPY.submit.variable }))
    fireEvent.click(await screen.findByRole('button', { name: COPY.open }))
    expect(screen.getByText(COPY.notOpened)).toBeTruthy()
    expect(created()[0].inputs).toEqual({ mode: 'variable' })
  })
})

describe('a saved function’s editor', () => {
  const TARGET = { id: 'fn-1', name: 'shippingQuote' }

  it('explains the function it is open on', async () => {
    routes(() =>
      sse([
        {
          type: 'state',
          job: job({
            status: 'done',
            outputs: [{ resource: 'text', id: 'explanation', hostId: 'host-1', label: 'How', text: 'It quotes shipping.' }],
          }),
        },
      ]),
    )
    render(<AiLogicFunctionTools hostId="host-1" orgId="org-1" target={TARGET} propose={jest.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.explain }))
    expect(await screen.findByText('It quotes shipping.')).toBeTruthy()
    expect(created()[0]).toEqual(
      expect.objectContaining({ kind: 'logic', inputs: { mode: 'explain', functionId: 'fn-1' } }),
    )
  })

  it('fixes the function as a change of it, and puts the change in the editor when asked', async () => {
    routes(() => sse([{ type: 'state', job: proposed('fn-1') }]))
    const propose = jest.fn(() => true)
    render(<AiLogicFunctionTools hostId="host-1" orgId="org-1" target={TARGET} propose={propose} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.fix }))
    fireEvent.click(await screen.findByRole('button', { name: COPY.replace }))
    expect(created()[0]).toEqual(
      expect.objectContaining({
        kind: 'logic',
        brief: COPY.fixBrief('shippingQuote'),
        inputs: { mode: 'function', functionId: 'fn-1' },
      }),
    )
    expect(propose).toHaveBeenCalledWith({ kind: 'function', functionId: 'fn-1', definition: DEFINITION })
  })
})

describe('Fix with AI on a broken reference', () => {
  const ISSUE = { source: 'action' as const, sourceId: 'act-1', sourceName: 'Welcome', refType: 'list', missing: 'Old list' }

  it('is offered only on a reference an automation holds, and drafts a changed copy of it', async () => {
    routes()
    const { container, unmount } = render(
      <AiLogicFixReference hostId="host-1" orgId="org-1" issue={{ ...ISSUE, source: 'variable' }} />,
    )
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
    unmount()
    render(<AiLogicFixReference hostId="host-1" orgId="org-1" issue={ISSUE} />)
    fireEvent.click(await screen.findByRole('button', { name: COPY.referenceFix }))
    await waitFor(() => expect(created()).toHaveLength(1))
    expect(created()[0]).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'workflow',
      brief: COPY.referenceBrief(ISSUE),
      inputs: { mode: 'revise', targetType: 'action', targetId: 'act-1' },
    })
  })
})
