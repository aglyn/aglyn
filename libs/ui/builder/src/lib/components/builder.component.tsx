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

import { AglynComponentElementData } from '@aglyn/data-components'
import { IAglynApp } from '@aglyn/data-framework'
import { builderTheme, withTheme } from '@aglyn/shared-feature-themes'
import { ConfirmationProviderComponent, OverrideableComponentProps } from '@aglyn/shared-ui-jsx'
import {
  ElementComponentsContextProvider,
  ElementsContextProvider,
  ElementsContextProviderProps,
} from '@aglyn/ui-renderer'
import NoSsr from '@mui/material/NoSsr'
import { forwardRef, Fragment } from 'react'
import { AglynAppContext } from '../../../../renderer/src/lib/contexts/aglyn-app-context'
import { ComponentsDrawerContextProvider } from '../contexts/components-drawer-context.provider'
import { SelectionContextProvider } from '../contexts/selection-context-provider'
import { BuilderCanvasRendererComponent } from './builder-canvas-renderer.component'
import { BuilderToolbarComponent } from './builder-toolbar.component'


export interface BuilderComponentProps extends OverrideableComponentProps {
  noSsr?: boolean
  elements?: AglynComponentElementData[]
  onUpdateElements?: ElementsContextProviderProps['onUpdateElements']
  appCallback: () => IAglynApp
}


const BuilderComponentRaw = forwardRef<any, BuilderComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elements,
      onUpdateElements,
      noSsr,
      appCallback: getApp,
      ...rest
    } = props
    const Wrapper = noSsr ? NoSsr : Fragment

    return (
      <Wrapper>
        <AglynAppContext.Provider value={{getApp}}>
          <ElementComponentsContextProvider>
            <ElementsContextProvider elements={elements} onUpdateElements={onUpdateElements}>
              <Component ref={ref} id="aglyn:builder" {...rest}>
                {/*<SnackbarProvider maxSnack={3}>*/}
                <ConfirmationProviderComponent>
                  <SelectionContextProvider>
                    <BuilderCanvasRendererComponent/>

                    <ComponentsDrawerContextProvider>
                      <BuilderToolbarComponent id="aglyn:toolbar"/>
                    </ComponentsDrawerContextProvider>
                  </SelectionContextProvider>
                </ConfirmationProviderComponent>
                {/*</SnackbarProvider>*/}
              </Component>
            </ElementsContextProvider>
          </ElementComponentsContextProvider>
        </AglynAppContext.Provider>
      </Wrapper>
    )
  },
)

BuilderComponentRaw.displayName = 'BuilderComponent'
BuilderComponentRaw.defaultProps = {
  component: 'div',
  elements: [],
}

export const BuilderComponent = withTheme({theme: builderTheme})(BuilderComponentRaw)

export default BuilderComponent
