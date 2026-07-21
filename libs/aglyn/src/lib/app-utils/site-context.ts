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
 * Identity of the published site a node tree renders inside. Provided by
 * the tenant page; absent in the besigner/preview, which is how components
 * with side effects (forms) know to stay inert.
 *
 * Lives banner-free in @aglyn/aglyn for the same reason as
 * ScreenLinkContext: a 'use client' banner in this module graph duplicates
 * the canvas singleton and blanks the tenant site (AGL-52).
 */
export interface SiteContextValue {
  /** Host document id of the rendered site. */
  hostId?: string
  /**
   * Data a site-page resolver already loaded on the server for THIS page,
   * keyed by plugin (AGL-659).
   *
   * Blocks whose primary content came from a `useEffect` fetch rendered a
   * skeleton during SSR — so the crawler saw a product page with no product
   * in it. Seeding from here lets a block render its real content in the
   * server HTML and still hydrate normally, without giving up ISR caching.
   *
   * Absent in the besigner/preview, so blocks must keep working without it.
   */
  pageData?: Record<string, unknown>
}

export const SiteContext = createContext<SiteContextValue>({})
SiteContext.displayName = 'AglynSiteContext'

/** The rendered site's identity; empty in the editor and preview. */
export function useSite(): SiteContextValue {
  return useContext(SiteContext)
}
