/**
 * @license
 * Copyright 2022 Aglyn LLC
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
        console.log('delete node', node)
        Besigner.focus.clearFocusStatus()
        Aglyn.canvas.deleteNode(node)
      }

      return confirm({
        title: 'Are you sure?',
        description:
          "You are about to delete an element from the canvas, please confirm the desired option. Press 'Delete' to confirm and delete the item. Press 'Cancel' to void the operation and close this dialog.",
        confirmationText: 'Delete',
        confirmationButtonProps: {
          color: 'error',
        },
      })
        .then(handleDelete)
        .catch(console.log)
    },
    [confirm],
  )
}

export default useDeleteElementCallback
