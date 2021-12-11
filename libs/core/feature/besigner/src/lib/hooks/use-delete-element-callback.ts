/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {
  deleteCanvasElement,
  ElementId,
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
} from '@aglyn/core-data-framework'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ChangeEvent, useCallback } from 'react'


export interface UseDeleteElementCallbackOptions {
  $id?: ElementId
  onfulfilled?: (value: unknown) => void | PromiseLike<void>
  onrejected?: (reason: any) => void | PromiseLike<void>
  oncatch?: (error: unknown) => void | PromiseLike<void>
}

export type UseDeleteElementCallback = {
  (e: ChangeEvent<unknown>, callbackOptions?: UseDeleteElementCallbackOptions): void
}

export const useDeleteElementCallback = (
  options?: UseDeleteElementCallbackOptions,
): UseDeleteElementCallback => {
  const {$id, onfulfilled, onrejected, oncatch} = {...options}
  const {confirm} = useConfirmationContext()
  const {getApp} = useAglynAppContext()
  return useCallback(
    (e: ChangeEvent<unknown>, clbkOpts?: UseDeleteElementCallbackOptions) => {
      const app = getApp()

      confirm({
        title: 'Are you sure?',
        description:
          'You are about to delete an element from the canvas, please confirm the desired option. Press \'Delete\' to confirm and delete the item. Press \'Cancel\' to void the operation and close this dialog.',
        confirmationText: 'Delete',
        confirmationButtonProps: {
          color: 'error',
        },
      })
      .then(
        (res) => {
          setBesignerCanvasSelected(app, {selected: null})
          setBesignerCanvasHovered(app, {hovered: null})
          deleteCanvasElement(app, {$id: clbkOpts?.$id ?? $id})
          clbkOpts?.onfulfilled && clbkOpts?.onfulfilled(res)
          onfulfilled && onfulfilled(res)
        },
        (reason) => {
          console.warn('rejected', reason)
          clbkOpts?.onrejected && clbkOpts?.onrejected(reason)
          onrejected && onrejected(reason)
        },
      )
      .catch((e) => {
        console.error('caught error', e)
        clbkOpts?.oncatch && clbkOpts?.oncatch(e)
        oncatch && oncatch(e)
      })
    },
    [$id, onfulfilled, onrejected, oncatch, confirm],
  )
}

export default useDeleteElementCallback
