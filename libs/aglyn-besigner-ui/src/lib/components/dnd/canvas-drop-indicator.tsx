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

import {
  type ClientRect,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import { REGION } from '../../utils/droppable-region-utils'
import DropIndicator from './drop-indicator'

const DEFAULT: { region: REGION; rect: ClientRect } = {
  region: REGION.CHILDREN,
  rect: {
    left: 0,
    top: 0,
    height: 0,
    right: 0,
    bottom: 0,
    width: 0,
  },
}

export const CanvasDropIndicator = observer(() => {
  const [visible, setVisible] = useState(false)
  const [{ rect, region }, setRect] = useState<typeof DEFAULT>({
    rect: { ...DEFAULT.rect } as ClientRect,
    region: REGION.CHILDREN,
  })

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => setVisible(true),
    onDragEnd: (event: DragEndEvent) => setVisible(false),
    onDragCancel: (event: DragCancelEvent) => setVisible(false),
    onDragMove: (event: DragMoveEvent) =>
      setRect({
        rect: event.over?.rect || DEFAULT.rect,
        region: event.over?.data.current.region || DEFAULT.region,
      }),
  })

  return <DropIndicator rect={rect} visible={visible} region={region} />
})
CanvasDropIndicator.displayName = 'CanvasDropIndicator'

export default CanvasDropIndicator
