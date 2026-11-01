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
 * THE DEAL'S PATH, THE WAY SALESFORCE DRAWS ONE.
 *
 * The Stage card listed only the open stages, so a deal in its last open
 * stage showed nothing ahead of it and a closed deal lost the path
 * altogether. The path now runs through every open stage to one closing
 * step: "Closed" while the deal is open, which asks won or lost, and the
 * pipeline's own name for the verdict once it is closed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DealDoc, PipelineDoc } from '../model/deal-board-model'
import { DealStageCard } from './deal-stage-card'

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

const pipeline = {
  $id: 'default',
  name: 'Sales',
  stages: [
    { id: 'prospecting', name: 'Prospecting', order: 0, probability: 10, kind: 'open' },
    { id: 'proposal', name: 'Proposal/Price Quote', order: 1, probability: 75, kind: 'open' },
    { id: 'negotiation', name: 'Negotiation/Review', order: 2, probability: 90, kind: 'open' },
    { id: 'won', name: 'Closed Won', order: 3, probability: 100, kind: 'won' },
    { id: 'lost', name: 'Closed Lost', order: 4, probability: 0, kind: 'lost' },
  ],
} as unknown as PipelineDoc

const deal = (patch: Partial<DealDoc> = {}) =>
  ({
    $id: 'deal-1',
    title: 'Acme Drywall — Starter (yearly)',
    pipelineId: 'default',
    stageId: 'negotiation',
    status: 'open',
    stageChangedAtMs: 0,
    ...patch,
  }) as unknown as DealDoc

const api = () => ({
  moveToStage: jest.fn().mockResolvedValue({ ok: true }),
  markWon: jest.fn().mockResolvedValue({ ok: true }),
  markLost: jest.fn().mockResolvedValue({ ok: true }),
})

const closingStep = () => screen.getByTestId('deal-stage-closing-step')

describe('the deal’s path', () => {
  it('shows every open stage and then a closing step, even from the last open stage', () => {
    render(<DealStageCard deal={deal()} pipeline={pipeline} api={api()} nowMs={0} />)
    for (const name of ['Prospecting', 'Proposal/Price Quote', 'Negotiation/Review']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(closingStep().textContent).toContain('Closed')
    expect((closingStep() as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks won or lost from the closing step, in the pipeline’s own words', async () => {
    const stageApi = api()
    render(<DealStageCard deal={deal()} pipeline={pipeline} api={stageApi} nowMs={0} />)
    fireEvent.click(closingStep())
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Closed Won',
      'Closed Lost',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Closed Won' }))
    await waitFor(() => expect(stageApi.markWon).toHaveBeenCalledTimes(1))
    expect(stageApi.moveToStage).not.toHaveBeenCalled()
  })

  it('takes a lost deal through the reason, never straight to the route', () => {
    const stageApi = api()
    render(<DealStageCard deal={deal()} pipeline={pipeline} api={stageApi} nowMs={0} />)
    fireEvent.click(closingStep())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Closed Lost' }))
    expect(stageApi.markLost).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('keeps the path on a closed deal, ending on the verdict, and offers no moves on it', () => {
    render(
      <DealStageCard
        deal={deal({ status: 'won', stageId: 'won', closedAtMs: 0 } as Partial<DealDoc>)}
        pipeline={pipeline}
        api={api()}
        nowMs={0}
      />,
    )
    expect(screen.getByText('Prospecting')).toBeTruthy()
    expect(closingStep().textContent).toContain('Closed Won')
    expect((closingStep() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Reopen into' })).toBeTruthy()
  })
})
