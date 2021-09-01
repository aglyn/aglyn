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

import { AglynComponentData } from '@aglyn/framework/sdk'
import { ConfirmationProviderComponent, OverrideableComponentProps } from '@aglyn/shared/ui/react'
import { builderTheme, withThemeProvider } from '@aglyn/shared/ui/themes'
import NoSsr from '@material-ui/core/NoSsr'
import { forwardRef, Fragment } from 'react'
import ElementDrawerContextProvider, { ElementDrawerContextProviderProps } from '../contexts/element-drawer-context.provider'
import ElementsContextProvider, { ElementsContextProviderProps } from '../contexts/elements-context-provider'
import SelectionContextProvider from '../contexts/selection-context-provider'
import { AppbarComponent } from './appbar.component'
import { BuilderCanvasRendererComponent } from './builder-canvas-renderer.component'


export interface BuilderComponentProps extends OverrideableComponentProps {
  noSsr?: boolean
  elements?: AglynComponentData[]
  onUpdateElements?: ElementsContextProviderProps['onUpdateElements']
  elementComponents: ElementDrawerContextProviderProps['elementComponents']
}

export const BuilderComponent = forwardRef<any, BuilderComponentProps>(
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
            {/*<SnackbarProvider maxSnack={3}>*/}
            <ConfirmationProviderComponent>
              <SelectionContextProvider>
                <ElementDrawerContextProvider elementComponents={elementComponents}>
                  <BuilderCanvasRendererComponent/>

                  <AppbarComponent id="aglyn:toolbar"/>
                </ElementDrawerContextProvider>
              </SelectionContextProvider>
            </ConfirmationProviderComponent>
            {/*</SnackbarProvider>*/}
          </ElementsContextProvider>
        </Component>
      </Wrapper>
    )
  },
)

BuilderComponent.displayName = 'BuilderComponent'
BuilderComponent.defaultProps = {
  component: 'div',
  elements: [],
}

export default withThemeProvider(builderTheme)(BuilderComponent)
