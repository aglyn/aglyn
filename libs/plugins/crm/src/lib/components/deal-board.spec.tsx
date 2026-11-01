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
 * A BOARD WIDER THAN ITS CARD.
 *
 * With Salesforce's ten stages the columns holding deals sat past the right
 * edge, and nothing on screen said so. Empty stages now fold to a labelled
 * stub, and when the row still overflows, chevrons at either end page it —
 * the way MUI's scrollable Tabs do.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { DealDoc, PipelineDoc } from '../model/deal-board-model'
import { DealBoard } from './deal-board'

jest.mock('./owner-avatar', () => ({ OwnerAvatar: () => null }))

const pipeline = {
  $id: 'default',
  name: 'Sales',
  stages: [
    { id: 'prospecting', name: 'Prospecting', order: 0, probability: 10, kind: 'open' },
    { id: 'qualification', name: 'Qualification', order: 1, probability: 10, kind: 'open' },
    { id: 'proposal', name: 'Proposal/Price Quote', order: 2, probability: 75, kind: 'open' },
    { id: 'won', name: 'Closed Won', order: 3, probability: 100, kind: 'won' },
    { id: 'lost', name: 'Closed Lost', order: 4, probability: 0, kind: 'lost' },
  ],
} as unknown as PipelineDoc

const deals = [
  {
    $id: 'deal-1',
    title: 'Acme Drywall — Starter (yearly)',
    pipelineId: 'default',
    stageId: 'proposal',
    status: 'open',
    amountCents: 19200,
    currency: 'usd',
    stageChangedAtMs: 0,
  },
] as unknown as DealDoc[]

const board = () => (
  <DealBoard
    pipeline={pipeline}
    deals={deals}
    won={null}
    lost={null}
    closedExpanded={false}
    onToggleClosed={() => undefined}
    labelFor={() => 'Ada'}
    moving={new Set()}
    onOpen={() => undefined}
    onMove={() => undefined}
    onWon={() => undefined}
    onLost={() => undefined}
    nowMs={0}
  />
)

describe('the deal board', () => {
  it('folds the stages with no deals and keeps the full column for the one that has them', () => {
    render(board())
    expect(screen.getAllByTestId('deal-board-folded-stage').map((stub) => stub.textContent)).toEqual([
      'Prospecting',
      'Qualification',
    ])
    expect(screen.getByText('Acme Drywall — Starter (yearly)')).toBeTruthy()
    expect(screen.getByText('75% · $192.00')).toBeTruthy()
  })

  it('draws no chevrons while every column fits', () => {
    render(board())
    expect(screen.queryByTestId('deal-board-scroll-start')).toBeNull()
    expect(screen.queryByTestId('deal-board-scroll-end')).toBeNull()
  })

  it('draws the chevrons once the row overflows, and pages it toward the end', () => {
    // jsdom lays nothing out, so the scroller's widths are what the test says.
    const sizes = { scrollWidth: 1600, clientWidth: 800 }
    const scrollBy = jest.fn()
    const width = jest
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(() => sizes.scrollWidth)
    const client = jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(() => sizes.clientWidth)
    const original = HTMLElement.prototype.scrollBy
    HTMLElement.prototype.scrollBy = scrollBy as unknown as typeof original
    try {
      render(board())
      const end = screen.getByTestId('deal-board-scroll-end')
      expect(screen.getByTestId('deal-board-scroll-start')).toBeTruthy()
      act(() => {
        fireEvent.click(end)
      })
      expect(scrollBy).toHaveBeenCalledWith({ left: 640, behavior: 'smooth' })
    } finally {
      width.mockRestore()
      client.mockRestore()
      HTMLElement.prototype.scrollBy = original
    }
  })
})
