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

import { useCallback, useRef } from 'react'
import useCallbackParamRef from './use-callback-param-ref'

export function useObserverMutation(
  ctorCallback: MutationCallback,
): [
  observe: MutationObserver['observe'],
  disconnect: MutationObserver['disconnect'],
  takeRecords: MutationObserver['takeRecords'],
  getObserver: () => MutationObserver,
] {
  const callback = useCallbackParamRef(ctorCallback)
  const observer = useRef<MutationObserver>(null)

  // This avoids creating an expensive object until it’s truly needed for the
  // first time. If you use Flow or TypeScript, you can also give getObserver()
  // a non-nullable type for convenience.
  const getObserver = useCallback(
    () => (observer.current ??= new MutationObserver(callback.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const observe = useCallback(
    (...args: Parameters<MutationObserver['observe']>) =>
      getObserver()?.observe(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const disconnect = useCallback(
    (...args: Parameters<MutationObserver['disconnect']>) =>
      getObserver()?.disconnect(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const takeRecords = useCallback(
    (...args: Parameters<MutationObserver['takeRecords']>) =>
      getObserver()?.takeRecords(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return [observe, disconnect, takeRecords, getObserver]
}

export default useObserverMutation
