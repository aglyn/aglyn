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
import { createContext, useContext } from 'react'


export type UseElementsContextType = () => ElementsContextType

export interface ElementsContextType {
  elements: AglynComponentData[]
  updateElements?: (
    newElements: AglynComponentData[],
    prevElements: AglynComponentData[],
  ) => void
}

export const DEFAULT_ELEMENTS_CONTEXT: ElementsContextType = {
  elements: [],
  // updateElements: ((prev) => prev),
}
export const ElementsContext = createContext<ElementsContextType>(DEFAULT_ELEMENTS_CONTEXT)
ElementsContext.displayName = 'ElementsContext'

export const useElementsContext: UseElementsContextType = () => {
  return useContext(ElementsContext)
}

export default ElementsContext
