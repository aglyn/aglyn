/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ComponentProp, ConfirmationProviderComponent } from '@aglyn/shared/ui/react'
import { builder } from '@aglyn/shared/ui/themes'
import { Website } from '@aglyn/website/core'
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
  elements?: Website.ElementData[]
  elementComponent?: ElementComponentProps['component']
}

export const BuilderComponent = forwardRef<any, BuilderComponentProps>(function RefRenderFn(
  props,
  ref
) {
  const { component: Component, elementComponent, elements, ...rest } = props

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
                      {({ elements }) => (
                        <WebsiteComponent elements={elements} elementComponent={elementComponent} />
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
