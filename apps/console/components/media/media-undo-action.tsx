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
'use client'

import { Button } from '@mui/material'
import type { ReactNode } from 'react'
import { UNDO_LABEL } from './media-delete-copy'

/** A file that was deleted and could come back. */
export interface MediaUndoTarget {
  id: string
  fileName: string
}

/** What the action needs from the library that owns the snackbar. */
export interface MediaUndoActionDeps {
  /** Puts the files back. Resolves `false` when the server refused. */
  restoreMedia: (targets: MediaUndoTarget[]) => Promise<boolean>
  /** notistack's dismiss, for the message this button is attached to. */
  closeSnackbar: (snackbarId: any) => void
}

/**
 * The Undo control on a delete snackbar (AGL-1467, extracted AGL-1482).
 *
 * One control for both delete surfaces, for the reason AGL-1461 gave when it
 * routed the grid card and the detail drawer through a single `handleDelete`:
 * two copies of an affordance on a destructive path are two things to keep in
 * step, and the one that drifts is the one nobody is looking at.
 *
 * It dismisses the message ON SUCCESS ONLY. A refused undo — the plan's
 * storage limit is the one a person can act on — leaves the button where it
 * was, so freeing space and pressing it again is possible. Closing first would
 * take the only control away at the exact moment it was needed, and the file
 * really is still restorable: the server keeps the tombstone through a refusal
 * precisely so the answer is "not yet" rather than "gone".
 *
 * A module rather than a `useCallback` in the library because all three of
 * those claims are pure logic, and `media-undo-wiring.spec.ts` was asserting
 * them by reading the callback's source for `UNDO_LABEL`, `restoreMedia(…)`
 * and `if (ok) closeSnackbar`. Out here they are three clicks instead.
 *
 * @returns notistack's `action` render prop — it is handed the snackbar's key.
 */
export function mediaUndoAction(
  targets: MediaUndoTarget[],
  deps: MediaUndoActionDeps,
): (snackbarId: any) => ReactNode {
  const { restoreMedia, closeSnackbar } = deps
  return (snackbarId: any) => (
    <Button
      size="small"
      color="inherit"
      onClick={() => {
        void restoreMedia(targets).then((ok) => {
          if (ok) closeSnackbar(snackbarId)
        })
      }}
    >
      {UNDO_LABEL}
    </Button>
  )
}
