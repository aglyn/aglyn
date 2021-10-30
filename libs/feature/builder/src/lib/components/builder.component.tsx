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
  AglynAppController,
  AglynComponentElementData,
  AppUUN,
  getApp,
} from '@aglyn/core-data-framework'
import {
  AglynAppContext,
  ElementComponentsContextProvider,
  ElementsContextProvider,
  ElementsContextProviderProps,
} from '@aglyn/feature-renderer'
import { consoleTheme, withTheme } from '@aglyn/shared-feature-themes'
import { ConfirmationProviderComponent, OverrideableComponentProps } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import NoSsr from '@mui/material/NoSsr'
import { forwardRef, Fragment, useCallback } from 'react'
import { ComponentsDrawerContextProvider } from '../contexts/components-drawer-context.provider'
import HoverContextProvider from '../contexts/hover-context-provider'
import SelectionContextProvider from '../contexts/selection-context-provider'
import { BuilderCanvasRendererComponent } from './builder-canvas-renderer.component'
import { BuilderToolbarComponent } from './builder-toolbar.component'


export interface BuilderComponentProps extends OverrideableComponentProps {
  noSsr?: boolean
  appName?: AppUUN
}

const BuilderComponentRaw = forwardRef<any, BuilderComponentProps>(function RefRenderFn(
  props,
  ref,
) {
  const {
    elements,
    onUpdateElements,
    noSsr,
    appName,
    ...rest
  } = props
  const Wrapper = noSsr ? NoSsr : Fragment
  const appCallback = useCallback(() => getApp(appName), [appName])
  if (typeof document !== 'undefined') {
    console.log('page:/builder app', appCallback())
  }

  return (
    <Wrapper>
      <AglynAppContext.Provider value={{getApp}}>
        <ElementComponentsContextProvider>
          <ElementsContextProvider elements={elements} onUpdateElements={onUpdateElements}>
            {/*<SnackbarProvider maxSnack={3}>*/}
            <ConfirmationProviderComponent>
              <HoverContextProvider>
                <SelectionContextProvider>
                  <ComponentsDrawerContextProvider>
                    <Box ref={ref} id="aglyn:builder" {...rest}>
                      <BuilderToolbarComponent id="aglyn:builder-toolbar">
                        <BuilderCanvasRendererComponent/>
                      </BuilderToolbarComponent>

                    </Box>
                  </ComponentsDrawerContextProvider>
                </SelectionContextProvider>
              </HoverContextProvider>
            </ConfirmationProviderComponent>
            {/*</SnackbarProvider>*/}
          </ElementsContextProvider>
        </ElementComponentsContextProvider>
      </AglynAppContext.Provider>
    </Wrapper>
  )
})

BuilderComponentRaw.displayName = 'BuilderComponent'
BuilderComponentRaw.defaultProps = {
  component: 'div',
  elements: [],
}

export const BuilderComponent = withTheme({theme: consoleTheme})(BuilderComponentRaw)

export default BuilderComponent
