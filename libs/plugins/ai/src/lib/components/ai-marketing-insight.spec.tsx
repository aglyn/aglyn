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
 * "Ask AI about these numbers" (AGL-3603), in the zone a marketing report
 * hosts: drawn only where the figures are one site's and the jobs route
 * serves the workspace, and it opens the insight dialog on the Marketing
 * surface with a question about what the report shows.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()
const mockDialog = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
  useConsoleHostRoute: (hostId: string | null) =>
    hostId ? { base: '/acme/hosts/shop', orgSlug: 'acme', subdomain: 'shop' } : { base: null, orgSlug: null, subdomain: null },
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))
jest.mock('./ai-insight-dialog.component', () => ({
  AiInsightDialog: (props: Record<string, unknown>) => {
    mockDialog(props)
    return props['open'] ? <div>{'insight dialog'}</div> : null
  },
}))

import { AiMarketingInsightButton, aiMarketingInsightQuestion } from './ai-marketing-insight.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  jest.clearAllMocks()
  forgetAiJobsVerdicts()
})

describe('Ask AI about these numbers', () => {
  it('opens the insight dialog on the Marketing surface for the report’s site, asking about the campaign', async () => {
    mockFetch.mockResolvedValue(json({ jobs: [] }))
    render(<AiMarketingInsightButton hostId="host-1" subject="campaign" campaign="Fall sale" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI about these numbers' }))
    expect(screen.getByText('insight dialog')).toBeTruthy()
    expect(mockDialog.mock.calls.at(-1)?.[0]).toMatchObject({
      open: true,
      orgId: 'org-1',
      orgSlug: 'acme',
      hostId: 'host-1',
      host: 'shop',
      surface: 'marketing',
      question: aiMarketingInsightQuestion('campaign', 'Fall sale'),
    })
    expect(aiMarketingInsightQuestion('campaign', 'Fall sale')).toContain('“Fall sale”')
  })

  it('stays absent where the figures name no site', async () => {
    mockFetch.mockResolvedValue(json({ jobs: [] }))
    const { container } = render(<AiMarketingInsightButton hostId={null} subject="conversions" campaign={null} />)
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stays absent while the jobs route refuses the workspace', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<AiMarketingInsightButton hostId="host-1" subject="conversions" campaign={null} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
