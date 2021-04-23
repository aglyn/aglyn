/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ReactNode, Ref, useEffect, useState, useCallback } from 'react'

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
export function useNodeProperty<U, T>(key: U, initialState = null): [any, Ref<T>, ReactNode, (setNewKey: U) => void] {
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
