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

import {
  type AglynElementDenormalized,
  type ElementId,
  getCanvasDenormalizedElementsStore,
} from '@aglyn/core-data-framework'
import type {AnyProps, Conditional} from '@aglyn/shared-data-types'
import {useSubscribable} from '@aglyn/shared-ui-jsx'
import {useAglynAppContext} from '../contexts/aglyn-app-context'


export type UseAglynElementData<P = AnyProps,
  K extends keyof AglynElementDenormalized<P> = null> = Conditional<K,
  keyof AglynElementDenormalized<P>,
  AglynElementDenormalized<P>[K],
  AglynElementDenormalized<P>>


export function useAglynElementData<P>(
  $id: ElementId,
): AglynElementDenormalized<P>
export function useAglynElementData<P,
  K extends keyof AglynElementDenormalized<P> = null>(
  $id: ElementId,
  property: K,
): AglynElementDenormalized<P>[K]
export function useAglynElementData<P,
  K extends keyof AglynElementDenormalized<P> = null>(
  $id: ElementId,
  property?: K,
): UseAglynElementData<P, K> {
  const app = useAglynAppContext()
  return useSubscribable(getCanvasDenormalizedElementsStore(app), undefined, (store) => {
    const element = store?.[$id]
    return property
      ? element?.[property]
      : element
  }, [$id, property, app]) as UseAglynElementData<P, K>
}
export default useAglynElementData
