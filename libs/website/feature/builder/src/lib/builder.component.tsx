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

import { ComponentProp, ConfirmationProviderComponent } from '@aglyn/shared/ui/react'
import { builder } from '@aglyn/shared/ui/themes'
import { ElementData } from '@aglyn/website/core'
import { WebsiteComponent } from '@aglyn/website/feature/renderer'
import { ThemeProvider } from '@material-ui/core/styles'
import { forwardRef } from 'react'
import ElementComponent, { ElementComponentProps } from './components/element.component'
import AppBarComponent from './components/appbar.component'
import ElementDrawerProviderComponent from './contexts/element-drawer-provider.component'
import SelectionProviderComponent from './contexts/selection-provider.component'
import NoSsr from '@material-ui/core/NoSsr'
import ElementsProviderComponent from './contexts/elements-provider.component'
import ElementsContext from './contexts/elements.context'
import { SnackbarProvider } from 'notistack'


export interface BuilderComponentProps extends ComponentProp {
  elements?: ElementData[]
  elementComponent?: ElementComponentProps['component']
}

export const BuilderComponent = forwardRef<any, BuilderComponentProps>(function RefRenderFn(
  props,
  ref,
) {
  const {component: Component, elementComponent, elements, ...rest} = props

  return (
    <NoSsr>
      <ThemeProvider theme={builder}>
        <Component ref={ref} {...rest}>
          <ElementsProviderComponent elements={elements}>
            <SnackbarProvider maxSnack={3}>
              <ConfirmationProviderComponent>
                <SelectionProviderComponent>
                  <ElementDrawerProviderComponent>
                    <ElementsContext.Consumer>
                      {({elements}) => (
                        <WebsiteComponent
                          elements={elements}
                          elementComponent={elementComponent}
                        />
                      )}
                    </ElementsContext.Consumer>

                    <AppBarComponent />
                  </ElementDrawerProviderComponent>
                </SelectionProviderComponent>
              </ConfirmationProviderComponent>
            </SnackbarProvider>
          </ElementsProviderComponent>
        </Component>
      </ThemeProvider>
    </NoSsr>
  )
})

BuilderComponent.displayName = 'BuilderComponent'
BuilderComponent.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default BuilderComponent
