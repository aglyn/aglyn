/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import Website from '@aglyn/website/core'
import { _isArr, _isArrEmpty, _isFn, _isStr, deepMerge } from '@aglyn/shared/util/helpers'
import * as ReactIs from 'react-is'


export interface ElementComponentProps {
  elementData: Website.ElementData
  childrenComponent?: React.ComponentType<ElementComponentProps>
}

export function ElementComponent(props: ElementComponentProps) {
  const { elementData, childrenComponent: ChildrenComponent } = props
  const { children, component: cIdOrData } = elementData
  const component = !_isStr(cIdOrData)
    ? (cIdOrData as Website.Component)
    : Website.App.getComponent({ moduleId: 'react', componentId: cIdOrData })
  const { ctor, metadata } = component
  const { defaultProps, resolveProps } = metadata ?? {}
  const propsResolver = _isFn(resolveProps) ? resolveProps : (p) => p
  const mergedProps = deepMerge(defaultProps, elementData.props)
  const resolvedProps = propsResolver.call(component, mergedProps)
  const { children: content = null, ...ctorProps } = resolvedProps
  const ComponentCtor = ReactIs.isValidElementType(ctor) ? ctor : 'div'
  return (
    <ComponentCtor {...ctorProps}>
      {
        (!_isArr(children) || _isArrEmpty(children))
          ? content
          : children.map((data) => (
            <ChildrenComponent
              key={data.$id}
              childrenComponent={ChildrenComponent}
              elementData={data}
            />
          ))
      }
    </ComponentCtor>
  )
}

ElementComponent.defaultProps = {
  childrenComponent: ElementComponent,
}

export default ElementComponent
