/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, { useState } from 'react'
import Website from '@aglyn/website/core'
import { BuilderComponent } from '@aglyn/website/feature/builder'
import { samplePageData } from '../constants/sample-data'

const Root = ({ children, innerRef, ...props }) => (
  <span ref={innerRef} {...props}>
    {children}
  </span>
)
Website.App.setComponent({
  moduleId: 'react',
  $id: 'root',
  ctor: Root,
  metadata: {
    title: 'Root element',
    icon: 'block',
  },
})

export interface BuilderProps {}

export function Builder(props: BuilderProps) {
  const [elements, setElements] = useState(samplePageData)

  console.log('page:/builder', Website.App.getInstance())
  return <BuilderComponent elements={elements} />
}

export default Builder
