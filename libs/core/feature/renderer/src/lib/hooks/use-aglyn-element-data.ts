/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { getCanvasNormalizedNodesStore } from '@aglyn/aglyn'
import type {
  AglynNodeItemNormalized,
  NodeId,
} from '@aglyn/aglyn'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export type UseAglynElementData<
  P = AnyProps,
  K extends keyof AglynNodeItemNormalized<P> = null,
> = Conditional<
  K,
  keyof AglynNodeItemNormalized<P>,
  AglynNodeItemNormalized<P>[K],
  AglynNodeItemNormalized<P>
>

export function useAglynElementData<P = JSX.AnyProps>(
  $id: NodeId,
): AglynNodeItemNormalized<P>
export function useAglynElementData<
  P = JSX.AnyProps,
  K extends keyof AglynNodeItemNormalized<P> = null,
>($id: NodeId, property: K, defaultValue?: AglynNodeItemNormalized<P>[K]): AglynNodeItemNormalized<P>[K]
export function useAglynElementData<
  P = JSX.AnyProps,
  K extends keyof AglynNodeItemNormalized<P> = null,
>($id: NodeId, property?: K, defaultValue?: AglynNodeItemNormalized<P>[K]): UseAglynElementData<P, K> {
  const app = useAglynAppContext()
  return useSubscribable(
    getCanvasNormalizedNodesStore(app),
    defaultValue,
    // The overall result is cast below; the map result union defeats
    // useSubscribable's MapObservable inference for conditional K.
    (store): any => {
      const element = store?.[$id]
      return property ? element?.[property] : element
    },
    [$id, property, app],
  ) as UseAglynElementData<P, K>
}
export default useAglynElementData
