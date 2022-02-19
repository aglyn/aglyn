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

import {ClientRectObject, getElementClientRectBounding} from '@aglyn/shared-util-dom'
import {RefCallback, RefObject, useCallback, useRef} from 'react'


export interface UseElementPositionOptions {

}

export function useElementPosition<T>(
  options?: UseElementPositionOptions,
): [RefObject<ClientRectObject>, RefCallback<T>] {
  // const [clientPosition, setRect] = useState<ClientPosition>()
  const clientPosition = useRef<ClientRectObject>()
  const nodeRef = useRef()

  const setRef = useCallback((node) => {
    nodeRef.current = node
    if (node) {
      window['MyNode'] = node
      console.log('node', node)
      const position = getElementClientRectBounding(node)

      // console.log('position', position, rect)
      clientPosition.current = position
    }
  }, [])

  return [clientPosition, setRef]
}

export default useElementPosition
