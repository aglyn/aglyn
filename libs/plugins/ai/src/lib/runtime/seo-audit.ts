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
  SEO_LISTING_FIELDS,
  seoListingFieldTooLong,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type {
  AiSeoAuditReport,
  AiSeoContentFix,
  AiSeoFinding,
  AiSeoFindingCode,
  AiSeoPageReport,
  AiSeoSeverity,
} from '../model/ai-seo'
import { aiSeoKeywordCoverage, aiSeoKeywordList } from '../tools/ai-seo-tool'
import type { AiSeoPageFacts } from './seo-page-facts'

/**
 * The site SEO audit's scoring (AGL-2910): every audited page held to what a
 * search result and a crawler need, with nothing asked of a model. Pure, so
 * the audit is proved against fixtures and a job only spends tokens on the
 * fixes it cannot make without writing.
 *
 * Per page: a title and a description of its own, within their lengths and
 * used on no other page; one main heading that says something; a description
 * on every image; a link from somewhere else on the site; and the target
 * keywords a person named, reported where the page already says them.
 * Per site: whether search engines are told to stay away, whether the
 * structured data names and describes the publisher, and whether agents get
 * guidance of the author's own.
 *
 * Keyword coverage is reported, never forced. A page that does not say a
 * keyword is told so; the fix a job proposes uses the keyword only where the
 * page is about it, and the listing check refuses a keyword used past its
 * per-field count.
 */

/** Pages one audit covers. A larger site is audited on its first pages by path, and says how many it left. */
export const AI_SEO_AUDIT_MAX_PAGES = 150

/** Pages one batch of fixes carries: one model call a batch. */
export const AI_SEO_AUDIT_BATCH_SIZE = 8

/** What each severity takes off a page's score. */
const SEVERITY_WEIGHT: Record<AiSeoSeverity, number> = { high: 25, medium: 10, low: 3 }

/** A main heading this short or this generic says nothing a searcher can use. */
const THIN_H1_MIN_CHARS = 10
const GENERIC_H1: ReadonlySet<string> = new Set([
  'home',
  'homepage',
  'home page',
  'welcome',
  'hello',
  'untitled',
  'new page',
  'page',
  'title',
  'heading',
])

/** The findings a batch of generated fixes answers. */
const GENERATED_FIX_CODES: ReadonlySet<AiSeoFindingCode> = new Set([
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

/** One page as the audit reads it. */
export interface AiSeoAuditPage {
  screenId: string
  /** The public path, `/` for the home page. */
  path: string
  name: string
  versionId: string | null
  seo: {
    title?: string | null
    description?: string | null
    breadcrumb?: string | null
    image?: string | null
    imageAlt?: string | null
  }
  /** The screen's own description, which the head falls back to. */
  description?: string | null
  facts: AiSeoPageFacts
  /** Whether another audited page or a shared layout links here. */
  linkedFrom: boolean
  keywords: readonly string[]
}

/** The site as the audit reads it. */
export interface AiSeoAuditSite {
  discouraged: boolean
  entity: { name?: string | null; description?: string | null }
  agent: { whenToUse?: string | null }
}

const blank = (value: string | null | undefined): boolean => !String(value ?? '').trim()
const normalized = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** A path as the keyword lines and the routing map both spell it: leading slash, no trailing one. */
export function aiSeoNormalizePath(path: string): string {
  const trimmed = String(path ?? '').trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

/**
 * Target keywords per page, one line a page: `/pricing: plans, pricing`.
 * A line without a path, or with a path the site does not have, names no
 * page; the step reports the paths it could not match.
 */
export function parseAiSeoKeywordLines(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const line of String(raw ?? '').split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const path = aiSeoNormalizePath(line.slice(0, at))
    const keywords = aiSeoKeywordList(line.slice(at + 1))
    if (keywords.length) out[path] = aiSeoKeywordList([...(out[path] ?? []), ...keywords])
  }
  return out
}

function finding(
  code: AiSeoFindingCode,
  severity: AiSeoSeverity,
  message: string,
  extra: Partial<Pick<AiSeoFinding, 'nodeIds' | 'screenIds' | 'keyword'>> = {},
): AiSeoFinding {
  return { code, severity, message, ...extra }
}

/** The pages that share one value, by that value. */
function sharedValues(
  pages: readonly AiSeoAuditPage[],
  read: (page: AiSeoAuditPage) => string | null | undefined,
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const page of pages) {
    const key = normalized(read(page))
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), page.screenId])
  }
  return new Map([...groups].filter(([, ids]) => ids.length > 1))
}

function pageFindings(
  page: AiSeoAuditPage,
  titles: Map<string, string[]>,
  descriptions: Map<string, string[]>,
): AiSeoFinding[] {
  const out: AiSeoFinding[] = []
  const title = page.seo.title
  if (blank(title)) {
    out.push(finding('title-missing', 'medium', 'This page has no search title, so results show its name beside the site title.'))
  } else {
    if (seoListingFieldTooLong('title', title)) {
      out.push(finding('title-too-long', 'medium', `The search title is over ${SEO_LISTING_FIELDS.title.maxLength} characters and will be cut off in results.`))
    }
    const twins = titles.get(normalized(title))?.filter((id) => id !== page.screenId)
    if (twins?.length) {
      out.push(finding('title-duplicate', 'high', 'Another page uses the same search title, so results cannot tell them apart.', { screenIds: twins }))
    }
  }

  const description = page.seo.description
  if (blank(description) && blank(page.description)) {
    out.push(finding('description-missing', 'medium', 'This page has no search description, so results show the site’s.'))
  } else if (!blank(description)) {
    if (seoListingFieldTooLong('description', description)) {
      out.push(finding('description-too-long', 'low', `The search description is over ${SEO_LISTING_FIELDS.description.maxLength} characters and will be cut off.`))
    }
    const twins = descriptions.get(normalized(description))?.filter((id) => id !== page.screenId)
    if (twins?.length) {
      out.push(finding('description-duplicate', 'medium', 'Another page uses the same search description.', { screenIds: twins }))
    }
  }

  const { h1s } = page.facts
  if (!h1s.length) {
    out.push(finding('h1-missing', 'high', 'This page has no main heading.'))
  } else {
    if (h1s.length > 1) {
      out.push(
        finding('h1-multiple', 'medium', `This page has ${h1s.length} main headings; it should have one.`, {
          nodeIds: h1s.slice(1).map((heading) => heading.nodeId).filter((id): id is string => Boolean(id)),
        }),
      )
    }
    const first = h1s[0]
    if (first.text.length < THIN_H1_MIN_CHARS || GENERIC_H1.has(normalized(first.text))) {
      out.push(
        finding('h1-thin', 'medium', `The main heading “${first.text}” says little about the page.`, {
          nodeIds: first.nodeId ? [first.nodeId] : [],
        }),
      )
    }
  }

  const missingAlt = page.facts.imagesMissingAlt
  if (missingAlt.length) {
    out.push(
      finding(
        'image-alt-missing',
        'medium',
        `${missingAlt.length} ${missingAlt.length === 1 ? 'image has' : 'images have'} no description for readers who cannot see ${missingAlt.length === 1 ? 'it' : 'them'}.`,
        { nodeIds: missingAlt.map((image) => image.nodeId) },
      ),
    )
  }

  if (!page.linkedFrom && page.path !== '/') {
    out.push(finding('orphan', 'medium', 'No other page or shared layout links here, so visitors and crawlers may never find it.'))
  }

  const coverage = aiSeoKeywordCoverage(page.keywords, {
    title: page.seo.title,
    description: page.seo.description,
    h1: h1s[0]?.text,
    body: page.facts.text,
  })
  for (const entry of coverage) {
    if (!entry.inTitle && !entry.inDescription && !entry.inH1 && !entry.inBody) {
      out.push(
        finding('keyword-missing', 'low', `The page never says “${entry.keyword}”. Only use it if the page is about it.`, {
          keyword: entry.keyword,
        }),
      )
    }
  }
  return out
}

function scoreOf(findings: readonly AiSeoFinding[]): number {
  return Math.max(0, 100 - findings.reduce((sum, entry) => sum + SEVERITY_WEIGHT[entry.severity], 0))
}

/** Audit the pages and the site; nothing here reads, writes or generates. */
export function aiSeoAudit(
  pages: readonly AiSeoAuditPage[],
  site: AiSeoAuditSite,
  options: { skipped?: number; batchSize?: number } = {},
): AiSeoAuditReport {
  const titles = sharedValues(pages, (page) => page.seo.title)
  const descriptions = sharedValues(pages, (page) => page.seo.description)
  const reports: AiSeoPageReport[] = pages.map((page) => {
    const findings = pageFindings(page, titles, descriptions)
    return {
      screenId: page.screenId,
      path: page.path,
      name: page.name,
      versionId: page.versionId,
      score: scoreOf(findings),
      findings,
      keywords: aiSeoKeywordCoverage(page.keywords, {
        title: page.seo.title,
        description: page.seo.description,
        h1: page.facts.h1s[0]?.text,
        body: page.facts.text,
      }),
    }
  })

  const siteFindings: AiSeoFinding[] = []
  if (site.discouraged) {
    siteFindings.push(finding('search-discouraged', 'high', 'Search engines are asked not to index this site, so none of its pages appear in results.'))
  }
  if (blank(site.entity.name) || blank(site.entity.description)) {
    siteFindings.push(finding('entity-incomplete', 'low', 'The structured data does not name and describe who publishes the site.'))
  }
  if (blank(site.agent.whenToUse)) {
    siteFindings.push(finding('llms-guidance-missing', 'low', '/llms.txt carries no guidance of your own for AI agents.'))
  }

  const queue = reports
    .filter((report) => report.findings.some((entry) => GENERATED_FIX_CODES.has(entry.code)))
    .sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((report) => report.screenId)

  return {
    kind: 'audit',
    pages: reports,
    skipped: Math.max(0, options.skipped ?? 0),
    site: siteFindings,
    siteProposal: siteFindings.some((entry) => entry.code === 'entity-incomplete' || entry.code === 'llms-guidance-missing'),
    queue,
    batchSize: Math.max(1, options.batchSize ?? AI_SEO_AUDIT_BATCH_SIZE),
    score: reports.length
      ? Math.round(reports.reduce((sum, report) => sum + report.score, 0) / reports.length)
      : 100,
    notes: [],
  }
}

/**
 * The content fixes that need no model: every main heading after the first
 * editable one becomes an `h2`, so the page keeps one.
 */
export function aiSeoHeadingDemotions(facts: AiSeoPageFacts): AiSeoContentFix[] {
  const editable = facts.h1s.filter((heading) => heading.editable && heading.nodeId)
  if (facts.h1s.length < 2 || !editable.length) return []
  const keep = editable[0].nodeId
  return editable
    .filter((heading) => heading.nodeId !== keep)
    .map((heading) => ({ kind: 'h1-demote', nodeId: heading.nodeId as string }))
}

/** The queue's batches, in order. */
export function aiSeoAuditBatches(report: Pick<AiSeoAuditReport, 'queue' | 'batchSize'>): string[][] {
  const batches: string[][] = []
  for (let start = 0; start < report.queue.length; start += report.batchSize) {
    batches.push(report.queue.slice(start, start + report.batchSize))
  }
  return batches
}
