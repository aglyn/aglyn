/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { WebsiteComponent } from '@aglyn/website/feature/react-renderer'
import { forwardRef } from 'react'
import { Website } from '@aglyn/website/core'
import { ElementComponent, ElementComponentProps } from './components/element.component'
import { ConfirmationProviderComponent, ComponentProp } from '@aglyn/shared/ui/react'


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
        <ConfirmationProviderComponent>
          <WebsiteComponent
            elements={elements}
            elementComponent={elementComponent}
          />
        </ConfirmationProviderComponent>
      </Component>
    )
  }
)

BuilderComponent.displayName = 'BuilderComponent'
BuilderComponent.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default BuilderComponent
