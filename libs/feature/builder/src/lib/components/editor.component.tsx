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

import {
  consoleThemeDark,
  consoleThemeLight,
  styled,
  withTheme,
} from '@aglyn/shared-feature-themes'
import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx'
import Stack, { StackProps } from '@mui/material/Stack'
import { forwardRef } from 'react'
import { ComponentsDrawerContextProvider } from '../contexts/components-drawer-context.provider'
import { AppBarGlobalComponent } from './app-bar-global.component'
import { AppBarModifyComponent } from './app-bar-modify.component'
import { ToolboxLeftComponent } from './toolbox-left.component'
import { ViewportRootComponent } from './viewport-root.component'


const Editor = styled(Stack, {name: 'Editor'})({
  position: 'absolute',
  left: 0, right: 0, top: 0, bottom: 0,
  height: '100%', width: '100%',
  overflow: 'hidden',
})

export interface EditorComponentProps extends StackProps {

}

const EditorComponentRaw = forwardRef<any, EditorComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <>
        {/*<SnackbarProvider maxSnack={3}>*/}
        <ConfirmationProviderComponent>
          <ComponentsDrawerContextProvider>

            <Editor
              ref={ref}
              id="aglyn:builder"
              direction="column"
              alignContent="stretch"
              alignItems="stretch"
              spacing={0}
              {...rest}
            >
              <Stack
                direction="column"
                justifyContent="flex-start"
                alignItems="stretch"
                spacing={0}
                sx={{
                  zIndex: 1,
                }}
              >
                <AppBarGlobalComponent
                  id="aglyn:builder-appbar-global"
                  aria-label="builder application toolbar global"
                />
                <AppBarModifyComponent
                  id="aglyn:builder-appbar-modify"
                  aria-label="builder application modifier toolbar"
                />
              </Stack>

              <Stack
                direction="row"
                alignItems="stretch"
                flexGrow={1}
                spacing={0}
                sx={{
                  overflow: 'hidden',
                  zIndex: 0,
                }}
              >
                <ToolboxLeftComponent
                  id="aglyn:builder-toolbox-left"
                  aria-label="builder toolbox left"
                />

                <ViewportRootComponent
                  id="aglyn:builder-viewport"
                  aria-label="builder viewport"
                  direction="column"
                  alignItems="center"
                  spacing={0}
                />
              </Stack>

              {children}
            </Editor>

          </ComponentsDrawerContextProvider>
        </ConfirmationProviderComponent>
        {/*</SnackbarProvider>*/}
      </>
    )
  },
)

EditorComponentRaw.displayName = 'EditorComponent'
EditorComponentRaw.defaultProps = {}

export const EditorComponent = withTheme({
  theme: [consoleThemeLight, consoleThemeDark],
})(EditorComponentRaw)
export default EditorComponent
