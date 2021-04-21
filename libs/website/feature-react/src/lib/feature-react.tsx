import React from 'react'
import Website from '@aglyn/website/feature-core'
import {ElementComponent} from './element-component'

/* eslint-disable-next-line */
export interface FeatureReactProps {
  component?: any
  elements?: Website.core.DataElement[]
  elementComponent?: any
}

export function FeatureReact(props: FeatureReactProps) {
  const {
    component: Component,
    elementComponent: ElementComponent,
    elements,
    ...rest
  } = props
  return (
    <Component {...rest}>
      {elements.map(data => (
        <ElementComponent
          data={data}
          elementComponent={ElementComponent}
        />
      ))}
    </Component>
  )
}

FeatureReact.defaultProps = {
  component: React.Fragment,
  elementComponent: ElementComponent,
  elements: []
}

export default FeatureReact
