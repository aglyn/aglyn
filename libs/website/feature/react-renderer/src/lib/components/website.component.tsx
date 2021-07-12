/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { forwardRef } from 'react'
import { Website } from '@aglyn/website/core'
import ElementComponent, { ElementComponentProps } from './element.component'
import { ComponentProp } from '@aglyn/shared/ui/react'
import ElementsComponent from './elements.component'


export interface WebsiteComponentProps extends ComponentProp {
  elements?: Website.ElementData[]
  elementComponent?: ElementComponentProps['elementComponent']
}

const WebsiteComponent = forwardRef<any, WebsiteComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      elementComponent,
      elements,
      ...rest
    } = props
    return (
      <Component ref={ref} {...rest}>
        <ElementsComponent
          children={elements}
          elementComponent={elementComponent}
        />
      </Component>
    )
  },
)

WebsiteComponent.displayName = 'WebsiteComponent'
WebsiteComponent.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default WebsiteComponent
