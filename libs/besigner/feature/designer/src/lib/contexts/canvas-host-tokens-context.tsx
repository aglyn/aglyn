/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { type HostTokenSource, hostTokenMerge } from '@aglyn/aglyn'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import BindingPickerContext from './binding-picker-context'

/**
 * The site whose `{{host.*}}` tokens the canvas fills in (AGL-2881), or
 * `undefined` to draw them as written.
 *
 * Every leaf the canvas draws needs the answer — the document's own nodes, a
 * component instance's definition, a placed form's design, the layout chrome —
 * so it is decided once, at the top of the canvas, and carried down by context
 * rather than by a subscription on every element.
 */
export const CanvasHostTokensContext = createContext<
  HostTokenSource | undefined
>(undefined)
CanvasHostTokensContext.displayName = 'CanvasHostTokensContext'

export interface CanvasHostTokensProviderProps {
  children?: ReactNode
}

/**
 * Decides {@link CanvasHostTokensContext} from the site the console hands the
 * binding picker, and from the WYSIWYG bindings toggle.
 *
 * The raw-token view keeps the tokens: an author who turned resolution off
 * asked to see what is written, and a business name is a resolved value like
 * a variable's. With no site to read — still loading, or a surface that has
 * none — the tokens draw as written too.
 *
 * The value keeps its identity while every token resolves to the same thing.
 * The console's host document is a new object on each snapshot, and a write to
 * a field no token reads would otherwise redraw every leaf on the canvas.
 */
export function CanvasHostTokensProvider(props: CanvasHostTokensProviderProps) {
  const { children } = props
  const [resolveFlag] = useAglynBesignerFlag('resolveBindings')
  const { host } = useContext(BindingPickerContext)
  const site = resolveFlag === false ? undefined : (host ?? undefined)
  const resolvedTokens = site ? JSON.stringify(hostTokenMerge(site)) : ''
  const value = useMemo(
    () => site,
    // What every token resolves to keys the value, not the document's
    // identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedTokens],
  )
  return (
    <CanvasHostTokensContext.Provider value={value}>
      {children}
    </CanvasHostTokensContext.Provider>
  )
}
CanvasHostTokensProvider.displayName = 'CanvasHostTokensProvider'

export default CanvasHostTokensContext
