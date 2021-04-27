/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import Website from '@aglyn/website/core'
import { ElementComponent, ElementComponentProps } from './element.component'

/* eslint-disable-next-line */
export interface FeatureReactProps {
  component?: any
  elements?: Website.ElementData[]
  elementComponent?: ElementComponentProps['childrenComponent']
}

export function WebsiteComponent(props: FeatureReactProps) {
  const { component: Wrapper, elementComponent: Component, elements, ...rest } = props
  return (
    <Wrapper {...rest}>
      {elements.map((data) => (
        <Component key={data.$id} elementData={data} childrenComponent={Component} />
      ))}
    </Wrapper>
  )
}

WebsiteComponent.defaultProps = {
  component: React.Fragment,
  elementComponent: ElementComponent,
  elements: [],
}

export default WebsiteComponent
