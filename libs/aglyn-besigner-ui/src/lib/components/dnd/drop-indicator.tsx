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
import mergeSxProps from '@aglyn/shared-ui-theme/util/merge-sx-props'
import {
  type ClientRect,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { type BoxProps, Stack } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useState } from 'react'
import { REGION } from '../../utils/droppable-region-utils'

type State = {
  rect: ClientRect
  region: REGION
}
const DEFAULT = {
  region: REGION.CHILDREN,
  rect: {
    left: 0,
    top: 0,
    height: 0,
    right: 0,
    bottom: 0,
    width: 0,
  } as ClientRect,
}

export interface DropIndicatorProps extends Partial<BoxProps> {}

export const DropIndicator = observer(
  forwardRef<HTMLDivElement, DropIndicatorProps>((props, ref) => {
    const { style, sx, ...rest } = props
    const [visible, setVisible] = useState(false)
    const [{ rect, region }, setRect] = useState<State>({
      rect: { ...DEFAULT.rect } as ClientRect,
      region: REGION.CHILDREN,
    })
    const vertical = region === REGION.LEFT || region === REGION.RIGHT

    useDndMonitor({
      onDragStart: (event: DragStartEvent) => setVisible(true),
      onDragEnd: (event: DragEndEvent) => setVisible(false),
      onDragMove: (event: DragMoveEvent) =>
        setRect({
          rect: event.over?.rect || DEFAULT.rect,
          region: event.over?.data.current.region || DEFAULT.region,
        }),
    })

    const styles = {
      [REGION.LEFT]: {
        left: rect.left - 4,
        top: rect.top - 4,
        height: rect.height + 8,
      },
      [REGION.TOP]: {
        left: rect.left - 4,
        top: rect.top - 4,
        width: rect.width + 8,
      },
      [REGION.RIGHT]: {
        left: rect.left + rect.width - 4,
        top: rect.top - 4,
        height: rect.height + 8,
      },
      [REGION.BOTTOM]: {
        left: rect.left - 4,
        top: rect.top + rect.height - 4,
        width: rect.width + 8,
      },
      [REGION.CHILDREN]: {
        left: rect.left + 4,
        top: rect.top + rect.height / 2 - 4,
        width: rect.width - 8,
      },
    }

    return (
      <Stack
        ref={ref}
        direction={!vertical ? 'row' : 'column'}
        style={{
          visibility: visible ? 'visible' : 'hidden',
          position: 'absolute',
          ...styles[region],
          ...style,
        }}
        alignItems="center"
        justifyContent="center"
        sx={mergeSxProps(
          {
            ['& .vectorLine']: {
              bgcolor: 'secondary.main',
              flexGrow: 1,
              width: !vertical ? undefined : 3,
              height: !vertical ? 3 : undefined,
              display: 'block',
              content: '""',
            },
            ['& .vectorPoint']: {
              bgcolor: 'surface.main',
              borderRadius: 8,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'secondary.dark',
              width: 8,
              height: 8,
              display: 'block',
              content: '""',
            },
          },
          sx,
        )}
        {...rest}
      >
        <div className={'vectorPoint'} />
        <div className={'vectorLine'} />
        <div className={'vectorPoint'} />
      </Stack>
    )
  }),
)
DropIndicator.displayName = 'DropIndicator'

export default DropIndicator
