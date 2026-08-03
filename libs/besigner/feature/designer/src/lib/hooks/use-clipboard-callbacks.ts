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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback } from 'react'

/**
 * Copy the given nodes (or the current selection) to the besigner clipboard
 * (AGL-1202), reporting the result the way the Add-element flow does.
 */
export function useCopyElementsCallback(): (
  nodes?: Aglyn.NodeSchema<any>[],
) => number {
  // Null-safe: surfaces render without a snackbar provider in tests.
  const { enqueueSnackbar } = useSnackbar() ?? {}

  return useCallback(
    (nodes?: Aglyn.NodeSchema<any>[]) => {
      const targets = nodes?.length ? nodes : Besigner.focus.getSelected()
      const count = Besigner.clipboard.copyNodes(targets)
      if (!count) {
        enqueueSnackbar?.('Nothing to copy', {
          variant: 'warning',
          persist: false,
        })
        return 0
      }
      const labels = Besigner.clipboard.getLabels()
      enqueueSnackbar?.(
        count === 1 ? `Copied ${labels[0]}` : `Copied ${count} elements`,
        { variant: 'success', persist: false },
      )
      return count
    },
    [enqueueSnackbar],
  )
}

/**
 * Paste the clipboard at `target` (defaulting to the current selection) and
 * select what landed. A rejected paste — unknown element, forbidden nesting,
 * empty clipboard — writes nothing and explains itself in a snackbar.
 */
export function usePasteElementsCallback(): (
  target?: Aglyn.NodeSchema<any>,
) => Aglyn.NodeSchema<any>[] {
  const { enqueueSnackbar } = useSnackbar() ?? {}

  return useCallback(
    (target?: Aglyn.NodeSchema<any>) => {
      const into = target ?? Besigner.focus.getLastSelected()
      const result = Besigner.clipboard.pasteInto(into)
      if (result.error) {
        enqueueSnackbar?.(result.error, {
          variant: 'warning',
          persist: false,
        })
        return []
      }
      // Select what was pasted so the next action (retext, restyle, move)
      // acts on it, matching what Add element does.
      Besigner.focus.clearSelection()
      for (const node of result.nodes) {
        Besigner.focus.setSelectedNode(node, true)
      }
      enqueueSnackbar?.(
        result.nodes.length === 1
          ? `Pasted ${result.nodes[0]?.labelShort ?? 'element'}`
          : `Pasted ${result.nodes.length} elements`,
        { variant: 'success', persist: false },
      )
      return result.nodes
    },
    [enqueueSnackbar],
  )
}

export default useCopyElementsCallback
