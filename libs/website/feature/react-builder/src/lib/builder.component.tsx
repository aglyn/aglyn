/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ComponentProp, ConfirmationProviderComponent, themes } from '@aglyn/shared/ui/react'
import { Website } from '@aglyn/website/core'
import { WebsiteComponent } from '@aglyn/website/feature/react-renderer'
import { ThemeProvider } from '@material-ui/core/styles'
import { forwardRef } from 'react'
import { ElementComponent, ElementComponentProps } from './components/element.component'
import SelectionProviderComponent from './contexts/selection'


export interface BuilderComponentProps extends ComponentProp {
  elements?: Website.ElementData[]
  elementComponent?: ElementComponentProps['component']
}

export const BuilderComponent = forwardRef<any, BuilderComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elementComponent,
      elements,
      ...rest
    } = props

    return (
      <Component ref={ref} {...rest}>
        <ThemeProvider theme={themes.console}>
          <SelectionProviderComponent>
            <ConfirmationProviderComponent>
              <WebsiteComponent
                elements={elements}
                elementComponent={elementComponent}
              />
            </ConfirmationProviderComponent>
          </SelectionProviderComponent>
        </ThemeProvider>
      </Component>
    )
  },
)

BuilderComponent.displayName = 'BuilderComponent'
BuilderComponent.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default BuilderComponent
