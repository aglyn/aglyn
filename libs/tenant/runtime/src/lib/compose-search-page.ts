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

import * as Aglyn from '@aglyn/aglyn/server'
import { resolveBuiltInPageLayoutId } from './built-in-page-layout'
import { composeNodesWithChrome } from './compose-screen-nodes'
import {
  buildSearchResultsNodes,
  type SearchResultsNodesOptions,
} from './search-results-nodes'

/**
 * `/search` composed the way every other page of the site is (AGL-2513):
 * the built-in results body grafted into the site's shared layout, so the
 * page carries the same header, nav and footer as the pages it links to.
 *
 * Which layout is the host's to choose — see `resolveBuiltInPageLayoutId`.
 * With none resolvable the body composes alone, which is the page as it was
 * before this existed: themed, chrome-less, and still a working search page.
 *
 * Fail-open to `null`, and the route then renders the body with no chrome at
 * all. A search page is where a lost visitor goes; it must not be the page
 * that 500s because a layout was deleted.
 */
export async function composeSearchPage(options: {
  hostId: string
  host: any
  results: SearchResultsNodesOptions
}): Promise<{ nodes: Record<string, any>; layoutId?: string } | null> {
  const { hostId, host, results } = options
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildSearchResultsNodes(results),
      host: host as Aglyn.HostTokenSource,
    })
    return nodes ? { nodes, ...(layoutId ? { layoutId } : {}) } : null
  } catch (error) {
    console.error('search page composition failed', error)
    return null
  }
}

export default composeSearchPage
