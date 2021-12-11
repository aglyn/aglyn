/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import MuiPopper, { PopperProps as MuiPopperProps } from '@mui/material/Popper'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes } from 'react'


const classKeys = generateComponentClassKeys('AglynPopperStyled', [
  'arrow',
])

export const PopperStyledArrowComponent = styled(forwardRef<any, HTMLAttributes<HTMLDivElement>>(
  function RefRenderFn(props, ref) {
    const {className, ...rest} = props
    return (
      <div ref={ref} className={clsx(classKeys.arrow, className)} {...rest} />
    )
  },
), {
  name: 'AglynPopperArrow',
})({
  position: 'absolute',
  fontSize: 7,
  width: '3em',
  height: '3em',
  '&::before': {
    content: '""',
    margin: 'auto',
    display: 'block',
    width: 0,
    height: 0,
    borderStyle: 'solid',
  },
})

export interface PopperStyledComponentProps extends MuiPopperProps {
  disableArrow?: boolean
  arrowGap?: number | string
}

const PopperStyledComponent = styled(MuiPopper, {
  name: 'AglynPopperStyled',
  shouldForwardProp: (prop) => !_isEqualitySameType(prop, 'disableArrow', 'arrowGap'),
})<PopperStyledComponentProps>(({theme, disableArrow, arrowGap}) => ({
  zIndex: 1,
  '& > div': {
    position: 'relative',
  },
  '&[data-popper-placement*="bottom"]': {
    '& > div': {
      marginTop: !disableArrow ? arrowGap ?? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      top: 0,
      left: 0,
      marginTop: '-0.9em',
      width: '3em',
      height: '1em',
      '&::before': {
        borderWidth: '0 1em 1em 1em',
        borderColor: `transparent transparent ${theme.palette.primary.main} transparent`,
      },
    },
  },
  '&[data-popper-placement*="top"]': {
    '& > div': {
      marginBottom: !disableArrow ? arrowGap ?? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      bottom: 0,
      left: 0,
      marginBottom: '-0.9em',
      width: '3em',
      height: '1em',
      '&::before': {
        borderWidth: '1em 1em 0 1em',
        borderColor: `${theme.palette.primary.main} transparent transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="right"]': {
    '& > div': {
      marginLeft: !disableArrow ? arrowGap ?? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      left: 0,
      marginLeft: '-0.9em',
      height: '3em',
      width: '1em',
      '&::before': {
        borderWidth: '1em 1em 1em 0',
        borderColor: `transparent ${theme.palette.primary.main} transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="left"]': {
    '& > div': {
      marginRight: !disableArrow ? arrowGap ?? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      right: 0,
      marginRight: '-0.9em',
      height: '3em',
      width: '1em',
      '&::before': {
        borderWidth: '1em 0 1em 1em',
        borderColor: `transparent transparent transparent ${theme.palette.primary.main}`,
      },
    },
  },
}))

PopperStyledComponent.displayName = 'PopperStyledComponent'
PopperStyledComponent.defaultProps = {
  arrowGap: 2,
}

export { PopperStyledComponent }
export default PopperStyledComponent
