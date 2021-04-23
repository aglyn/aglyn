/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, { useState } from 'react'
import Website from '@aglyn/website/core'
import { WebsiteComponent } from '@aglyn/website/feature/react'

/* eslint-disable-next-line */
export interface BuilderProps {}

const Root = ({ children, ...props }) => <span {...props}>{children}</span>

Website.App.setComponent({
  moduleId: 'react',
  $id: 'root',
  ctor: Root,
})

export function Builder(props: BuilderProps) {
  const [elements, setElements] = useState([
    {
      $id: 'root1',
      component: 'root',
      props: {
        children: 'hello',
      },
      children: [
        {
          $id: 'root1',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root2',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root3',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
      ],
    },
    {
      $id: 'root2',
      component: 'root',
      props: {
        children: 'hello',
      },
      children: [
        {
          $id: 'root1',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root2',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root3',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
      ],
    },
    {
      $id: 'root3',
      component: 'root',
      props: {
        children: 'hello',
      },
      children: [
        {
          $id: 'root1',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root2',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
        {
          $id: 'root3',
          component: 'root',
          props: {
            children: 'hello',
          },
        },
      ],
    },
  ])

  console.log('page:/builder', Website.App.getInstance())
  return <WebsiteComponent elements={elements} />
}

export default Builder
