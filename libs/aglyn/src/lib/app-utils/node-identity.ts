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

import { createContext, useContext } from 'react'

/**
 * The id of the node a component is rendering as (AGL-659). Provided by
 * the renderer's Leaf around every component it mounts.
 *
 * Server-seeded page data (`SiteContext.pageData`) has to be keyed by node,
 * because one page can hold several instances of the same block with
 * different queries — a `/products` grid scoped to a collection sitting
 * above a `related-products` grid. Seeding them from one unkeyed slice would
 * server-render the wrong items into at least one of them, which is worse
 * than rendering none: wrong items get indexed, and the visitor sees the
 * content change under them on hydrate.
 *
 * Deliberately a context rather than a prop. A prop would land in every
 * component's signature and, for the many that spread `...rest` onto a DOM
 * element, leak an unknown attribute into the HTML. As a context only the
 * blocks that actually seed pay any attention to it, and nothing about the
 * existing component contract changes.
 *
 * Empty string when there is no surrounding node — a component mounted
 * directly in a test or a console surface rather than through the renderer.
 *
 * Lives banner-free in @aglyn/aglyn for the same reason as SiteContext:
 * a 'use client' banner in this module graph duplicates the canvas
 * singleton and blanks the tenant site (AGL-52).
 */
export const NodeIdentityContext = createContext<string>('')
NodeIdentityContext.displayName = 'AglynNodeIdentityContext'

/**
 * The rendering node's id; '' outside the renderer. Use it to look up a
 * per-node slice of `useSite().pageData`.
 */
export function useNodeId(): string {
  return useContext(NodeIdentityContext)
}
