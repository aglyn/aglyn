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

import { AI_LAYOUT_FRAME_TOOL, AI_LAYOUT_PAGE_TOOL } from '../layout-language/ai-layout-language'
import { AI_SITE_LOOK_TOOL } from '../model/ai-site-look'
import type { AiTool } from '../providers/contract'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { aiSeoFieldsTool } from '../tools/ai-seo-tool'
import { AI_JOB_EMAIL_TOOL } from './ai-job-email-step'

/**
 * The listing a site job writes for each page (AGL-3830): a title and a
 * description, never a picture's description, so the listing's tool has one
 * shape on every page of every site.
 */
export const AI_SITE_JOB_LISTING_FIELDS = ['title', 'description'] as const

/**
 * ONE TOOL LIST FOR A SITE JOB'S GENERATE ROUTES (AGL-3830).
 *
 * A provider renders the tools ahead of the system blocks, and a cache entry
 * is a prefix of both, so when each route offered only its own tool, two
 * routes of one job shared no cached byte even where their doctrine block
 * was the same. Every route below is offered this same list instead, and
 * answers through its own tool in it:
 *
 *  - the look (`submit_site_look`),
 *  - the header and footer (`submit_frame`),
 *  - each page in the layout language (`submit_page`),
 *  - each page's listing (`propose_search_listing`, title and description),
 *  - the welcome email (`submit_email`),
 *  - and the inventory lookup a route that reads the site may call first.
 *
 * Sorted by name so the order is a fact of the list, never of who built it.
 * The tools are module constants, so their bytes do not move with the brief,
 * the site or the plan; the cache spec holds that, and that the bytes are
 * the same on every route. The runtime marks the last tool a breakpoint, so
 * the list is a cache entry of its own that the welcome email, whose
 * doctrine block differs, can read too.
 *
 * Which route a request is for is said in its own instructions and never by
 * a forced `tool_choice`: Claude Sonnet 5.5 and Claude Opus 5.5 refuse a
 * forced choice outright, and the page and the frame think adaptively, which
 * a forced choice cannot be combined with. Every request keeps `auto`, the
 * same on every route. A route that answers through a tool not its own is
 * re-asked (`runValidatedGeneration`), like any answer that broke a rule.
 *
 * The plan is not in the list. Its tool changes with the brief (the video
 * players it may name come from the brief), so in the list it would make
 * every route's prefix differ by brief; and it runs as its own step, before
 * the routes, on a cache entry of its own.
 *
 * Built on first use rather than at load: the email step imports the routes
 * that pass this, and this imports the email step's tool.
 */
let tools: readonly AiTool[] | null = null
export function aiSiteJobTools(): readonly AiTool[] {
  if (!tools) {
    tools = [
      AI_SITE_LOOK_TOOL,
      AI_LAYOUT_FRAME_TOOL,
      AI_LAYOUT_PAGE_TOOL,
      aiSeoFieldsTool(AI_SITE_JOB_LISTING_FIELDS),
      AI_JOB_EMAIL_TOOL,
      aiInventoryLookupTool(),
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }
  return tools
}
