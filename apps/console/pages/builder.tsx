/**
 * @license
 * Copyright 2021 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useMemo, useState } from 'react'
import { aglynComponent, getAllComponents, getApp, registerComponent } from '@aglyn/framework/sdk'
import { BuilderComponent } from '@aglyn/framework/builder'
import { samplePageData } from '../constants/sample-data'


const Root = aglynComponent('root', {
  title: 'Root element',
  icon: 'block',
})(
  ({children, innerRef, ...props}) => (
    <span ref={innerRef} {...props}>{children}</span>
  ),
)

registerComponent(getApp(), {component: Root})

export interface BuilderProps {}

export function Builder(props: BuilderProps) {
  const [elements, setElements] = useState(samplePageData)
  const elementComponents = useMemo(() => {
    return getAllComponents(getApp()).map(([, element]) => ({
      id: element?.$id,
      title: element?.options?.title,
      icon: element?.options?.icon,
    }))
  }, [])

  console.log('page:/builder app', getApp())
  return <BuilderComponent
    elements={elements}
    elementComponents={elementComponents}
  />
}

export default Builder
