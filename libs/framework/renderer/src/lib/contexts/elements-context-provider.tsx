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
import { ReactNode, useState } from 'react'
import { ElementsContext, ElementsContextType } from './elements-context'


export interface ElementsContextProviderProps {
  children?: ReactNode
  elements?: AglynComponentData[]
  onUpdateElements?: (
    newElements: AglynComponentData[],
    prevElements: AglynComponentData[],
  ) => void
}

export function ElementsContextProvider(props: ElementsContextProviderProps) {
  const {children, elements, onUpdateElements} = props
  const [ctx, setCtx] = useState<ElementsContextType>(({
    elements,
    updateElements: (elements, prev) => {
      onUpdateElements && onUpdateElements(elements, prev)
      setCtx(prev=>({...prev, elements}))
    }
  }))

  return (
    <ElementsContext.Provider value={ctx}>
      {children}
    </ElementsContext.Provider>
  )
}
ElementsContextProvider.displayName = 'ElementsContextProvider'
ElementsContextProvider.defaultProps = {
  elements: [],
}
export default ElementsContextProvider
