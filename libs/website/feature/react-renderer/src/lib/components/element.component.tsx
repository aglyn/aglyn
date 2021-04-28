/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import Website, { handleResolveProps } from '@aglyn/website/core'
import { _isArr, _isArrEmpty, _isStr, yes } from '@aglyn/shared/util/helpers'
import * as ReactIs from 'react-is'
import ElementsComponent from './elements.component'


export interface ElementComponentProps {
  elementData: Website.ElementData
  childrenComponent?: React.ComponentType<ElementComponentProps>
}

export function ElementComponent(props: ElementComponentProps) {
  const { elementData: data, childrenComponent: ChildrenComponent } = props
  const component = !_isStr(data?.component)
    ? (data?.component as Website.Component)
    : Website.App.getComponent({ moduleId: 'react', componentId: data?.component })
  const { ctor, metadata = {} } = component ?? {}
  const resolvedProps = handleResolveProps(data?.props, metadata, component)
  const { children: content = null, ...ctorProps } = resolvedProps
  const ComponentCtor = ReactIs.isValidElementType(ctor) ? ctor : 'div'
  const haveChildren = yes(!_isArr(data?.children) || _isArrEmpty(data?.children))
  return (
    <ComponentCtor {...ctorProps}>
      {haveChildren ? content : (
        <ElementsComponent
          childrenComponent={ChildrenComponent}
          children={data?.children}
        />
      )}
    </ComponentCtor>
  )
}

ElementComponent.defaultProps = {
  childrenComponent: ElementComponent,
}

export default ElementComponent
