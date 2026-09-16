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
 * "Describe it" on a site's Screens page (AGL-2907), mounted through the
 * `hostScreens` zone's props: it stays absent while the jobs route says the
 * feature is not this workspace's, the brief it sends is a `page` job for
 * this site with the chip the member pressed, and what it promises after is
 * a plan to confirm — never a built page, and never a published one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// ONE held object for the whole file: a fresh double each render turns the
// probe's effect into a loop, and an effect keys on the uid rather than on
// the object that carries it.
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

import type { ConsoleHostScreensZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import AiDescribePageButton from './ai-describe-page.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const zoneProps = (
  patch: Partial<ConsoleHostScreensZoneProps> = {},
): ConsoleHostScreensZoneProps => ({ hostId: 'host-1', orgId: 'org-1', ...patch })

let mockFetch: jest.Mock

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  // The whole flow is the jobs route. No screen is created here, and no
  // publish door is reached from a control that offers a draft.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

describe('whether the button is here at all', () => {
  it.each([
    ['the route is not registered for this deployment', 404],
    ['the member may not generate', 403],
  ])('stays absent when %s', async (_why, status) => {
    mockFetch.mockResolvedValue(json({ error: 'No' }, status))
    const { container } = render(<AiDescribePageButton {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('stays absent while the probe is still out, and asks the route only once', async () => {
    mockFetch.mockReturnValue(new Promise(() => undefined))
    const { container, rerender } = render(<AiDescribePageButton {...zoneProps()} />)
    rerender(<AiDescribePageButton {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe('')
  })

  it('asks nothing while the page has not resolved its org', async () => {
    render(<AiDescribePageButton {...zoneProps({ orgId: undefined })} />)
    await waitFor(() => expect(mockFetch).not.toHaveBeenCalled())
  })
})

describe('the brief it sends', () => {
  it('starts a page job for this site with the page type the member pressed', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiDescribePageButton {...zoneProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
    fireEvent.change(screen.getByLabelText('What is the page for?'), {
      target: { value: '  A landing page for our spring roof inspection offer  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }))

    mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-1', kind: 'page', status: 'running' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan the page' }))

    await screen.findByText(/The page is being planned/)
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('/api/ai/jobs')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'page',
      brief: 'A landing page for our spring roof inspection offer',
      inputs: { pageType: 'pricing' },
    })
    // What it promises is a plan and an unpublished draft, in those words.
    expect(screen.getByText(/confirm it/)).toBeTruthy()
    expect(screen.getByText(/unpublished draft/)).toBeTruthy()
  })

  it('sends no page type when the member pressed none, and none once it is pressed off', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiDescribePageButton {...zoneProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
    fireEvent.change(screen.getByLabelText('What is the page for?'), {
      target: { value: 'An about page' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    fireEvent.click(screen.getByRole('button', { name: 'About' }))

    mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-2', kind: 'page', status: 'running' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan the page' }))

    await screen.findByText(/The page is being planned/)
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).inputs).toEqual({})
  })

  it('says why the route refused, and leaves the brief to try again', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiDescribePageButton {...zoneProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
    fireEvent.change(screen.getByLabelText('What is the page for?'), {
      target: { value: 'A contact page' },
    })
    mockFetch.mockResolvedValueOnce(json({ error: 'Your AI credits are used up' }, 402))
    fireEvent.click(screen.getByRole('button', { name: 'Plan the page' }))

    await screen.findByText('Your AI credits are used up')
    expect((screen.getByLabelText('What is the page for?') as HTMLTextAreaElement).value).toBe(
      'A contact page',
    )
  })

  it('will not send an empty brief', async () => {
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<AiDescribePageButton {...zoneProps()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
    fireEvent.change(screen.getByLabelText('What is the page for?'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Plan the page' }).hasAttribute('disabled')).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
