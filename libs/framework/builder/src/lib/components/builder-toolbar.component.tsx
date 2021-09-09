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

import { createElementData, useElementsContext } from '@aglyn/framework/renderer'
import { SvgPathIcon } from '@aglyn/shared/ui/react'
import { styled } from '@aglyn/shared/ui/themes'
import AppBar, { AppBarProps } from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Fab from '@mui/material/Fab'
import IconButton from '@mui/material/IconButton'
import Toolbar from '@mui/material/Toolbar'
import { forwardRef, useCallback } from 'react'
import { useElementDrawerContext } from '../contexts/element-drawer-context'


const StyledFab = styled(Fab, {
  name: 'FabButton',
})({
  position: 'absolute',
  zIndex: 1,
  top: -30,
  left: 0,
  right: 0,
  margin: '0 auto',
})

const StyledAppBar = styled(AppBar, {
  name: 'AppBar',
})({
  top: 'auto',
  bottom: 0,
})

export interface BuilderToolbarComponentProps extends Partial<AppBarProps> {}

export const BuilderToolbarComponent = forwardRef<any, BuilderToolbarComponentProps>(
  function RefRenderFn(props, ref) {
    const {className, ...rest} = props

    const {elementDrawer} = useElementDrawerContext()
    const {elements, updateElements} = useElementsContext()
    const handleFabClick = useCallback(async () => {
      const option = await elementDrawer({
        title: 'Add New Elements',
      })
      .then((res: any) => {
        if (res?.option?.type === 'selection') {
          return res?.option?.data
        }
      })
      .then((data: any) => {
        if (data) {
          const {id: componentId} = data
          const prevElements = Array.from(elements)
          const newElements = [...elements, createElementData(componentId)]
          console.log('prev newElement', newElements, prevElements)
          updateElements && updateElements(newElements, prevElements)
        }
      })
      .catch((error) => {
        if (error instanceof Error) {
          console.log('errror', error)
        }
      })

      console.warn('async choice', option)
    }, [elementDrawer, elements, updateElements])

    return (
      <StyledAppBar
        ref={ref}
        position="fixed"
        color="primary"
        {...rest}
      >
        <Toolbar>
          <IconButton edge="start" color="inherit" aria-label="open drawer">
            <SvgPathIcon iconId={'menu'}/>
          </IconButton>
          <StyledFab
            color="secondary"
            aria-label="add"
            onClick={handleFabClick}
          >
            <SvgPathIcon iconId={'plus'}/>
          </StyledFab>
          <Box sx={{flexGrow: 1}}/>
          <IconButton color="inherit">
            <SvgPathIcon iconId={'search'}/>
          </IconButton>
          <IconButton edge="end" color="inherit">
            <SvgPathIcon iconId={'more'}/>
          </IconButton>
        </Toolbar>
      </StyledAppBar>
    )
  },
)

BuilderToolbarComponent.displayName = 'BuilderToolbarComponent'
BuilderToolbarComponent.defaultProps = {}

export default BuilderToolbarComponent
