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
 * WHAT IS TYPED INTO THE STAGES DIALOG SURVIVES A SNAPSHOT.
 *
 * The Pipelines dialog looks the pipeline up from its live listen on every
 * render, and the listen hands over a new row object on every snapshot, a
 * metadata-only one included. The draft was re-seeded on each, so a stage
 * being renamed went back to its stored name under the cursor (the shape
 * AGL-4132 measured in the Edit deal drawer).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_DEAL_STAGES } from '@aglyn/aglyn'
import { updateDoc } from 'firebase/firestore'
import type { PipelineDoc } from '../model/deal-board-model'
import { PipelineStagesDialog } from './pipeline-stages-dialog'

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getCountFromServer: jest.fn(),
  query: () => ({}),
  updateDoc: jest.fn(),
  where: () => ({}),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({ MdiIcon: () => null }))
jest.mock('../hooks/use-crm-scope', () => ({ crmVisibleToClause: () => [] }))

const PIPELINE = {
  $id: 'pipe-1',
  name: 'Sales',
  stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
  isDefault: true,
  archivedAt: null,
  visibleTo: ['org'],
} as unknown as PipelineDoc

/** The same pipeline as a snapshot hands it over: equal values, new objects. */
const resnapshot = (pipeline: PipelineDoc): PipelineDoc => ({
  ...pipeline,
  stages: pipeline.stages.map((stage) => ({ ...stage })),
})

const dialogFor = (pipeline: PipelineDoc | null, open = true, fromCache = false) => (
  <PipelineStagesDialog
    open={open}
    onClose={jest.fn()}
    orgId="org-1"
    pipeline={pipeline}
    fromCache={fromCache}
    unreadable={false}
    visibleToTokens={null}
  />
)

const stageNames = () =>
  screen.getAllByLabelText('Stage').map((input) => (input as HTMLInputElement).value)
const rename = (index: number, name: string) =>
  fireEvent.change(screen.getAllByLabelText('Stage')[index], { target: { value: name } })

beforeEach(() => {
  jest.mocked(updateDoc).mockReset().mockResolvedValue(undefined)
})

describe('what is typed survives a snapshot', () => {
  it('keeps a renamed stage and a new stage being typed through the same pipeline as a new object', () => {
    const view = render(dialogFor(PIPELINE))
    rename(0, 'First call')
    fireEvent.change(screen.getByLabelText('New stage'), { target: { value: 'Demo' } })

    view.rerender(dialogFor(resnapshot(PIPELINE)))
    expect(stageNames()[0]).toBe('First call')
    expect(screen.getByLabelText('New stage')).toHaveProperty('value', 'Demo')
  })

  it('saves what was typed, not the stored name a snapshot carried', async () => {
    const view = render(dialogFor(PIPELINE))
    rename(0, 'First call')
    view.rerender(dialogFor(resnapshot(PIPELINE)))

    fireEvent.click(screen.getByRole('button', { name: 'Save stages' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [ref, data] = jest.mocked(updateDoc).mock.calls[0] as unknown as [
      { path: string },
      { stages: Array<{ name: string }> },
    ]
    expect(ref.path).toBe('orgs/org-1/pipelines/pipe-1')
    expect(data.stages[0].name).toBe('First call')
  })

  it('keeps an edited draft when the stored stages change underneath it', () => {
    const view = render(dialogFor(PIPELINE))
    rename(0, 'First call')

    const elsewhere = resnapshot(PIPELINE)
    elsewhere.stages[1].name = 'Discovery'
    view.rerender(dialogFor(elsewhere))
    expect(stageNames().slice(0, 2)).toEqual(['First call', 'Qualification'])
  })
})

/**
 * The first press is never refused for a late server (AGL-4047): Save is held
 * while the pipeline read is the cache's, with the reason beside it, and what
 * was typed stays through the server's answer.
 */
describe('a save over an unconfirmed read', () => {
  it('keeps a Save pressed during the hold, then saves what was typed', async () => {
    const view = render(dialogFor(PIPELINE, true, true))
    rename(0, 'First call')
    const saveButton = screen.getByRole('button', { name: 'Save stages' }) as HTMLButtonElement
    expect(screen.getByRole('status').textContent).toBe('Checking your pipeline with the server…')
    // Kept, not dropped (AGL-4047): pressed during the hold, it says Saving…
    // and writes nothing until the server answers.
    fireEvent.click(saveButton)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    expect(updateDoc).not.toHaveBeenCalled()

    view.rerender(dialogFor(resnapshot(PIPELINE), true, false))
    expect(stageNames()[0]).toBe('First call')
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
  })
})

describe('the draft follows the stored stages until it is edited', () => {
  it('takes a stored change while nothing has been edited, as a cached read catching up', () => {
    const view = render(dialogFor(PIPELINE))

    const confirmed = resnapshot(PIPELINE)
    confirmed.stages[1].name = 'Discovery'
    view.rerender(dialogFor(confirmed))
    expect(stageNames()[1]).toBe('Discovery')
  })

  it('starts from the stored stages again on the next opening', () => {
    const view = render(dialogFor(PIPELINE))
    rename(0, 'First call')

    view.rerender(dialogFor(PIPELINE, false))
    view.rerender(dialogFor(resnapshot(PIPELINE)))
    expect(stageNames()[0]).toBe('Prospecting')
  })
})
