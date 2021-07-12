/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { createContext, useContext } from 'react'
import { Website } from '@aglyn/website/core'


export interface ElementsContextType {
  elements?: Website.ElementData[]
}

export type UseElementsContextType = () => ElementsContextType

export const ElementsContext = createContext<ElementsContextType>(null)
export const useElementsContext: UseElementsContextType = () => {
  return useContext(ElementsContext)
}

export default ElementsContext
