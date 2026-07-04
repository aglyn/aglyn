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

import {
  type BesignerCanvasSelectedElement,
  type BesignerCanvasState,
  setBesignerCanvasSelected,
} from '@aglyn/besigner-data-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export type BesignerCanvasSetSelected = (
  selected: BesignerCanvasSelected,
) => void
export type BesignerCanvasSelected =
  | BesignerCanvasSelectedElement
  | ((
      prev: BesignerCanvasSelectedElement,
      canvas: BesignerCanvasState,
    ) => BesignerCanvasSelectedElement)

export function useAglynCanvasSetSelected(): BesignerCanvasSetSelected {
  const app = useBesignerAppContext()
  return useCallback(
    (selected: BesignerCanvasSelected) => {
      setBesignerCanvasSelected(app, {
        selected: (prev, canvas) =>
          _isFnT(selected) ? selected(prev, canvas) : selected,
      })
    },
    [app],
  )
}

export function useAglynCanvasSelected(): [
  value: BesignerCanvasSelectedElement | undefined,
  setValue: BesignerCanvasSetSelected,
] {
  const app = useBesignerAppContext()
  const value = useSubscribable<BesignerCanvasSelectedElement>(
    app.interface?.canvas,
    undefined,
    (canvas) => canvas?.selected,
    [app],
  )
  const setSelected = useAglynCanvasSetSelected()

  return [value, setSelected]
}

export default useAglynCanvasSelected
