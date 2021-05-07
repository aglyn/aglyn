/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, { forwardRef } from 'react'
import Website, { handleResolveProps } from '@aglyn/website/core'
import { _isArr, _isArrEmpty, _isStr, yes } from '@aglyn/shared/util/helpers'
import * as ReactIs from 'react-is'
import ElementsComponent from './elements.component'


export interface ElementComponentProps {
  elementData: Website.ElementData
  elementComponent?: React.ComponentType<ElementComponentProps>
  [prop: string]: any
}

export const ElementComponent = forwardRef<any, ElementComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      elementData: data,
      elementComponent,
      ...rest
    } = props

    const component = !_isStr(data?.component)
      ? (data?.component as Website.Component)
      : Website.App.getComponent({ moduleId: 'react', componentId: data?.component })
    const { ctor, metadata = {} } = component ?? {}
    const resolvedProps = handleResolveProps(data?.props, metadata, component)
    const { children: content = null, ...ctorProps } = resolvedProps
    const ComponentCtor = ReactIs.isValidElementType(ctor) ? ctor : 'div'
    const haveChildren = yes(!_isArr(data?.children) || _isArrEmpty(data?.children))

    return (
      <ComponentCtor innerRef={ref} {...ctorProps} {...rest}>
        {haveChildren ? content : (
          <ElementsComponent
            elementComponent={elementComponent}
            children={data?.children}
          />
        )}
      </ComponentCtor>
    )
  }
)

ElementComponent.displayName = 'ElementComponent'
ElementComponent.defaultProps = {
  elementComponent: ElementComponent,
}

export default ElementComponent
