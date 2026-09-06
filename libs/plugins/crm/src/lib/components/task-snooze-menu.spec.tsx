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
 * A snooze is ONE write of ONE field (AGL-2619), and a click on it is not a
 * click on the row it sits in. These pin both, plus the form-only path a
 * task that does not exist yet takes.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { snoozeDueAt } from '../model/task-views'
import { TaskSnoozeMenu } from './task-snooze-menu'

const FIRESTORE = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
}))

let writes: Array<{ path: string; value: Record<string, unknown> }>
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: async (ref: { path: string }, value: Record<string, unknown>) => {
    writes.push({ path: ref.path, value })
  },
  serverTimestamp: () => '<server-timestamp>',
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

// A Wednesday evening, from local parts, so the expectations hold in any zone.
const NOW = new Date(2026, 8, 9, 18, 45).getTime()
const DUE = new Date(2026, 8, 1, 14, 30).getTime()
const SCOPE = ['orgs', 'org-1'] as const

beforeEach(() => {
  writes = []
  notices = []
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('TaskSnoozeMenu', () => {
  it('writes the one field on the stored task and says when it is due', async () => {
    const onSnoozed = jest.fn()
    render(
      <TaskSnoozeMenu
        dueAtMs={DUE}
        target={{ write: { scope: SCOPE, taskId: 't1' } }}
        onSnoozed={onSnoozed}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tomorrow' }))
    const expected = snoozeDueAt('tomorrow', DUE, NOW)
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      path: 'orgs/org-1/crmTasks/t1',
      value: { dueAtMs: expected, updatedAt: '<server-timestamp>' },
    })
    expect(onSnoozed).toHaveBeenCalledWith(expected)
    expect(notices[0]).toMatch(/^Snoozed until /)
  })

  it('hands the date to a form that has no document yet, and writes nothing', async () => {
    const pick = jest.fn()
    render(<TaskSnoozeMenu variant="button" dueAtMs={null} target={{ pick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Next week' }))
    expect(pick).toHaveBeenCalledWith(snoozeDueAt('nextWeek', null, NOW))
    expect(writes).toEqual([])
    expect(notices).toEqual([])
  })

  it('offers a date of its own, starting from tomorrow', async () => {
    render(<TaskSnoozeMenu dueAtMs={DUE} target={{ write: { scope: SCOPE, taskId: 't1' } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pick a date…' }))
    const input = (await screen.findByLabelText('Due')) as HTMLInputElement
    expect(input.value).toBe('2026-09-10T14:30')
    fireEvent.change(input, { target: { value: '2026-09-21T08:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Snooze', hidden: false }))
    // The dialog's own Snooze button is the last one in the document.
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].value['dueAtMs']).toBe(new Date(2026, 8, 21, 8, 15).getTime())
  })

  it('does not let a click reach the row it sits on', async () => {
    const rowClick = jest.fn()
    render(
      <div onClick={rowClick} role="row">
        <TaskSnoozeMenu dueAtMs={DUE} target={{ write: { scope: SCOPE, taskId: 't1' } }} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tomorrow' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(rowClick).not.toHaveBeenCalled()
  })
})
