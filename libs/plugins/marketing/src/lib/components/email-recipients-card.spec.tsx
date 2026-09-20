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
 * WHO an email reached, as a record list in the shared grid (AGL-3045).
 *
 * The grid scrolls its own columns inside the card, where a long address or a
 * followed link used to run past the card's edge. What the grid has to keep
 * from the table it replaced: the links a recipient followed ride beneath the
 * address, the Email column appears only where more than one email is being
 * read, and the pager under the grid turns the route's cursor.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  pluginDocsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))

/** Held, so the card's read is keyed on one reader. */
const mockUser = { uid: 'editor-1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

/** What each request asked for, and the cursor the route hands back. */
const mockBodies: Array<Record<string, unknown>> = []
let mockCursor: string | null = null
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async (_user: unknown, _path: string, init: { body: string }) => {
    mockBodies.push(JSON.parse(init.body))
    return {
      ok: true,
      json: async () => ({
        rows: [
          {
            messageId: 'msg-1',
            to: 'ada@example.com',
            subject: 'Spring sale',
            campaignId: 'cmp-1',
            status: 'delivered',
            openCount: 3,
            clickCount: 2,
            clickedLinks: ['https://shop.example.com/sale', 'https://shop.example.com/lamps'],
            firstSeenAtMs: 1,
            lastEventAtMs: 2,
          },
        ],
        cursor: mockCursor,
      }),
    }
  },
}))

import { EmailRecipientsCard } from './email-recipients-card'

const mount = async (props: { screenId?: string; emailId?: string }) => {
  render(<EmailRecipientsCard hostId="host-1" {...props} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  mockBodies.length = 0
  mockCursor = null
})

describe('EmailRecipientsCard (AGL-3045)', () => {
  it('lists the recipients in the shared grid, with the links each one followed', async () => {
    const { container } = render(<EmailRecipientsCard hostId="host-1" screenId="scr-1" />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const grid = screen.getByRole('grid', { name: 'Recipients' })
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const row = within(grid).getByText('ada@example.com').closest('[role="row"]') as HTMLElement
    expect(within(row).getByText('https://shop.example.com/sale')).toBeTruthy()
    expect(within(row).getByText('https://shop.example.com/lamps')).toBeTruthy()
    // A template's recipients span its emails, so each row names its email.
    expect(within(row).getByText('Spring sale')).toBeTruthy()
  })

  it('drops the Email column when one email is being read', async () => {
    await mount({ emailId: 'msg-1' })
    const headers = within(screen.getByRole('grid', { name: 'Recipients' }))
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    // Positive control: the grid's own headers are read.
    expect(headers).toContain('Recipient')
    expect(headers).not.toContain('Email')
  })

  it('turns the route’s cursor with the pager under the grid', async () => {
    mockCursor = 'cursor-2'
    await mount({ screenId: 'scr-1' })
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockBodies.map((body) => body['cursor'])).toEqual([null, 'cursor-2'])
  })
})
