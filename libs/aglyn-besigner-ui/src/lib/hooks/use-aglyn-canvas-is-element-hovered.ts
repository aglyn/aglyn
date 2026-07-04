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

import { BesignerCanvasHoveredElement } from '@aglyn/besigner-data-app'
import type { NodeId } from '@aglyn/aglyn'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import useBesignerAppContext from './use-besigner-app-context'

export function useAglynCanvasElementIsHovered($id: NodeId): boolean {
  const app = useBesignerAppContext()
  const value = useSubscribable<BesignerCanvasHoveredElement>(
    app.interface?.canvas,
    false,
    (canvas) => $id && canvas?.hovered?.$id === $id,
    [$id, app],
  )

  return value
}

export default useAglynCanvasElementIsHovered
