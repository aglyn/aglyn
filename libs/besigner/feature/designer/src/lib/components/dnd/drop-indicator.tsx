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

import * as Besigner from '@aglyn/besigner'
import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import { type ClientRect } from '@dnd-kit/core'
import { Portal, styled } from '@mui/material'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'

const classes = generateComponentClassKeys('DropIndicator', [
  'root',
  'line',
  'handle',
])

type IndicatorProps = ComponentProps<typeof motion.div> & {
  variant?: 'vertical' | 'horizontal'
  // framer-motion's HTML prop types omit className; MUI styled() accepts it.
  className?: string
}

const lineW = 6
const handleW = lineW + lineW * 1.27
const handleHalf = handleW / 2

const Indicator = styled(motion.div, {
  name: 'DropIndicator',
  shouldForwardProp: (propName) =>
    !_isEqualitySameType(propName, null, 'variant', 'visible'),
})<IndicatorProps>(({ theme, variant }) => {
  const vertical = variant === 'vertical'
  // In CSS vars mode, theme.palette.* is always the static light values.
  // Use (theme.vars || theme) so these become live CSS custom-property refs.
  const tv = (theme as any).vars || theme

  return {
    position: 'absolute',
    display: 'flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: theme.zIndex.modal,

    [`& .${classes.line}`]: {
      border: `${lineW / 2}px solid ${tv.palette.secondary.main}`,
      flexGrow: 1,
      width: !vertical ? undefined : lineW,
      height: !vertical ? lineW : undefined,
      display: 'block',
      content: '""',
    },
    [`& .${classes.handle}`]: {
      backgroundColor: tv.palette.surface.main,
      borderRadius: handleW,
      border: `1px solid ${tv.palette.secondary.dark}`,
      width: handleW,
      height: handleW,
      display: 'block',
      content: '""',
    },
  }
})

export interface DropIndicatorProps extends ComponentProps<typeof Indicator> {
  visible?: boolean
  rect: ClientRect
  region: Besigner.DropRegion
  // framer-motion's HTML prop types omit className; MUI styled() accepts it.
  className?: string
}

export const DropIndicator = forwardRef<HTMLDivElement, DropIndicatorProps>(
  (props, ref) => {
    const { visible, region, rect, className, ...rest } = props

    const styles = {
      [Besigner.DropRegion.LEFT]: {
        left: rect.left - handleHalf,
        top: rect.top - handleHalf,
        height: rect.height + handleW,
        width: undefined,
      },
      [Besigner.DropRegion.TOP]: {
        left: rect.left - handleHalf,
        top: rect.top - handleHalf,
        width: rect.width + handleW,
        height: undefined,
      },
      [Besigner.DropRegion.RIGHT]: {
        left: rect.left + rect.width - handleHalf,
        top: rect.top - handleHalf,
        height: rect.height + handleW,
        width: undefined,
      },
      [Besigner.DropRegion.BOTTOM]: {
        left: rect.left - handleHalf,
        top: rect.top + rect.height - handleHalf,
        width: rect.width + handleW,
        height: undefined,
      },
      [Besigner.DropRegion.CHILDREN]: {
        left: rect.left + handleHalf,
        top: rect.top + rect.height / 2 - handleHalf,
        width: rect.width - handleW,
        height: undefined,
      },
    }

    const vertical =
      region === Besigner.DropRegion.LEFT ||
      region === Besigner.DropRegion.RIGHT

    return (
      <Portal>
        <Indicator
          ref={ref}
          className={clsx(classes.root, className)}
          variant={vertical ? 'vertical' : 'horizontal'}
          animate={{
            ...styles[region],
            visibility: visible ? 'visible' : 'hidden',
          }}
          transition={{ type: 'keyframes' }}
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
