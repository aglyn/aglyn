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

import {ReactNode, Ref, useEffect, useState, useCallback} from 'react'


/**
 * Use a React Node property value from the passed property key
 *
 * EXAMPLE:
 * const [value, ref, node, setNewKey] = useNodeProperty('tagName')
 *
 * @param key {any} The property key
 * @param initialState {any} Initial property value
 * @return {[string, React.Ref<T>, React.ReactNode, ((newPropertyName: U) => void)]}
 */
export function useNodeProperty<U, T>(
  key: U,
  initialState = null,
): [any, Ref<T>, ReactNode, (setNewKey: U) => void] {
  const [keyName, setNewKey] = useState(key)
  const [value, setPropertyValue] = useState(initialState)
  const [node, setNode] = useState(null)

  useEffect(() => {
    if (node && node[keyName] && node[keyName] !== value) {
      setPropertyValue(node[keyName])
    }
  }, [node, keyName])

  const ref = useCallback((node) => setNode(node), [])

  return [value, ref, node, setNewKey]
}

export default useNodeProperty
