/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import { ComponentProp } from '@aglyn/shared/ui/react'
import { Website } from '@aglyn/website/core'
import { ElementComponent, ElementComponentProps } from './components/element.component'
import { WebsiteComponent } from './components/website.component'

/* eslint-disable-next-line */
export interface ReactRendererProps extends ComponentProp, HTMLElement {
  elements?: Website.ElementData[]
  elementComponent?: ElementComponentProps['childrenComponent']
}

export function ReactRenderer(props: ReactRendererProps) {
  const {
    component: Component,
    elementComponent,
    elements,
    ...rest
  } = props
  return (
    <Component {...rest}>
      <WebsiteComponent
        elements={elements}
        elementComponent={elementComponent}
      />
    </Component>
  )
}

ReactRenderer.defaultProps = {
  component: 'div',
  elementComponent: ElementComponent,
  elements: [],
}

export default ReactRenderer
