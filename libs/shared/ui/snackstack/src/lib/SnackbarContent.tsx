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

import {styled} from '@mui/material'
import {forwardRef} from 'react'
import {type SnackbarContentProps} from './types'


const Root = styled('div', {
  name: 'AglynSnackbarContent',
})(({theme}) => ({
  display: 'flex',
  flexWrap: 'wrap',
  flexGrow: 1,
  [theme.breakpoints.up('sm')]: {
    flexGrow: 'initial',
    minWidth: 288,
  },
}))

const SnackbarContent = forwardRef<HTMLDivElement, SnackbarContentProps>(
  function RefRenderFn(props, ref) {
    const {...rest} = props

    return (
      <Root
        ref={ref}
        {...rest}
      />
    )
  },
)
SnackbarContent.displayName = 'SnackbarContent'
SnackbarContent.aglyn = true


export {SnackbarContent}
export default SnackbarContent
