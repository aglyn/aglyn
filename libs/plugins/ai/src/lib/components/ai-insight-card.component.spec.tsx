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
 * "Ask AI about these numbers" (AGL-3603): absent until the jobs route says
 * the feature is this workspace's; on a site it opens the insight dialog on
 * the Analytics surface for that site, and on the workspace's sites page on
 * the workspace surface with no site.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()
const mockDialog = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'tok' } }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
  useConsoleHostRoute: () => ({ base: '/acme/hosts/shop', orgSlug: 'acme', subdomain: 'shop' }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))
jest.mock('./ai-insight-dialog.component', () => ({
  __esModule: true,
  AiInsightDialog: (props: Record<string, unknown>) => {
    mockDialog(props)
    return null
  },
}))

import { AI_INSIGHT_CARD_COPY, AiInsightHostCard, AiInsightOrgCard } from './ai-insight-card.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  mockFetch.mockReset()
  mockDialog.mockReset()
  forgetAiJobsVerdicts()
})

describe('Ask AI about these numbers', () => {
  it('stays absent when the feature is not this workspace’s', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<AiInsightHostCard hostId="host-1" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('asks about one site on its Analytics surface', async () => {
    mockFetch.mockResolvedValue(json({ jobs: [] }))
    render(<AiInsightHostCard hostId="host-1" />)
    fireEvent.click(await screen.findByRole('button', { name: AI_INSIGHT_CARD_COPY.action }))
    expect(mockDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ orgId: 'org-1', orgSlug: 'acme', hostId: 'host-1', host: 'shop', surface: 'analytics' }),
    )
  })

  it('asks about the workspace, with no site, on its sites page', async () => {
    mockFetch.mockResolvedValue(json({ jobs: [] }))
    render(<AiInsightOrgCard orgMount={{ orgId: 'org-1', orgSlug: 'acme' } as never} />)
    fireEvent.click(await screen.findByRole('button', { name: AI_INSIGHT_CARD_COPY.action }))
    expect(mockDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ orgId: 'org-1', hostId: null, host: null, surface: 'workspace' }),
    )
  })
})
