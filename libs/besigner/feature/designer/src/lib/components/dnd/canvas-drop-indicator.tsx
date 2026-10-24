/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import * as Besigner from '@aglyn/besigner'
import { useDndContext } from '@dnd-kit/core'
import { observer } from 'mobx-react-lite'
import DropIndicator from './drop-indicator'
import { dropIndicatorBox } from './drop-indicator-geometry'
import { DropSurface, visibleSurfaceRect } from './drop-surface'
import {
  type DropTargetData,
  dropTargetRect,
  insideLandingTarget,
} from './drop-targeting'

/**
 * The drop marker for every besigner drag — canvas, hierarchy and breadcrumbs.
 *
 * It reads one source for each half of what it draws: the target from
 * dnd-kit's live `over`, the region from the dnd store the workspace fills on
 * every move. It used to keep its own copies, taking the rectangle only when
 * the target changed and the region from a value the workspace wrote onto
 * the target — which this component's listener, registered first, read
 * before the workspace had written it. So the marker showed the region from
 * one move ago, on a rectangle from whenever the target was entered.
 */
export const CanvasDropIndicator = observer(() => {
  const { active, over } = useDndContext()
  const region = Besigner.dnd.dropRegion
  const rect = active && over && region ? dropTargetRect(over) : null
  const data = over?.data.current as DropTargetData | undefined
  const clip = rect ? visibleSurfaceRect(data?.surface, rect) : null
  const landing =
    rect &&
    region === Besigner.DropRegion.CHILDREN &&
    data?.surface === DropSurface.CANVAS
      ? insideLandingTarget(data.node)
      : null
  const box = landing
    ? dropIndicatorBox({ ...landing, clip })
    : rect
      ? dropIndicatorBox({ region, rect, inset: data?.inset, clip })
      : null
  const rejected = Boolean(box) && Besigner.dnd.describeDropRejection() != null

  return <DropIndicator box={box} rejected={rejected} />
})
CanvasDropIndicator.displayName = 'CanvasDropIndicator'

export default CanvasDropIndicator
