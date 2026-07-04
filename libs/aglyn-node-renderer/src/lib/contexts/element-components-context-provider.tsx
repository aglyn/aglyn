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

import { useAglynNodePresetBlocks } from '../hooks/use-aglyn-node-presets'
import { AglynComponentsContext } from './aglyn-components-context'

export interface ElementComponentsContextProviderProps {
  children?: JSX.Children
}

export function ElementComponentsContextProvider(
  props: ElementComponentsContextProviderProps,
) {
  const { children } = props
  const nodePresets = useAglynNodePresetBlocks()

  return (
    <AglynComponentsContext.Provider value={{ nodePresets: nodePresets }}>
      {children}
    </AglynComponentsContext.Provider>
  )
}
ElementComponentsContextProvider.displayName =
  'ElementComponentsContextProvider'
ElementComponentsContextProvider.aglyn = true

export default ElementComponentsContextProvider
