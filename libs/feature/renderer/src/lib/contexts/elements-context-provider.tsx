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

import { AglynComponentElementData, getContextStore } from '@aglyn/core-data-framework'
import { createApi } from 'effector'
import { useStore } from 'effector-react'
import { ReactNode } from 'react'
import { useAglynAppContext } from './aglyn-app-context'
import { ElementsContext } from './elements-context'


export interface ElementsContextProviderProps {
  children?: ReactNode
  onUpdateElements?: (
    prevElements: AglynComponentElementData[],
    newElements: AglynComponentElementData[],
  ) => void
}

export function ElementsContextProvider(props: ElementsContextProviderProps) {
  const {children, onUpdateElements} = props
  const {getApp} = useAglynAppContext()

  const store = getContextStore(getApp(), {storeId: 'elements'})
  const {updateElements} = createApi(store, {
    updateElements: (prevElements, newElements) => {
      // event && event(prevElements, newElements)
      onUpdateElements && onUpdateElements(prevElements as any, newElements)
      return newElements
    },
  })
  const elements = useStore(store)


  return (
    <ElementsContext.Provider value={{elements, updateElements} as any}>
      {children}
    </ElementsContext.Provider>
  )
}
ElementsContextProvider.displayName = 'ElementsContextProvider'
ElementsContextProvider.defaultProps = {
  elements: [],
}
export default ElementsContextProvider
