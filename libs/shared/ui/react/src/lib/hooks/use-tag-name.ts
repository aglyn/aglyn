/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { Ref, ReactNode } from 'react'
import useNodeProperty from './use-node-property'

export function useTagName(initialState = null): [string, Ref<any>, ReactNode] {
  const [tagName, ref, node] = useNodeProperty('tagName', initialState)
  return [tagName, ref, node]
}

export default useTagName
