import React from 'react'
import Website from '@aglyn/website/feature-core'
import { _isStr } from '@aglyn/shared/util'

/* eslint-disable-next-line */
export interface ElementComponentProps {
  data: Website.core.DataElement
  elementComponent: any
}

export function ElementComponent(props: ElementComponentProps) {
  const {
    data,
    elementComponent: ElementComponent
  } = props
  const { children = [], component } = data
  let Component: any = component
  if (_isStr(Component)) {
    Component = Website.app.App.getComponent({moduleId: 'react', componentId: Component })
  }
  const resolveProps = Component?.metadata?.resolveProps ?? ((p) => p)
  const { children: content = null, ...cProps } = {
    ...Component?.metadata?.defaultProps,
    ...data.props,
  }
  const CompCtor = Component?.ctor ?? 'div'
  return (
    <CompCtor {...resolveProps.call(cProps)}>
      {content}
      {children.map(data => (
        <ElementComponent data={data}/>
      ))}
    </CompCtor>
  )
}

ElementComponent.defaultProps = {
  elementComponent: ElementComponent
}

export default ElementComponent
