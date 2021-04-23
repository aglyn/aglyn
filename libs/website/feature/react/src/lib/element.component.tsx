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

/* eslint-disable-next-line */
export interface ElementComponentProps {
  elementData: Website.ElementData
  childrenComponent?: React.ComponentType<ElementComponentProps>
}

export function ElementComponent(props: ElementComponentProps) {
  const { elementData, childrenComponent: ChildrenComponent } = props
  const { children, component: cIdOrData } = elementData
  const component: Website.Component = !_isStr(cIdOrData)
    ? (cIdOrData as Website.Component)
    : Website.App.getComponent({
        moduleId: 'react',
        componentId: cIdOrData,
      })
  const { ctor, metadata } = component
  const { defaultProps, resolveProps: metaResolve } = metadata ?? {}
  const resolveProps = _isFn(metaResolve) ? metaResolve : (p) => p
  const { children: content = null, ...ctorProps } = resolveProps.call(
    component,
    deepMerge(defaultProps, elementData.props)
  )
  const ComponentCtor = ReactIs.isValidElementType(ctor) ? ctor : 'div'
  return (
    <ComponentCtor {...ctorProps}>
      {!_isArr(children) || _isArrEmpty(children)
        ? content
        : children.map((data) => (
            <ChildrenComponent key={data.$id} childrenComponent={ChildrenComponent} elementData={data} />
          ))}
    </ComponentCtor>
  )
}

ElementComponent.defaultProps = {
  childrenComponent: ElementComponent,
}

export default ElementComponent
