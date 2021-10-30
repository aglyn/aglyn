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

import { ElementId } from '@aglyn/core-data-framework'
import { createContext, useContext } from 'react'


export interface SelectionOptions {
  clientRect?: DOMRect
  $id?: ElementId
}

export type SelectFn = (options?: SelectionOptions) => Promise<unknown>

export interface SelectionContextType {
  $id: ElementId
  select: SelectFn
  close: () => void
}

export type UseSelectionType = () => SelectionContextType

export const DEFAULT_OPTIONS: SelectionOptions = {
  clientRect: null,
  $id: null,
}

export const buildOptions = (defaultOptions, options) => {
  return {
    ...DEFAULT_OPTIONS,
    ...defaultOptions,
    ...options,
  }
}

export const SelectionContext = createContext<SelectionContextType>(null)
SelectionContext.displayName = 'SelectionContext'

export const useSelectionContext: UseSelectionType = () => {
  return useContext(SelectionContext)
}

export default SelectionContext
