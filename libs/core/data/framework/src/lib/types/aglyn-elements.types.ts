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

import {type Conditional, type JSXElementType, type KeyValueMap} from '@aglyn/shared-data-types'
import {type CANVAS_ROOT_ELEMENT_ID} from '../constants/canvas'
import {type BundleUId, type ComponentId} from './aglyn-components.types'


export type ElementId = string
export type AglynElementType<P = any> = JSXElementType<P>
export type AglynElementNormalized<P = any> = AglynElement<P, false>
export type AglynElementDenormalized<P = any> = AglynElement<P, true>
export type AglynElementsById<T = AglynElementDenormalized> = KeyValueMap<ElementId, T>
export type AglynElementsList<T = AglynElementNormalized> = Array<T>
export type AglynElementHierarchy<$ID extends ElementId = ElementId> = [root: CANVAS_ROOT_ELEMENT_ID, ...parentIds: [...ElementId[], $ID]]

export interface AglynElement<P = any, Denormalized extends boolean = true, BoxProps extends {sx: any} = any> {
  readonly $id: ElementId
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  parentId?: ElementId
  displayName?: string
  description?: string
  props?: Omit<BoxProps, 'sx'> & P
  sx?: BoxProps['sx']
  elements?: Conditional<Denormalized, true, AglynElementsList<ElementId>, AglynElementsList>
}
