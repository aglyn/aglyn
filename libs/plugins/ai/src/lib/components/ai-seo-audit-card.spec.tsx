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
 * The site SEO audit card (AGL-2910), mounted through the `hostSeo` zone's
 * props: it stays absent while the route says the feature does not exist,
 * reads back the site's last audit, stages the site-wide proposal in the SEO
 * form through `proposeDraft`, and applies the rest only through the apply
 * door — which opens drafts — linking to each draft it opened.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section aria-label={typeof header === 'string' ? header : undefined}>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

import type { ConsoleHostSeoZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiSeoAuditCard from './ai-seo-audit-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const finding = (code: string, severity: string, message: string) => ({ code, severity, message })

const audit = (patch: Record<string, unknown> = {}) => ({
  id: 'job-9',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'seo',
  status: 'done',
  brief: 'Audit the SEO of this site',
  inputs: { target: 'site' },
  steps: [],
  creditsReserved: 0,
  creditsSpent: 7,
  createdBy: 'u1',
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:03:00.000Z',
  error: null,
  running: false,
  applied: null,
  outputs: [
    {
      resource: 'seo',
      id: 'audit:report',
      hostId: 'host-1',
      label: 'SEO audit',
      proposal: {
        kind: 'audit',
        pages: [
          { screenId: 'lamps', path: '/lamps', name: 'Lamps', versionId: 'lv', score: 45, keywords: [], findings: [finding('title-missing', 'medium', 'No title.'), finding('image-alt-missing', 'medium', 'An image.')] },
          { screenId: 'about', path: '/about', name: 'About', versionId: 'av', score: 90, keywords: [], findings: [finding('description-missing', 'medium', 'No description.')] },
        ],
        skipped: 0,
        site: [finding('llms-guidance-missing', 'low', '/llms.txt carries no guidance of your own for AI agents.')],
        siteProposal: true,
        queue: ['lamps', 'about'],
        batchSize: 8,
        score: 68,
        notes: [],
      },
    },
    {
      resource: 'seo',
      id: 'audit:site',
      hostId: 'host-1',
      label: 'Structured data',
      proposal: {
        kind: 'site',
        site: {
          values: { 'seo.entity.type': '1', 'seo.agent.whenToUse': 'Questions about brass desk lamps.' },
          llmsPreview: '# Acme Lamps\n\nQuestions about brass desk lamps.\n',
          notes: [],
        },
      },
    },
    {
      resource: 'seo',
      id: 'audit:fixes:1',
      hostId: 'host-1',
      label: 'SEO fixes',
      proposal: {
        kind: 'fixes',
        batch: 1,
        fixes: [
          { screenId: 'lamps', values: { title: 'Brass desk lamps' }, content: [{ kind: 'image-alt', nodeId: 'limg', alt: 'A lamp' }], guidance: [] },
          { screenId: 'about', values: { description: 'Who makes the lamps.' }, content: [], guidance: [] },
        ],
        notes: [],
      },
    },
  ],
  ...patch,
})

let mockFetch: jest.Mock
const proposeDraft = jest.fn()

const props: ConsoleHostSeoZoneProps = {
  hostId: 'host-1',
  orgId: 'org-1',
  orgSlug: 'acme',
  host: 'shop',
  seo: {},
  proposeDraft,
}

beforeEach(() => {
  proposeDraft.mockReset()
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

it('stays absent while the route says the feature does not exist', async () => {
  mockFetch.mockResolvedValue(json({ error: 'Forbidden' }, 403))
  const { container } = render(<AiSeoAuditCard {...props} />)
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  expect(container.textContent).toBe('')
})

it('runs an audit with the keyword lines typed', async () => {
  mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
  render(<AiSeoAuditCard {...props} />)
  const button = await screen.findByRole('button', { name: 'Run audit' })
  fireEvent.change(screen.getByLabelText('Target keywords by page (optional)'), {
    target: { value: '/lamps: brass lamps' },
  })
  mockFetch.mockResolvedValueOnce(json({ job: audit() }))
  fireEvent.click(button)
  await screen.findByText('Score 68 of 100 · 2 pages · 4 findings')
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'seo',
    brief: 'Audit the SEO of this site',
    inputs: { target: 'site', keywords: '/lamps: brass lamps' },
  })
})

it('reads back the last audit: its pages, its findings, its fixes and what it cost', async () => {
  mockFetch.mockResolvedValueOnce(json({ jobs: [audit()] }))
  render(<AiSeoAuditCard {...props} />)
  const table = await screen.findByRole('table', { name: 'Audited pages' })
  // A page's findings wrap in their cell, so this stays a table — in a box
  // that scrolls sideways inside the card rather than past its edge (AGL-3045).
  expect(getComputedStyle(table.parentElement as HTMLElement).overflowX).toBe('auto')
  expect(within(table).getByText('/lamps')).toBeTruthy()
  expect(within(table).getByText('No search title')).toBeTruthy()
  expect(within(table).getByText('Title: Brass desk lamps · 1 image description')).toBeTruthy()
  expect(screen.getByText('This audit used 7 credits.')).toBeTruthy()
  expect(screen.getByText('An organization')).toBeTruthy()
})

it('stages the structured data and guidance in the form, and writes nothing', async () => {
  mockFetch.mockResolvedValueOnce(json({ jobs: [audit()] }))
  render(<AiSeoAuditCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Put in the form' }))
  expect(proposeDraft).toHaveBeenCalledWith(
    { 'seo.entity.type': '1', 'seo.agent.whenToUse': 'Questions about brass desk lamps.' },
    'job-9:site',
  )
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

it('applies all as drafts through the apply door, and links to each draft and listing', async () => {
  mockFetch.mockResolvedValueOnce(json({ jobs: [audit()] }))
  render(<AiSeoAuditCard {...props} />)
  const apply = await screen.findByRole('button', { name: 'Apply all as drafts' })
  mockFetch.mockResolvedValueOnce(
    json({
      job: audit({ applied: { at: '2026-09-15T12:05:00.000Z', by: 'u1', versions: { lamps: 'v2' }, staged: ['lamps', 'about'] } }),
      versions: [{ screenId: 'lamps', versionId: 'v2', name: 'Lamps', fixes: 1 }],
      staged: ['lamps', 'about'],
      skipped: [],
    }),
  )
  fireEvent.click(apply)
  const draft = await screen.findByText('Open the draft of Lamps')
  expect(draft.getAttribute('href')).toBe('/acme/hosts/shop/screens/lamps/versions/v2/besigner')
  expect(screen.getByText('Review the listing for About').getAttribute('href')).toBe(
    '/acme/hosts/shop/screens/about/versions/av/view',
  )
  const [url, init] = mockFetch.mock.calls[1]
  expect(url).toBe('/api/ai/seo/apply')
  expect(JSON.parse(init.body)).toEqual({ orgId: 'org-1', hostId: 'host-1', jobId: 'job-9' })
  expect(proposeDraft).toHaveBeenCalledWith(
    { 'seo.entity.type': '1', 'seo.agent.whenToUse': 'Questions about brass desk lamps.' },
    'job-9:site',
  )
})

it('does not apply an audit that is still proposing fixes', async () => {
  mockFetch.mockResolvedValueOnce(json({ jobs: [audit({ status: 'queued', outputs: audit().outputs.slice(0, 1) })] }))
  mockFetch.mockResolvedValue(json({ error: 'gone' }, 404))
  render(<AiSeoAuditCard {...props} />)
  const apply = await screen.findByRole('button', { name: 'Apply all as drafts' })
  expect((apply as HTMLButtonElement).disabled).toBe(true)
})
