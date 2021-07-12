/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { Fragment, forwardRef } from 'react'
import Website from '@aglyn/website/core'
import ElementComponent, { ElementComponentProps } from './element.component'
import { ComponentProp } from '@aglyn/shared/ui/react'

export interface ElementsComponentProps extends ComponentProp {
  elementComponent?: ElementComponentProps['elementComponent']
  children?: Website.ElementData[]
}

const ElementsComponent = forwardRef<any, ElementsComponentProps>(function RefRenderFn(props, ref) {
  const { component: Component, elementComponent: ElementComponent, children, ...rest } = props
  return (
    <Component ref={ref} {...rest}>
      {children.map((data, i) => (
        <ElementComponent
          key={data?.$id ?? i}
          elementData={data}
          elementComponent={ElementComponent}
        />
      ))}
    </Component>
  )
})

ElementsComponent.displayName = 'ElementsComponent'
ElementsComponent.defaultProps = {
  component: Fragment,
  elementComponent: ElementComponent,
  children: [],
}

export default ElementsComponent
