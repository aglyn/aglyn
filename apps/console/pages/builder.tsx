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

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  aglynComponent, AglynComponentData,
  getAllComponents,
  getApp,
  registerComponent,
} from '@aglyn/framework/sdk'
import { BuilderComponent } from '@aglyn/framework/builder'
import { samplePageData } from '../constants/sample-data'


const Root = aglynComponent('root', {
  displayName: 'Root Element',
  title: 'Root element',
  icon: 'block',
})('span')

registerComponent(getApp(), Root)

function Builder(props) {
  if (typeof document !== 'undefined') {
    console.log('page:/builder app', getApp())
  }

  const [elements, setElements] = useState<AglynComponentData[]>(samplePageData)
  const elementComponents = useMemo(() => {
    return getAllComponents(getApp()).map(([, element]) => ({
      id: element?.$id,
      title: element?.options?.title,
      icon: element?.options?.icon,
    }))
  }, [])

  const handleUpdateElements = useCallback((elements: AglynComponentData[]) => {
    setElements(elements)
  }, []);


  return (
    <BuilderComponent
      elements={elements}
      onUpdateElements={handleUpdateElements}
      elementComponents={elementComponents}
    />
  )
}

Builder.displayName = 'Page-Builder'

export default Builder
