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

import { useCallbackParamRef } from '@aglyn/shared-ui-jsx'
import { DependencyList, useEffect } from 'react'

export type EffectCallback<T = unknown> = (
  isMounted: () => boolean,
) => T | Promise<T>

export type EffectParam<T = unknown> =
  | EffectCallback
  | { onMount?: EffectCallback<T>; onUnmount?: (result?: T) => void }

export function useAsyncEffect<T = unknown>(
  effect: EffectParam,
  deps?: DependencyList,
) {
  const isFunc = typeof effect === 'function'
  const { onMount, onUnmount } = isFunc
    ? { onMount: effect, onUnmount: undefined }
    : { ...effect }
  const handleMount = useCallbackParamRef(onMount)
  const handleUnmount = useCallbackParamRef(onUnmount)

  useEffect(
    function () {
      const doMount = handleMount.current
      const doUnmount = handleUnmount.current
      let result
      let mounted = true

      if (typeof doMount === 'function') {
        Promise.resolve(doMount(() => mounted)).then(
          (value) => (result = value),
        )
      }

      return () => {
        mounted = false

        if (typeof doUnmount === 'function') doUnmount(result)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )
}

export default useAsyncEffect
