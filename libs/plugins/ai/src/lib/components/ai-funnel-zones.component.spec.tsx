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

let mockVerdict = 'ready'
let mockDialogProps: Record<string, unknown> | null = null

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'u1' } }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({ MdiIcon: () => null }))
jest.mock('next/navigation', () => ({ usePathname: () => '/acme/hosts/shop/analytics' }))
jest.mock('./use-ai-job-run', () => ({ useAiJobsVerdict: () => mockVerdict }))
jest.mock('./ai-insight-dialog.component', () => ({
  AiInsightDialog: (props: Record<string, unknown>) => {
    mockDialogProps = props
    return null
  },
}))

import { AI_FUNNEL_COPY, AiFunnelAskButton, AiFunnelCreateButton, aiFunnelQuestion } from './ai-funnel-zones.component'

beforeEach(() => {
  mockVerdict = 'ready'
  mockDialogProps = null
})

describe('funnels by AI (AGL-3605)', () => {
  it('renders nothing until the jobs route says AI is the workspace’s', () => {
    mockVerdict = 'checking'
    const { container } = render(<AiFunnelCreateButton hostId="h1" orgId="o1" propose={jest.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('hands the description to the card and closes on a draft', async () => {
    const propose = jest.fn().mockResolvedValue(null)
    render(<AiFunnelCreateButton hostId="h1" orgId="o1" propose={propose} />)
    fireEvent.click(screen.getByText(AI_FUNNEL_COPY.create))
    fireEvent.change(screen.getByLabelText(AI_FUNNEL_COPY.label), { target: { value: '  blog then book  ' } })
    fireEvent.click(screen.getByText(AI_FUNNEL_COPY.submit))
    await waitFor(() => expect(propose).toHaveBeenCalledWith('blog then book'))
    await waitFor(() => expect(screen.queryByText(AI_FUNNEL_COPY.title)).toBeNull())
  })

  it('shows why there is no draft', async () => {
    render(<AiFunnelCreateButton hostId="h1" orgId="o1" propose={jest.fn().mockResolvedValue('Out of credits')} />)
    fireEvent.click(screen.getByText(AI_FUNNEL_COPY.create))
    fireEvent.change(screen.getByLabelText(AI_FUNNEL_COPY.label), { target: { value: 'x' } })
    fireEvent.click(screen.getByText(AI_FUNNEL_COPY.submit))
    expect(await screen.findByText('Out of credits')).toBeTruthy()
  })

  it('opens the insight dialog on the Analytics surface with a question about the funnel', () => {
    render(<AiFunnelAskButton hostId="h1" orgId="o1" funnelName="Pricing to contact" days={30} />)
    fireEvent.click(screen.getByText(AI_FUNNEL_COPY.ask))
    expect(mockDialogProps).toMatchObject({
      open: true,
      surface: 'analytics',
      orgId: 'o1',
      orgSlug: 'acme',
      hostId: 'h1',
      host: 'shop',
      initialQuestion: aiFunnelQuestion('Pricing to contact', 30),
    })
    expect(aiFunnelQuestion('Pricing to contact', 30)).toContain('"Pricing to contact" over the last 30 days')
  })
})
