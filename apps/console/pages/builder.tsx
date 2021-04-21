import React, { useState } from 'react'
import Website from '@aglyn/website/feature-core'
import { FeatureReact } from '@aglyn/website/feature-react'

/* eslint-disable-next-line */
export interface BuilderProps {}

const Root = ({children, ...props}) => <div data-cid={'root'} {...props}>{children}</div>

Website.app.App.setComponent({
  moduleId: 'react',
  _id: 'root',
  ctor: Root
})

export function Builder(props: BuilderProps) {
  const [elements, setElements] = useState([
    {
      _id: 'root',
      component: 'root',
      props: {
        children: 'hello'
      },
      children: [
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        }
      ]
    },
    {
      _id: 'root',
      component: 'root',
      props: {
        children: 'hello'
      },
      children: [
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        }
      ]
    },
    {
      _id: 'root',
      component: 'root',
      props: {
        children: 'hello'
      },
      children: [
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        },
        {
          _id: 'root',
          component: 'root',
          props: {
            children: 'hello'
          }
        }
      ]
    },
  ])

  console.log('page:/builder', Website.app.App.getInstance())
  return (
    <FeatureReact elements={elements} />
  )
}

export default Builder
