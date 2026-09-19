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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFirestore = {}
const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)
const mockFetch = jest.fn()
let mockUserDoc: Record<string, unknown> = {}

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as string}</a>,
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
}))
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_firestore: unknown, ...path: string[]) => path.join('/'),
  getDoc: async () => ({ get: (field: string) => mockUserDoc[field] }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

import type { AiInsightAnswerWire } from '../model/ai-insight'
import { AiInsightDialog, type AiInsightDialogProps } from './ai-insight-dialog.component'

/**
 * "Ask about your numbers" (AGL-2915): the answer shows each insight with the
 * rows it was traced to and a link to the page they come from, a question
 * starts an `insight` job for the page's surface, and the weekly-insights
 * switch writes nothing but the person's own document.
 */

const user = { uid: 'u1', getIdToken: async () => 'tok' }

const answer: AiInsightAnswerWire = {
  jobId: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  surface: 'analytics',
  createdBy: 'u1',
  question: 'Did our traffic go up?',
  days: 14,
  insights: [{ text: 'Page views rose 14.7% to 1,204.', cites: [{ table: 't1', rows: [0] }] }],
  gap: 'These figures do not say where visitors came from.',
  tables: [
    {
      ref: 't1',
      reader: 'traffic.summary',
      days: 14,
      scope: 'site',
      title: 'Traffic',
      source: { label: 'Analytics', path: 'analytics' },
      period: { from: '2026-09-03', to: '2026-09-16', days: 14 },
      columns: [
        { key: 'figure', label: 'Figure', kind: 'text' },
        { key: 'current', label: 'This window', kind: 'count' },
        { key: 'change', label: 'Change', kind: 'change' },
      ],
      rows: [{ figure: 'Page views', current: 1204, change: 14.7 }],
      omitted: 0,
      notes: [],
    },
  ],
  left: 1,
  week: null,
  createdAtMs: 0,
}

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const props = (patch: Partial<AiInsightDialogProps> = {}): AiInsightDialogProps => ({
  open: true,
  onClose: jest.fn(),
  orgId: 'org-1',
  orgSlug: 'acme',
  hostId: 'host-1',
  host: 'acme-roofing',
  surface: 'analytics',
  user,
  uid: 'u1',
  ...patch,
})

beforeEach(() => {
  mockUserDoc = {}
  mockSetDoc.mockClear()
  mockFetch.mockReset()
})

describe('an answer', () => {
  it('shows each insight, the rows it was traced to, and where they come from', async () => {
    mockFetch.mockResolvedValueOnce(json({ answer }))
    render(<AiInsightDialog {...props({ jobId: 'job-1' })} />)
    expect(await screen.findByText('Page views rose 14.7% to 1,204.')).toBeTruthy()
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/insights/job-1?orgId=org-1')
    expect(screen.getByText('These figures do not say where visitors came from.')).toBeTruthy()
    expect(screen.getByText(/1 insight was left out/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show the figures' }))
    expect(screen.getByText('Figure: Page views · This window: 1,204 · Change: +14.7%')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Analytics' }).getAttribute('href')).toBe(
      '/acme/hosts/acme-roofing/analytics',
    )
  })
})

describe('asking', () => {
  it('starts an insight job for the page’s surface and window, and says why when it cannot', async () => {
    mockFetch.mockResolvedValueOnce(json({ error: 'There are no figures to answer from here yet.' }, 403))
    render(<AiInsightDialog {...props()} />)
    fireEvent.change(screen.getByLabelText('What do you want to know?'), { target: { value: 'Which page grew?' } })
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('There are no figures to answer from here yet.')).toBeTruthy()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/ai/jobs')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'insight',
      brief: 'Which page grew?',
      inputs: { surface: 'analytics', days: 30 },
    })
  })

  it('turns weekly insights on for this workspace in the person’s own document', async () => {
    render(<AiInsightDialog {...props()} />)
    const toggle = await screen.findByLabelText(/weekly insights/)
    fireEvent.click(toggle)
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled())
    expect(mockSetDoc.mock.calls[0]).toEqual(['users/u1', { insightDigests: { 'org-1': true } }, { merge: true }])
  })
})
