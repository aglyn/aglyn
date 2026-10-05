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

import {
  seoAudit,
  type SeoAuditPage,
  type SeoAuditSite,
  type SeoFindingCode,
} from '@aglyn/aglyn/app-utils/seo-audit'
import type { SeoPageFacts } from '@aglyn/aglyn/app-utils/seo-page-facts'
import type { AiSeoAuditReport, AiSeoContentFix } from '../model/ai-seo'

/**
 * The site audit an `seo` job runs (AGL-2910): the platform's SEO check
 * (`@aglyn/aglyn/app-utils/seo-audit`), which any site owner sees without
 * this plugin, plus what a job owes on top of it — which pages need
 * GENERATED fixes, in what order, and whether the site-wide proposal is
 * owed. The findings and the scores are the check's; this module never
 * judges a page itself, so the fixes a job proposes answer exactly the
 * findings the site's SEO check lists.
 */

/** Pages one batch of fixes carries: one model call a batch. */
export const AI_SEO_AUDIT_BATCH_SIZE = 8

/** The findings a batch of generated fixes answers. */
const GENERATED_FIX_CODES: ReadonlySet<SeoFindingCode> = new Set([
  'title-missing',
  'title-too-long',
  'title-duplicate',
  'description-missing',
  'description-too-long',
  'description-duplicate',
  'h1-missing',
  'h1-thin',
  'image-alt-missing',
  'keyword-missing',
])

/** The site-wide findings the site proposal (structured data, agent guidance) answers. */
const SITE_PROPOSAL_CODES: ReadonlySet<SeoFindingCode> = new Set(['entity-incomplete', 'llms-guidance-missing'])

/** Check the site, then queue the pages whose findings need generated text, the worst first. */
export function aiSeoAudit(
  pages: readonly SeoAuditPage[],
  site: SeoAuditSite,
  options: { skipped?: number; notes?: readonly string[]; batchSize?: number } = {},
): AiSeoAuditReport {
  const report = seoAudit(pages, site, options)
  const queue = report.pages
    .filter((page) => page.findings.some((entry) => GENERATED_FIX_CODES.has(entry.code)))
    .sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((page) => page.screenId)
  return {
    kind: 'audit',
    ...report,
    siteProposal: report.site.some((entry) => SITE_PROPOSAL_CODES.has(entry.code)),
    queue,
    batchSize: Math.max(1, options.batchSize ?? AI_SEO_AUDIT_BATCH_SIZE),
  }
}

/**
 * The content fixes that need no model: the page keeps its FIRST main
 * heading, and every editable one after it becomes an `h2`. When the first is
 * one no fix can change — a component's, a repeat's, rich text — it is the
 * one kept, so every editable main heading is demoted; keeping an editable one
 * beside it would leave the page with two.
 */
export function aiSeoHeadingDemotions(facts: SeoPageFacts): AiSeoContentFix[] {
  if (facts.h1s.length < 2) return []
  const [first, ...rest] = facts.h1s
  const keep = first.editable ? first.nodeId : null
  const demoted = new Set<string>()
  for (const heading of rest) {
    if (heading.editable && heading.nodeId && heading.nodeId !== keep) demoted.add(heading.nodeId)
  }
  return [...demoted].map((nodeId) => ({ kind: 'h1-demote', nodeId }))
}

/** The queue's batches, in order. */
export function aiSeoAuditBatches(report: Pick<AiSeoAuditReport, 'queue' | 'batchSize'>): string[][] {
  const batches: string[][] = []
  for (let start = 0; start < report.queue.length; start += report.batchSize) {
    batches.push(report.queue.slice(start, start + report.batchSize))
  }
  return batches
}
