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
  type BesignerCanvasHoveredElement,
  type BesignerCanvasState,
  setBesignerCanvasHovered,
} from '@aglyn/besigner-data-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export type AglynCanvasSetHovered = (hovered: AglynCanvasHovered) => void
export type AglynCanvasHovered =
  | BesignerCanvasHoveredElement
  | ((
      prev: BesignerCanvasHoveredElement,
      canvas: BesignerCanvasState,
    ) => BesignerCanvasHoveredElement)

export function useAglynCanvasSetHovered(): AglynCanvasSetHovered {
  const app = useBesignerAppContext()
  return useCallback(
    (hovered: AglynCanvasHovered) => {
      setBesignerCanvasHovered(app, {
        hovered: (prev, canvas) =>
          _isFnT(hovered) ? hovered(prev, canvas) : hovered,
      })
    },
    [app],
  )
}

export function useAglynCanvasHovered(): [
  value: BesignerCanvasHoveredElement | undefined,
  setValue: AglynCanvasSetHovered,
] {
  const app = useBesignerAppContext()
  const setHovered = useAglynCanvasSetHovered()
  const value = useSubscribable<BesignerCanvasHoveredElement>(
    app.interface?.canvas,
    undefined,
    (canvas) => canvas?.hovered,
    [app],
  )
  return [value, setHovered]
}

export default useAglynCanvasHovered
