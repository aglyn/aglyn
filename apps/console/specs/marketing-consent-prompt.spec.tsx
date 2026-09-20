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
 * The one-time product-updates prompt (AGL-3185): shown only when the server
 * says it is due, and every control on it sends exactly one thing — a grant,
 * a refusal, or a dismissal that is neither.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PLATFORM_MARKETING_CONSENT_TEXT_VERSION } from '@aglyn/aglyn/app-utils/platform-marketing-consent'

const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))

let mockUser: { uid: string; getIdToken: () => Promise<string> } | null = null
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

const { MarketingConsentPrompt } = require('../components/marketing-consent-prompt.component')

/** What the status route answers; swapped per test. */
let mockStatus: Record<string, unknown> | null = null
const postedBodies: Array<Record<string, unknown>> = []

beforeEach(() => {
  mockEnqueue.mockClear()
  postedBodies.length = 0
  mockUser = { uid: 'u-1', getIdToken: async () => 'token-1' }
  mockStatus = {
    decision: null,
    atMs: null,
    textVersion: null,
    sourceKind: null,
    promptDismissedAtMs: null,
    promptDue: true,
    currentTextVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  }
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/auth/marketing-consent') throw new Error(`unexpected ${url}`)
    if (init?.method === 'POST') {
      postedBodies.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => ({ ok: true }), text: async () => '' }
    }
    if (!mockStatus) return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    return { ok: true, json: async () => mockStatus, text: async () => '' }
  }) as unknown as typeof fetch
})

const renderPrompt = async () => {
  await act(async () => {
    render(<MarketingConsentPrompt />)
  })
}

describe('MarketingConsentPrompt', () => {
  it('asks when the server says the prompt is due', async () => {
    await renderPrompt()
    expect(await screen.findByText(/Want product updates from/)).toBeTruthy()
    // The versioned wording is what they are answering.
    expect(screen.getByText(/You can opt out any time/)).toBeTruthy()
  })

  it('shows nothing when the server says it is not due', async () => {
    mockStatus = { ...mockStatus, decision: 'declined', promptDue: false }
    await renderPrompt()
    expect(screen.queryByText(/Want product updates from/)).toBeNull()
  })

  it('shows nothing when the status could not be read — an unread record is not an empty one', async () => {
    mockStatus = null
    await renderPrompt()
    expect(screen.queryByText(/Want product updates from/)).toBeNull()
  })

  it('shows nothing to a signed-out reader and sends nothing', async () => {
    mockUser = null
    await renderPrompt()
    expect(screen.queryByText(/Want product updates from/)).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('"Yes" records a grant from the prompt door, then goes away', async () => {
    await renderPrompt()
    await screen.findByText(/Want product updates from/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, send them' }))
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual({
      decision: 'granted',
      source: 'console-prompt',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    await waitFor(() =>
      expect(screen.queryByText(/Want product updates from/)).toBeNull(),
    )
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.stringMatching(/product updates/),
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('"No thanks" records a refusal — an answer, never a dismissal', async () => {
    await renderPrompt()
    await screen.findByText(/Want product updates from/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual({
      decision: 'declined',
      source: 'console-prompt',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    await waitFor(() =>
      expect(screen.queryByText(/Want product updates from/)).toBeNull(),
    )
  })

  it('closing the card records a dismissal and no decision', async () => {
    await renderPrompt()
    await screen.findByText(/Want product updates from/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    })
    await waitFor(() => expect(postedBodies).toHaveLength(1))
    expect(postedBodies[0]).toEqual(
      expect.objectContaining({ decision: 'dismissed', source: 'console-prompt' }),
    )
    await waitFor(() =>
      expect(screen.queryByText(/Want product updates from/)).toBeNull(),
    )
  })

  it('keeps asking when the answer could not be saved', async () => {
    ;(globalThis.fetch as jest.Mock).mockImplementation(
      async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
          : { ok: true, json: async () => mockStatus, text: async () => '' },
    )
    await renderPrompt()
    await screen.findByText(/Want product updates from/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, send them' }))
    })
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.stringMatching(/could not be saved/),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(screen.getByText(/Want product updates from/)).toBeTruthy()
  })
})
