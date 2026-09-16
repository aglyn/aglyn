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
 * The usage strip and the model switch (AGL-2942), mounted.
 *
 * THE STRIP READS NOTHING. Every case records the network and asserts the
 * strip never touched it: the figures arrive in the envelope a door's answer
 * carried, and a strip that fetched its own would be a read on every panel
 * mount of every console page. The switch reads its options only when it is
 * opened, for the same reason.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiUsageMeterWire } from '../usage/ai-usage-wire'

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
// ONE held user: a fresh object per render would re-key every effect.
const mockUser = { uid: 'reader-1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as string}</a>
  ),
}))

import { AiModelSelector } from './ai-model-selector.component'
import { AiUsageStrip } from './ai-usage-strip.component'
import { resetAiModelOptionReadsForTests, useAiModelChoice } from './use-ai-model-choice'
import { publishAiUsageMeter, resetAiUsageMetersForTests } from './use-ai-usage-meter'

const thisMonth = () => new Date().toISOString().slice(0, 7)

const meter = (overrides: Partial<AiUsageMeterWire> = {}): AiUsageMeterWire => ({
  month: thisMonth(),
  pool: { used: 400, limit: 10_000 },
  mine: { used: 120, limit: null, mode: null, scope: null },
  last: 14,
  refused: false,
  state: 'ok',
  model: { id: 'model-b', label: 'Model B', auto: true },
  ...overrides,
})

beforeEach(() => {
  resetAiUsageMetersForTests()
  resetAiModelOptionReadsForTests()
  mockFetch.mockReset()
  localStorage.clear()
})

describe('the usage strip', () => {
  it('renders nothing until a door has answered, and never reads to find out', () => {
    render(<AiUsageStrip orgId="org-1" />)
    expect(screen.queryByTestId('ai-usage-strip')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('updates every strip for the reader and the workspace from the envelope a door published', () => {
    render(
      <>
        <AiUsageStrip orgId="org-1" />
        <AiUsageStrip orgId="org-1" />
      </>,
    )
    act(() => publishAiUsageMeter('reader-1', 'org-1', meter()))
    expect(screen.getAllByText('You: 120 credits this month')).toHaveLength(2)
    expect(screen.getAllByText(/Workspace: 400 of 10,000 credits/)).toHaveLength(2)
    expect(screen.getAllByText('Last request: 14 credits')).toHaveLength(2)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('keeps one workspace’s envelope out of another’s strip', () => {
    render(<AiUsageStrip orgId="org-2" />)
    act(() => publishAiUsageMeter('reader-1', 'org-1', meter()))
    expect(screen.queryByTestId('ai-usage-strip')).toBeNull()
  })

  it('measures against the allotment that binds, and warns from 80%', () => {
    render(<AiUsageStrip orgId="org-1" />)
    act(() =>
      publishAiUsageMeter(
        'reader-1',
        'org-1',
        meter({ mine: { used: 850, limit: 1000, mode: 'soft', scope: 'member' }, state: 'warn' }),
      ),
    )
    expect(screen.getByText('You: 850 of 1,000 credits this month')).toBeTruthy()
    expect(screen.getByText(/Past 80% of your AI allotment\. It is soft/)).toBeTruthy()
  })

  it('names a site’s allotment as the site’s', () => {
    render(<AiUsageStrip orgId="org-1" />)
    act(() =>
      publishAiUsageMeter(
        'reader-1',
        'org-1',
        meter({ mine: { used: 4000, limit: 5000, mode: 'hard', scope: 'host' } }),
      ),
    )
    expect(screen.getByText('This site: 4,000 of 5,000 credits this month')).toBeTruthy()
  })

  it('at a hard allotment, explains and links to where it can be raised', () => {
    render(<AiUsageStrip orgId="org-1" orgSlug="acme" />)
    act(() =>
      publishAiUsageMeter(
        'reader-1',
        'org-1',
        meter({
          mine: { used: 1000, limit: 1000, mode: 'hard', scope: 'member' },
          refused: true,
          state: 'capped',
          last: null,
        }),
      ),
    )
    expect(screen.getByText(/Your AI allotment is used for the month/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Billing → Usage' }).getAttribute('href')).toBe(
      '/acme/billing/usage#ai-allotments',
    )
  })

  it('points a collaborator at the site’s admin, with no Billing link they cannot open', () => {
    render(<AiUsageStrip orgId="org-1" orgSlug="acme" />)
    act(() =>
      publishAiUsageMeter(
        'reader-1',
        'org-1',
        meter({
          mine: { used: 300, limit: 300, mode: 'hard', scope: 'collab' },
          refused: true,
          state: 'capped',
        }),
      ),
    )
    expect(screen.getByText(/The site’s admin, or an organization admin, can raise it/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('comes back after a reload from this month’s last envelope, and drops one from another month', () => {
    publishAiUsageMeter('reader-1', 'org-1', meter())
    // A reload: the module's store is empty and the browser kept the envelope.
    resetAiUsageMetersForTests()
    const { unmount } = render(<AiUsageStrip orgId="org-1" />)
    expect(screen.getByTestId('ai-usage-strip')).toBeTruthy()
    unmount()
    localStorage.setItem('aglyn-ai-meter:reader-1:org-1', JSON.stringify(meter({ month: '2000-01' })))
    resetAiUsageMetersForTests()
    render(<AiUsageStrip orgId="org-1" />)
    expect(screen.queryByTestId('ai-usage-strip')).toBeNull()
  })

  it('ignores something that is not an envelope', () => {
    render(<AiUsageStrip orgId="org-1" />)
    act(() => publishAiUsageMeter('reader-1', 'org-1', { pool: {}, error: 'nope' }))
    expect(screen.queryByTestId('ai-usage-strip')).toBeNull()
  })
})

describe('the model switch', () => {
  function Harness({ surface = 'assist' }: { surface?: 'assist' | 'copy' }) {
    const choice = useAiModelChoice({ orgId: 'org-1', surface, kind: 'assist.chat' })
    return (
      <>
        <AiModelSelector choice={choice} />
        <output data-testid={`model-${surface}`}>{choice.model ?? 'auto'}</output>
      </>
    )
  }

  const options = {
    kind: 'assist.chat',
    auto: {
      id: 'auto',
      label: 'Auto (Model B)',
      tier: 'balanced',
      creditsPerRequest: 12,
      multiplier: 1,
      model: 'model-b',
    },
    options: [
      { id: 'model-a', label: 'Model A', tier: 'fast', creditsPerRequest: 4, multiplier: 0.3 },
      { id: 'model-b', label: 'Model B', tier: 'balanced', creditsPerRequest: 12, multiplier: 1 },
    ],
    measured: true,
  }
  const respond = (body: unknown, status = 200) =>
    mockFetch.mockResolvedValue({ ok: status < 400, status, json: async () => body })

  it('reads its options only when opened, and lists Auto with each option’s price', async () => {
    respond(options)
    render(<Harness />)
    expect(mockFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'AI model: Auto' }))
    expect(await screen.findByText('Auto (Model B)')).toBeTruthy()
    expect(screen.getByText('≈ 4 credits a request · 0.3× Auto')).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]).toBe('/api/ai/models?orgId=org-1&kind=assist.chat')
  })

  it('remembers a pick per person per surface', async () => {
    respond(options)
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'AI model: Auto' }))
    fireEvent.click(await screen.findByText('Model A'))
    expect(screen.getByTestId('model-assist').textContent).toBe('model-a')
    unmount()
    render(
      <>
        <Harness />
        <Harness surface="copy" />
      </>,
    )
    expect(screen.getByTestId('model-assist').textContent).toBe('model-a')
    expect(screen.getByTestId('model-copy').textContent).toBe('auto')
  })

  it('a remembered pick the server no longer lists is Auto again', async () => {
    localStorage.setItem(
      'aglyn-ai-model:reader-1:org-1:assist',
      JSON.stringify({ id: 'model-gone', label: 'Gone' }),
    )
    respond(options)
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('model-assist').textContent).toBe('model-gone'))
    fireEvent.click(screen.getByRole('button', { name: 'AI model: Gone' }))
    await waitFor(() => expect(screen.getByTestId('model-assist').textContent).toBe('auto'))
  })
})
