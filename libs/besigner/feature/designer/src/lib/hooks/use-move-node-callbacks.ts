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
 * Move a node between containers by clicking (AGL-1405), reporting the way
 * paste and Add element do. A refused move writes nothing and says why —
 * the refusals are the point, since the situation this exists to repair was
 * caused by a drop that was accepted and then discarded.
 */
function useMoveCallback(
  move: (node: Aglyn.NodeSchema<any>) => Besigner.MoveResult,
): (node?: Aglyn.NodeSchema<any>) => Aglyn.NodeSchema<any> | undefined {
  // Null-safe: surfaces render without a snackbar provider in tests.
  const { enqueueSnackbar } = useSnackbar() ?? {}

  return useCallback(
    (node?: Aglyn.NodeSchema<any>) => {
      const target = node ?? Besigner.focus.getLastSelected()
      if (!target) return undefined

      const result = move(target)
      if (result.error) {
        enqueueSnackbar?.(result.error, { variant: 'warning', persist: false })
        return undefined
      }
      // Keep the moved node selected so the hierarchy scrolls to its new
      // home and the next action acts on it — a move the author can't see
      // land is the failure mode this whole issue is about.
      if (result.node) Besigner.focus.setSelectedNode(result.node)
      return result.node
    },
    [move, enqueueSnackbar],
  )
}

/** Lift the node out of its container, landing it just after that container. */
export function useMoveNodeOutCallback() {
  return useMoveCallback(Besigner.moveNodeOut)
}

/** Tuck the node into the sibling directly above it. */
export function useMoveNodeInCallback() {
  return useMoveCallback(Besigner.moveNodeIn)
}

export default useMoveNodeOutCallback
