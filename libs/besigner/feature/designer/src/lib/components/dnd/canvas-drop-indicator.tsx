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
import {
  type ClientRect,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverEvent,
  type DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { observer } from 'mobx-react-lite'
import { useState } from 'react'
import DropIndicator from './drop-indicator'

const DEFAULT: { region: Besigner.DropRegion; rect: ClientRect } = {
  region: Besigner.DropRegion.CHILDREN,
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
  const [rect, setRect] = useState<ClientRect>(() => ({ ...DEFAULT.rect }))
  const [region, setRegion] = useState<Besigner.DropRegion>(DEFAULT.region)

  useDndMonitor({
    onDragStart: (event: DragStartEvent) => setVisible(true),
    onDragEnd: (event: DragEndEvent) => setVisible(false),
    onDragCancel: (event: DragCancelEvent) => setVisible(false),
    onDragOver(event: DragOverEvent) {
      setVisible(Boolean(event.over))
      if (event.over) setRect(event.over?.rect)
    },
    onDragMove: (event: DragMoveEvent) => {
      setRegion(event.over?.data.current.region || DEFAULT.region)
    },
  })

  return <DropIndicator rect={rect} visible={visible} region={region} />
})
CanvasDropIndicator.displayName = 'CanvasDropIndicator'

export default CanvasDropIndicator
