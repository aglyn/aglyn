/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useCallback } from 'react'

export function useDeleteElementCallback(): (
  node: Aglyn.NodeSchema,
) => Promise<void> {
  const { confirm } = useConfirmationContext()

  return useCallback(
    (node: Aglyn.NodeSchema) => {
      function handleDelete() {
        // Resolved BEFORE the delete and applied after: sibling indices shift
        // once it runs, and the successor has to be a node that survived it
        // (AGL-2553). Hover still goes — the pointer was over what just left.
        const candidates = Besigner.focus.resolveSelectionAfterDeletion([node])
        Besigner.focus.clearHover()
        Aglyn.canvas.deleteNode(node)
        Besigner.focus.selectFirstSurviving(candidates)
      }

      return confirm({
        title: 'Are you sure?',
        description:
          "You are about to delete an element and all of its child elements from the canvas, please confirm the desired option. Press 'Delete' to confirm and delete the item(s). Press 'Cancel' to void the operation and close this dialog.",
        confirmationText: 'Delete',
        confirmationButtonProps: {
          color: 'error',
        },
      })
        .then(handleDelete)
        .catch(() => {})
    },
    [confirm],
  )
}

/**
 * Bulk variant for multi-selection (AGL-10/11): one confirm dialog, then
 * deletes every given node (the root node is skipped defensively).
 */
export function useDeleteElementsCallback(): (
  nodes: Aglyn.NodeSchema[],
) => Promise<void> {
  const { confirm } = useConfirmationContext()

  return useCallback(
    (nodes: Aglyn.NodeSchema[]) => {
      const deletable = nodes.filter(
        (node) => node && !Aglyn.canvas.isRootNode(node),
      )
      if (!deletable.length) return Promise.resolve()

      function handleDelete() {
        // Same two-phase resolve as the single delete (AGL-2553). The whole
        // doomed set is handed over so the anchor is the first node that has
        // a parent; candidates that were themselves deleted — or hung off
        // something that was — are gone from the map by the time the
        // selection is applied, and the next one wins.
        const candidates =
          Besigner.focus.resolveSelectionAfterDeletion(deletable)
        Besigner.focus.clearHover()
        for (const node of deletable) {
          // A node may have been removed already as part of an ancestor.
          if (Aglyn.canvas.getNode(node.$id)) Aglyn.canvas.deleteNode(node)
        }
        Besigner.focus.selectFirstSurviving(candidates)
      }

      return confirm({
        title: 'Are you sure?',
        description:
          `You are about to delete ${deletable.length} elements and all of ` +
          "their child elements from the canvas. Press 'Delete' to confirm " +
          "or 'Cancel' to void the operation.",
        confirmationText: 'Delete',
        confirmationButtonProps: {
          color: 'error',
        },
      })
        .then(handleDelete)
        .catch(() => {})
    },
    [confirm],
  )
}

export default useDeleteElementCallback
