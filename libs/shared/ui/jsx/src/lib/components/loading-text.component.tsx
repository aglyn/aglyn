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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {Typography, type TypographyProps} from '@mui/material'
import {ElementType, forwardRef, useState} from 'react'
import {useInterval} from 'react-use'


export type LoadingTextProps<C extends ElementType> = TypographyProps<C, {component?: C}> & {
  maxEllipsis: number
  minEllipsis: number
  animationDelay: number
}

const LoadingTextComponent = forwardRef(
  function RefRenderFn<C extends ElementType>(props: LoadingTextProps<C>, ref) {
    const {children, maxEllipsis, minEllipsis, animationDelay, sx, ...rest} = props
    const [count, setCount] = useState(maxEllipsis)
    // const ellipsis =

    useInterval(() => {
      if (count >= maxEllipsis) setCount(minEllipsis)
      else setCount(count + 1)
    }, animationDelay)


    return (
      <Typography
        sx={mergeSxProps({
          ':after': {
            // display: 'block',
            content: `"${[...new Array(count)].map(i => '.').join('')}"`,
            position: 'absolute',
          },
        }, sx)}
        {...rest}
      >
        {children}
      </Typography>
    )
  },
)
LoadingTextComponent.displayName = 'LoadingTextComponent'
LoadingTextComponent.defaultProps = {
  maxEllipsis: 3,
  minEllipsis: 0,
  animationDelay: 1000,
}

export {LoadingTextComponent}
export default LoadingTextComponent
