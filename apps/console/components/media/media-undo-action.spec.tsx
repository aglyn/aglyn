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
 * AGL-1467's Undo control, run rather than read (AGL-1482).
 *
 * `media-undo-wiring.spec.ts` asserted these three facts by searching the
 * library's `undoAction` callback for `UNDO_LABEL`, `restoreMedia(targets)`
 * and `if (ok) closeSnackbar` — 430 characters of pure logic that happened to
 * live inside a component mounting a Firestore listener stack, which is the
 * only reason they were text at all. Lifted to a module they are three clicks,
 * and the third one is the one worth having: a refusal that closed the
 * snackbar anyway would take the recovery control away at the exact moment it
 * was needed, and no amount of reading the source proves that it does not.
 *
 * The wiring that stays over there is the part this cannot see — that BOTH
 * delete surfaces attach this action, and only when the server reported a
 * tombstone.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { UNDO_LABEL } from './media-delete-copy'
import { mediaUndoAction, type MediaUndoTarget } from './media-undo-action'

const TARGETS: MediaUndoTarget[] = [{ id: 'm1', fileName: 'hero.png' }]
const SNACKBAR_ID = 'snack-1'

function renderAction(restore: () => Promise<boolean>) {
  const restoreMedia = jest.fn(restore)
  const closeSnackbar = jest.fn()
  render(
    <>
      {mediaUndoAction(TARGETS, { restoreMedia, closeSnackbar })(SNACKBAR_ID)}
    </>,
  )
  return { restoreMedia, closeSnackbar }
}

const undo = () => screen.getByRole('button', { name: UNDO_LABEL })

describe('the Undo action on a delete snackbar (AGL-1467)', () => {
  it('is a button carrying the shared label', () => {
    renderAction(async () => true)
    expect(undo()).toBeTruthy()
  })

  it('restores exactly the files the snackbar was about', async () => {
    const { restoreMedia } = renderAction(async () => true)
    fireEvent.click(undo())
    await waitFor(() => expect(restoreMedia).toHaveBeenCalledTimes(1))
    expect(restoreMedia).toHaveBeenCalledWith(TARGETS)
  })

  it('dismisses the message once the files are back', async () => {
    const { closeSnackbar } = renderAction(async () => true)
    fireEvent.click(undo())
    await waitFor(() => expect(closeSnackbar).toHaveBeenCalledWith(SNACKBAR_ID))
  })

  /**
   * The half that matters. The server keeps the tombstone through a refusal —
   * "not yet", because freeing storage and pressing Undo again is a real
   * course of action — so dismissing here would remove the only control that
   * could take it.
   */
  it('leaves the message up when the restore was refused', async () => {
    const { restoreMedia, closeSnackbar } = renderAction(async () => false)
    fireEvent.click(undo())
    await waitFor(() => expect(restoreMedia).toHaveBeenCalledTimes(1))
    expect(closeSnackbar).not.toHaveBeenCalled()
    // Still pressable: freeing space and trying again has to be possible.
    expect(undo()).toBeTruthy()
  })
})
