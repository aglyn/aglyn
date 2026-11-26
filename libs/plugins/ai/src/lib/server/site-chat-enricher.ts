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

import type { SitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isAiOnForSite } from '../model/ai-site-switch'
import {
  readStoredSiteChatSettings,
  SITE_CHAT_PAGE_PROP,
  siteChatOnPlan,
  siteChatSliceForPage,
} from '../model/site-chat'

export interface SiteChatEnricherDeps {
  readSettings: (hostId: string) => Promise<unknown>
  flagOn: (orgId: string) => Promise<boolean>
}

/**
 * The page's chat slice (AGL-4250): a page the chat shows on carries the
 * greeting, the suggested questions and what the chat may do; every other
 * page carries nothing, so the site bundle loads the chat runtime only where
 * the chat is. The answer to "is it on" is the door's own, rung for rung, so
 * a launcher never shows for a door that would answer 404.
 */
export function createSiteChatPageEnricher(deps: SiteChatEnricherDeps): SitePageEnricher {
  return async ({ hostId, host, org, path, pathUnknown }) => {
    if (!hostId || !org) return {}
    if (!siteChatOnPlan(resolveEffectivePlan(org)) || !isAiOnForSite(org, host)) return {}
    const settings = readStoredSiteChatSettings(await deps.readSettings(hostId))
    const slice = siteChatSliceForPage(settings, path, Boolean(pathUnknown))
    if (!slice) return {}
    const orgId = String(org?.$id ?? host?.orgId ?? '')
    if (!orgId || !(await deps.flagOn(orgId))) return {}
    return { [SITE_CHAT_PAGE_PROP]: slice }
  }
}
