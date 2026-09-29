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
import { createContext } from 'react'

/**
 * How a namespaced element waits for the realm bundle that registers it
 * (AGL-3390).
 *
 * A signed marketplace plugin's elements render on the server, and the
 * browser has to register the same component before it can hydrate that
 * HTML. The host app answers, for a component id, the load that registers
 * it, or `undefined` when no load on this page will. The renderer suspends a
 * namespaced element on that load inside the element's own Suspense
 * boundary, so React keeps the server's HTML in place until the bundle has
 * run, and the rest of the page hydrates without waiting.
 *
 * `undefined` as a whole means the surface loads no realm bundles in the
 * render path (the Besigner loads them before its canvas mounts), and no
 * element waits.
 */
export const RealmElementsContext = createContext<
  ((componentId: string) => Promise<void> | undefined) | undefined
>(undefined)
RealmElementsContext.displayName = 'RealmElementsContext'
