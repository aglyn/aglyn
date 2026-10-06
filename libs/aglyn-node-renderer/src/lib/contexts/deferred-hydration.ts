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
 * Whether this tree may hold static subtrees' server HTML through hydration
 * (AGL-3581). See `deferred-hydration.tsx`.
 *
 * Off by default, which is every surface that renders a tree it did not
 * receive as server HTML — the Besigner canvas, the console previews — and
 * for which "keep the server HTML" means nothing. The published tenant page
 * turns it on through `TreeRoot`'s `deferHydration`.
 */
export const DeferredHydrationContext = createContext(false)
DeferredHydrationContext.displayName = 'DeferredHydrationContext'
