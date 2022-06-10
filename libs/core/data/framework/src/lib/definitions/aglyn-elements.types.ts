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

import type { Conditional } from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { BoxProps } from '@aglyn/shared-ui-theme'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { ElementType } from 'react'
import { ComponentClass, ComponentProps, JSXElementConstructor } from 'react'
import type { CANVAS_ROOT_ELEMENT_ID } from '../constants/canvas'
import type { BundleUId, ComponentId } from './aglyn-components.types'

export type ElementId = string
export type AglynElementType<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSXElementConstructor<any> = any
> =
  | ComponentClass<P>
  | JSX.ElementConstructor<P>
  | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]
export type AglynElementsById<T = AglynElement> = {
  [K in T extends AglynElement<any, any> ? T['$id'] : never]: T & { $id: K }
}
export type AglynElementsList<T = AglynElement> = T[]
export type AglynElementDenormalized<P = any, D extends ElementType = any> = AglynElement<
  P,
  true,
  D
>
export type AglynElementNormalized<P = any, D extends ElementType = any> = AglynElement<P, false, D>
export type AglynElementsDenormalized = AglynElementsById<AglynElementDenormalized>
export type AglynElementsNormalized = AglynElementsList<AglynElementNormalized>
export type AglynElementHierarchy<
  $ID extends Conditional<ElementId, CANVAS_ROOT_ELEMENT_ID, never, ElementId> = ElementId
> = [
  root?: CANVAS_ROOT_ELEMENT_ID,
  ...rootDescendents: [
    ...elementAncestors: Conditional<ElementId, CANVAS_ROOT_ELEMENT_ID, never, ElementId>[],
    element: $ID
  ]
]

export interface AglynElement<
  P = any,
  Denormalized extends boolean = true,
  D extends ElementType = any
> {
  readonly $id: ElementId
  readonly componentId: ComponentId
  readonly bundleId?: BundleUId
  parentId?: ElementId
  displayName?: string
  description?: string
  props?: Omit<BoxProps<D, P>, 'sx'>
  sx?: BoxProps['sx']
  elements?: Conditional<Denormalized, true, ElementId[], AglynElementsNormalized>
}
