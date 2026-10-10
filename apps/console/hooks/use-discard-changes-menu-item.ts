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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback } from 'react'

/**
 * File ▸ Discard changes… for every besigner editor (AGL-3723).
 *
 * Puts the canvas back to the stored document — the published tree on the
 * live version, the last save on any other — and drops the local and shared
 * drafts, after a confirm because the reset cannot be undone.
 * `useBesignerDocument().discardChanges` does the document half; the editor
 * passes what only it owns: the co-editing mirror and its own "draft saved"
 * flag.
 */
export function useDiscardChangesMenuItem(options: {
  noun: string
  /** Editing the version the sites serve, where the stored tree is live. */
  live: boolean
  /** `useBesignerDocument().canDiscard`, plus any draft state the editor keeps. */
  canDiscard: boolean
  discardChanges: () => boolean
  /** Clears what the editor owns: the mirror, a draft-saved flag. */
  onDiscarded?: () => void
}) {
  const { noun, live, canDiscard, discardChanges, onDiscarded } = options
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const target = live ? 'the published version' : 'its last save'

  const onClick = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Discard changes?',
      description:
        `This puts the ${noun} back to ${target} and deletes its unsaved ` +
        'changes and saved draft. This cannot be undone.',
      confirmationText: 'Discard',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    if (!discardChanges()) {
      enqueueSnackbar(`The ${noun} has not loaded yet — try again.`, {
        variant: 'warning',
        persist: false,
      })
      return
    }
    onDiscarded?.()
    enqueueSnackbar(`Changes discarded — back to ${target}.`, {
      variant: 'success',
      persist: false,
    })
  }, [confirm, noun, target, discardChanges, onDiscarded, enqueueSnackbar])

  return {
    id: 'center-nav-file-discard',
    children: 'Discard changes…',
    disabled: !canDiscard,
    // A disabled entry says why, like Save & publish does.
    ...(canDiscard
      ? { ListItemTextProps: { inset: true } }
      : {
          ListItemTextProps: { inset: true, secondary: 'No changes to discard' },
        }),
    onClick,
  }
}

export default useDiscardChangesMenuItem
