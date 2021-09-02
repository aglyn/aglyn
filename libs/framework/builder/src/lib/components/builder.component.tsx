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
  ElementComponentsContextProvider,
  ElementsContextProvider,
  ElementsContextProviderProps,
} from '@aglyn/framework/renderer'
import { AglynComponent, AglynComponentData } from '@aglyn/framework/sdk'
import { ConfirmationProviderComponent, OverrideableComponentProps } from '@aglyn/shared/ui/react'
import { builderTheme, consoleTheme, withTheme } from '@aglyn/shared/ui/themes'
import NoSsr from '@material-ui/core/NoSsr'
import { forwardRef, Fragment } from 'react'
import { ComponentsDrawerContextProvider } from '../contexts/components-drawer-context.provider'
import { SelectionContextProvider } from '../contexts/selection-context-provider'
import { BuilderCanvasRendererComponent } from './builder-canvas-renderer.component'
import { BuilderToolbarComponent } from './builder-toolbar.component'


export interface BuilderComponentProps extends OverrideableComponentProps {
  noSsr?: boolean
  elements?: AglynComponentData[]
  onUpdateElements?: ElementsContextProviderProps['onUpdateElements']
  elementComponents: AglynComponent[]
}

const BuilderComponentRaw = forwardRef<any, BuilderComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elements,
      onUpdateElements,
      elementComponents,
      noSsr,
      ...rest
    } = props
    const Wrapper = noSsr ? NoSsr : Fragment

    return (
      <Wrapper>
        <Component ref={ref} id="aglyn:builder" {...rest}>
          <ElementsContextProvider
            elements={elements}
            onUpdateElements={onUpdateElements}
          >
            <ElementComponentsContextProvider
              elementComponents={elementComponents}
            >
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
            </ElementComponentsContextProvider>
          </ElementsContextProvider>
        </Component>
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
