/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import '@aglyn/shared-data-jsx'
import {
  createContext,
  type ForwardRefExoticComponent,
  useContext,
} from 'react'

export interface LeafType {
  id: string
  props?: Record<string, any>
}

export type TreeComponentType =
  | ForwardRefExoticComponent<any>
  | JSX.IntrinsicElement
export type LeafComponentType =
  | ForwardRefExoticComponent<any>
  | JSX.IntrinsicElement

export const TreeComponentContext = createContext<TreeComponentType>('div')
TreeComponentContext.displayName = 'TreeComponentContext'
export const TreeContext = createContext<LeafType[] | null>(null)
TreeContext.displayName = 'TreeContext'

export const LeafComponentContext = createContext<LeafComponentType>('div')
LeafComponentContext.displayName = 'LeafComponentContext'
export const LeafContext = createContext<LeafType | null>(null)
LeafContext.displayName = 'LeafContext'

export const useTreeComponentContext = () => useContext(TreeComponentContext)
export const useLeafComponentContext = () => useContext(LeafComponentContext)
export const useTreeContext = () => useContext(TreeContext)
export const useLeafContext = () => useContext(LeafContext)
