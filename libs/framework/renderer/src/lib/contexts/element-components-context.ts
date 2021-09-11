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

import { AglynComponent } from '@aglyn/framework/sdk'
import { createContext, useContext } from 'react'


export type UseElementComponentsContextType = () => ElementComponentsContextType

export interface ElementComponentsContextType {
  elementComponents: AglynComponent[]
}

export const DEFAULT_ELEMENT_COMPONENTS_CONTEXT: ElementComponentsContextType = {
  elementComponents: [],
}
export const ElementComponentsContext = createContext<ElementComponentsContextType>(
  DEFAULT_ELEMENT_COMPONENTS_CONTEXT
)
ElementComponentsContext.displayName = 'ElementComponentsContext'

export const useElementComponentsContext: UseElementComponentsContextType = () => {
  return useContext(ElementComponentsContext)
}

export default ElementComponentsContext
