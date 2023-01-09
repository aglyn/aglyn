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

import generateComponentClassKeys from '@aglyn/shared-ui-theme/util/generate-component-class-keys'
import _isEqualitySameType from '@aglyn/shared-util-guards/_is-equality-same-type'
import { type ClientRect } from '@dnd-kit/core'
import { styled } from '@mui/material'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { forwardRef } from 'react'
import { REGION } from '../../utils/droppable-region-utils'

const classes = generateComponentClassKeys('DropIndicator', [
  'root',
  'line',
  'handle',
])

type IndicatorProps = JSX.ComponentProps<typeof motion.div> & {
  variant?: 'vertical' | 'horizontal'
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

  return {
    position: 'absolute',
    display: 'flex',
    flexDirection: vertical ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: theme.zIndex.modal,

    [`& .${classes.line}`]: {
      border: `${lineW / 2}px solid ${theme.palette.secondary.main}`,
      flexGrow: 1,
      width: !vertical ? undefined : lineW,
      height: !vertical ? lineW : undefined,
      display: 'block',
      content: '""',
    },
    [`& .${classes.handle}`]: {
      backgroundColor: theme.palette.surface.main,
      borderRadius: handleW,
      border: `1px solid ${theme.palette.secondary.dark}`,
      width: handleW,
      height: handleW,
      display: 'block',
      content: '""',
    },
  }
})

export interface DropIndicatorProps
  extends JSX.ComponentProps<typeof Indicator> {
  visible?: boolean
  rect: ClientRect
  region: REGION
}

export const DropIndicator = forwardRef<HTMLDivElement, DropIndicatorProps>(
  (props, ref) => {
    const { style, visible, region, rect, ...rest } = props

    const styles = {
      [REGION.LEFT]: {
        left: rect.left - handleHalf,
        top: rect.top - handleHalf,
        height: rect.height + handleW,
        width: null,
      },
      [REGION.TOP]: {
        left: rect.left - handleHalf,
        top: rect.top - handleHalf,
        width: rect.width + handleW,
        height: null,
      },
      [REGION.RIGHT]: {
        left: rect.left + rect.width - handleHalf,
        top: rect.top - handleHalf,
        height: rect.height + handleW,
        width: null,
      },
      [REGION.BOTTOM]: {
        left: rect.left - handleHalf,
        top: rect.top + rect.height - handleHalf,
        width: rect.width + handleW,
        height: null,
      },
      [REGION.CHILDREN]: {
        left: rect.left + handleHalf,
        top: rect.top + rect.height / 2 - handleHalf,
        width: rect.width - handleW,
        height: null,
      },
    }

    const vertical = region === REGION.LEFT || region === REGION.RIGHT

    return (
      <Indicator
        ref={ref}
        className={clsx(classes.root)}
        variant={vertical ? 'vertical' : 'horizontal'}
        style={style}
        animate={{
          ...styles[region],
          visibility: visible ? 'visible' : 'hidden',
        }}
        transition={{ type: 'spring' }}
        {...rest}
      >
        <div className={classes.handle} />
        <div className={classes.line} />
        <div className={classes.handle} />
      </Indicator>
    )
  },
)
DropIndicator.displayName = 'DropIndicator'

export default DropIndicator
