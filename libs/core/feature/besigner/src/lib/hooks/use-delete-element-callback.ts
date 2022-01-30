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

import {setBesignerCanvasHovered, setBesignerCanvasSelected} from '@aglyn/core-data-besigner'
import {deleteCanvasElement, type ElementId} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {useConfirmationContext} from '@aglyn/shared-ui-jsx'
import {type ChangeEvent, useCallback} from 'react'


export interface UseDeleteElementCallbackOptions {
  $id?: ElementId
  onFulfilled?: (value: unknown) => void | PromiseLike<void>
  onRejected?: (reason: any) => void | PromiseLike<void>
  onCatch?: (error: unknown) => void | PromiseLike<void>
}

export type UseDeleteElementCallback = {
  (e: ChangeEvent<unknown>, callbackOptions?: UseDeleteElementCallbackOptions): void
}

export const useDeleteElementCallback = (
  options?: UseDeleteElementCallbackOptions,
): UseDeleteElementCallback => {
  const {$id, onFulfilled, onRejected, onCatch} = {...options}
  const {confirm} = useConfirmationContext()
  const {getApp} = useAglynAppContext()

  return useCallback((e: ChangeEvent<unknown>, opts?: UseDeleteElementCallbackOptions) => {

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
            const app = getApp()
            setBesignerCanvasSelected(app, {selected: () => ({})})
            setBesignerCanvasHovered(app, {hovered: () => ({})})
            deleteCanvasElement(app, {$id: opts?.$id || $id})
            opts?.onFulfilled && opts?.onFulfilled(res)
            onFulfilled && onFulfilled(res)
          },
          (reason) => {
            console.warn('rejected', reason)
            opts?.onRejected && opts?.onRejected(reason)
            onRejected && onRejected(reason)
          },
        )
        .catch((e) => {
          console.error('caught error', e)
          opts?.onCatch && opts?.onCatch(e)
          onCatch && onCatch(e)
        })

    }, [getApp, confirm, $id, onFulfilled, onRejected, onCatch],
  )
}

export default useDeleteElementCallback
