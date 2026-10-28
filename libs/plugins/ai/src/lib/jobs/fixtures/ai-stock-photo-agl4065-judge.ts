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

import type { AiLayoutPictureSlot } from '../../layout-language/ai-layout-pictures'
import {
  aiStockProductSearches,
  aiStockSearchesFor,
  aiStockSlotPart,
  aiStockSubjectWords,
  type AiStockJudgement,
  type AiStockSearch,
  type AiStockSiteTerms,
} from '../ai-layout-stock-photos'

/**
 * How the stock photo source judges each of a slot's own searches (AGL-4065),
 * as its `judgementOf` builds it from the search and the site's terms: what
 * the AGL-4065 replays hold a recorded photo to, search by search.
 */
export function aiAgl4065Judgement(
  terms: AiStockSiteTerms,
  slot: Pick<AiLayoutPictureSlot, 'role'>,
  search: AiStockSearch,
  subject: string,
): AiStockJudgement {
  return {
    subject: search.subject ?? (search.broad ? '' : subject),
    domain: terms.domain,
    ...(terms.lead ? { world: terms.lead } : {}),
    strict: (slot.role === 'gallery' && !search.broad) || !!search.requires || !!search.strict,
    named: terms.named,
    rivals: terms.rivals,
    ...(terms.shun.length || search.shun?.length ? { shun: [...new Set([...terms.shun, ...(search.shun ?? [])])] } : {}),
    ...(terms.shunLead.length ? { shunLead: terms.shunLead } : {}),
    ...(search.product ? { product: true } : {}),
    ...(search.leadAny?.length ? { leadAny: search.leadAny } : {}),
    ...(search.requires ? { requires: search.requires } : {}),
    ...(search.category ? { category: search.category } : {}),
    ...(search.object ? { object: search.object } : {}),
    ...(search.kin ? { kin: search.kin } : {}),
    ...(search.lead ? { lead: true } : {}),
    ...(search.leadWorld ? { leadWorld: true } : {}),
    ...(search.first ? { first: true } : {}),
    ...(search.refuse?.length ? { refuse: search.refuse } : {}),
    ...(search.needs?.length ? { needs: search.needs } : {}),
    ...(search.refuseLead?.length ? { refuseLead: search.refuseLead } : {}),
  }
}

/** A slot's own searches, each with its judgement. */
export function aiAgl4065Searches(
  terms: AiStockSiteTerms,
  slot: AiLayoutPictureSlot,
  sectionName: string,
): Array<{ search: AiStockSearch; judgement: AiStockJudgement }> {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  const searches = slot.product
    ? aiStockProductSearches(slot, terms.craft, terms.domain, { broad: terms.broad, core: terms.core })
    : aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName)
  return searches.map((search) => ({ search, judgement: aiAgl4065Judgement(terms, slot, search, subject) }))
}
