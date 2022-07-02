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

import { ElementsContext } from './elements-context'

export interface ElementsContextProviderProps {
  children?: JSX.Children
  // addElement?: (payload: AddElementPayload) => void
}

function ElementsContextProvider(props: ElementsContextProviderProps) {
  const { children } = props

  return (
    <ElementsContext.Provider value={undefined}>
      {children}
    </ElementsContext.Provider>
  )
}
ElementsContextProvider.displayName = 'ElementsContextProvider'
ElementsContextProvider.aglyn = true
ElementsContextProvider.defaultProps = {}

export { ElementsContextProvider }
export default ElementsContextProvider
