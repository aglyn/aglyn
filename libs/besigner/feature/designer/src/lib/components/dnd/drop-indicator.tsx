/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import { Portal, styled } from '@mui/material'
import clsx from 'clsx'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'
import {
  DROP_HANDLE_WIDTH,
  DROP_LINE_WIDTH,
  type DropIndicatorBox,
} from './drop-indicator-geometry'

const classes = generateComponentClassKeys('DropIndicator', [
  'root',
  'line',
  'handle',
  'rejected',
])

type IndicatorProps = ComponentProps<'div'> & {
  variant?: 'vertical' | 'horizontal'
}

const Indicator = styled('div', {
  name: 'DropIndicator',
  shouldForwardProp: (propName) =>
    !_isEqualitySameType(propName, null, 'variant'),
})<IndicatorProps>(({ theme, variant }) => {
  const vertical = variant === 'vertical'
  // In CSS vars mode, theme.palette.* is always the static light values.
  // Use (theme.vars || theme) so these become live CSS custom-property refs.
  const tv = (theme as any).vars || theme

  return {
    // Viewport px, like the rectangles it is placed from.
    position: 'fixed',
    // Drawn over the pointer, and must never be what the pointer is over:
    // the drop target is hit-tested by what is painted under the pointer.
    pointerEvents: 'none',
    display: 'flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: theme.zIndex.modal,

    [`& .${classes.line}`]: {
      // Slate, not the accent (AGL-1194): the indicator is drawn over the
      // user's design and must not read as part of it.
      border: `${DROP_LINE_WIDTH / 2}px solid ${tv.palette.tertiary.main}`,
      flexGrow: 1,
      width: !vertical ? undefined : DROP_LINE_WIDTH,
      height: !vertical ? DROP_LINE_WIDTH : undefined,
      display: 'block',
      content: '""',
    },
    [`& .${classes.handle}`]: {
      backgroundColor: tv.palette.surface.main,
      borderRadius: DROP_HANDLE_WIDTH,
      border: `1px solid ${tv.palette.tertiary.dark}`,
      width: DROP_HANDLE_WIDTH,
      height: DROP_HANDLE_WIDTH,
      flexShrink: 0,
      display: 'block',
      content: '""',
    },
    // A drop here would be refused (an element that can't hold children, a
    // parent the element isn't allowed in). Said before the drop, rather
    // than by a warning after a marker that looked like any other.
    [`&.${classes.rejected} .${classes.line}`]: {
      borderColor: tv.palette.error.main,
    },
    [`&.${classes.rejected} .${classes.handle}`]: {
      borderColor: tv.palette.error.dark,
    },
  }
})

export interface DropIndicatorProps extends ComponentProps<'div'> {
  /** Where to draw, from `dropIndicatorBox`; null hides the marker. */
  box: DropIndicatorBox | null
  /** The drop this marks would be refused. */
  rejected?: boolean
}

/**
 * The line that says where a dragged element will land.
 *
 * Placed, not animated. It used to tween each move over framer-motion's
 * default duration, so it trailed the pointer and swept across the canvas
 * from one target to the next; it now sits exactly where the drop resolves.
 */
export const DropIndicator = forwardRef<HTMLDivElement, DropIndicatorProps>(
  (props, ref) => {
    const { box, rejected, className, style, ...rest } = props

    return (
      <Portal>
        <Indicator
          ref={ref}
          aria-hidden
          className={clsx(
            classes.root,
            { [classes.rejected]: Boolean(rejected) },
            className,
          )}
          variant={box?.vertical ? 'vertical' : 'horizontal'}
          style={{
            ...style,
            ...(box
              ? {
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                }
              : {}),
            visibility: box ? 'visible' : 'hidden',
          }}
          {...rest}
        >
          <div className={classes.handle} />
          <div className={classes.line} />
          <div className={classes.handle} />
        </Indicator>
      </Portal>
    )
  },
)
DropIndicator.displayName = 'DropIndicator'

export default DropIndicator
