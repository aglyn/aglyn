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

import { AglynComponentData } from '@aglyn/framework/sdk'
import ElementsContext, { ElementsContextType } from './elements-context'
import { ReactNode, useState } from 'react'

export interface ElementsContextProviderProps {
  children?: ReactNode
  elements?: AglynComponentData[]
  onUpdateElements?: (
    newElements: AglynComponentData[],
    prevElements: AglynComponentData[]
  ) => void
}

function ElementsContextProvider(props: ElementsContextProviderProps) {
  const { children, elements, onUpdateElements } = props
  const [ctx, setElement] = useState<ElementsContextType>({
    elements,
    updateElements: (elements) => {
      setElement(prev => {
        const prevElements = Array.from(prev.elements)
        onUpdateElements?.call(null, elements, prevElements)
        return {...prev, elements}
      })
    }
  })

  return (
    <ElementsContext.Provider value={ctx}>
      {children}
    </ElementsContext.Provider>
  )
}

ElementsContextProvider.defaultProps = {
  elements: [],
}
export default ElementsContextProvider
