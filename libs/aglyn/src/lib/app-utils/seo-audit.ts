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

import { SEO_LISTING_FIELDS, seoListingFieldTooLong } from './seo-listing-fields'
import { seoKeywordCoverage, seoKeywordList, type SeoKeywordCoverage } from './seo-keywords'
import type { SeoPageFacts } from './seo-page-facts'

/**
 * The SEO check: every page a site publishes held to what a search result
 * and a crawler need, and the site held to what a search engine and an agent
 * read about it. Pure and provider-free — nothing here reads, writes or
 * generates — so any site owner is told what is wrong, and anything that
 * proposes a fix answers the same findings rather than judging a page its
 * own way.
 *
 * Per page: a title and a description of its own, within the lengths the
 * listing editor enforces (`seo-listing-fields.ts`) and used on no other
 * page; one main heading that says something; a description on every image;
 * a link from somewhere else on the site; and the target keywords a person
 * named, reported where the page already says them.
 * Per site: whether search engines are told to stay away, whether the
 * structured data names and describes the publisher, and whether agents get
 * guidance of the author's own in `/llms.txt`.
 *
 * Keyword coverage is reported, never forced: a page that does not say a
 * keyword is told so, and told to use it only if the page is about it.
 *
 * The pages come from `seo-site-scan.ts`, which reads a site the way its
 * sitemap lists it.
 */

/** Pages one check covers. A larger site is checked on its first pages by path, and says how many it left. */
export const SEO_AUDIT_MAX_PAGES = 150

export type SeoFindingCode =
  | 'title-missing'
  | 'title-too-long'
  | 'title-duplicate'
  | 'description-missing'
  | 'description-too-long'
  | 'description-duplicate'
  | 'h1-missing'
  | 'h1-multiple'
  | 'h1-thin'
  | 'image-alt-missing'
  | 'orphan'
  | 'keyword-missing'
  | 'search-discouraged'
  | 'entity-incomplete'
  | 'llms-guidance-missing'

export type SeoSeverity = 'high' | 'medium' | 'low'

export interface SeoFinding {
  code: SeoFindingCode
  severity: SeoSeverity
  /** One customer-safe sentence. */
  message: string
  /** The elements it is about: the images without a description, the extra headings. */
  nodeIds?: string[]
  /** The other pages it involves: a duplicate's twins. */
  screenIds?: string[]
  /** The target keyword, for `keyword-missing`. */
  keyword?: string
}

/** One checked page. */
export interface SeoPageReport {
  screenId: string
  /** The public path, `/` for the home page. */
  path: string
  name: string
  /** The published version the page was checked on. */
  versionId: string | null
  /** 100 with nothing found, less for each finding by its severity. */
  score: number
  findings: SeoFinding[]
  keywords: SeoKeywordCoverage[]
}

/** The check of a site: every checked page, and what was found about the site itself. */
export interface SeoAuditReport {
  pages: SeoPageReport[]
  /** Published pages past {@link SEO_AUDIT_MAX_PAGES}, not checked. */
  skipped: number
  /** Findings about the site rather than a page. */
  site: SeoFinding[]
  /** The average page score. */
  score: number
  /** Customer-safe lines about the check itself: a keyword line naming no page, say. */
  notes: string[]
}

/** What each finding is called where it is listed. */
export const SEO_FINDING_LABELS: Readonly<Record<SeoFindingCode, string>> = {
  'title-missing': 'No search title',
  'title-too-long': 'Title too long',
  'title-duplicate': 'Title used on another page',
  'description-missing': 'No search description',
  'description-too-long': 'Description too long',
  'description-duplicate': 'Description used on another page',
  'h1-missing': 'No main heading',
  'h1-multiple': 'More than one main heading',
  'h1-thin': 'Main heading says little',
  'image-alt-missing': 'Images without a description',
  orphan: 'No page links here',
  'keyword-missing': 'Target keyword not covered',
  'search-discouraged': 'Search engines are discouraged',
  'entity-incomplete': 'Structured data incomplete',
  'llms-guidance-missing': 'No guidance for AI agents',
}

/** What each severity takes off a page's score. */
const SEVERITY_WEIGHT: Record<SeoSeverity, number> = { high: 25, medium: 10, low: 3 }

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

/** One page as the check reads it. */
export interface SeoAuditPage {
  screenId: string
  /** The public path, `/` for the home page. */
  path: string
  name: string
  versionId: string | null
  /** The listing as the page's head renders it: a title's variables already resolved. */
  seo: {
    title?: string | null
    description?: string | null
    breadcrumb?: string | null
    image?: string | null
    imageAlt?: string | null
  }
  /** The screen's own description, which the head falls back to. */
  description?: string | null
  facts: SeoPageFacts
  /** Whether another checked page or a shared layout links here. */
  linkedFrom: boolean
  keywords: readonly string[]
}

/** The site as the check reads it. */
export interface SeoAuditSite {
  discouraged: boolean
  entity: { name?: string | null; description?: string | null }
  agent: { whenToUse?: string | null }
}

const blank = (value: string | null | undefined): boolean => !String(value ?? '').trim()
const normalized = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** A path as the keyword lines and the routing map both spell it: leading slash, no trailing one. */
export function seoNormalizePath(path: string): string {
  const trimmed = String(path ?? '').trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

/**
 * Target keywords per page, one line a page: `/pricing: plans, pricing`.
 * A line without a path names no page; a path the site does not publish is
 * reported by the scan that matches the lines to pages.
 */
export function parseSeoKeywordLines(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const line of String(raw ?? '').split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const path = seoNormalizePath(line.slice(0, at))
    const keywords = seoKeywordList(line.slice(at + 1))
    if (keywords.length) out[path] = seoKeywordList([...(out[path] ?? []), ...keywords])
  }
  return out
}

function finding(
  code: SeoFindingCode,
  severity: SeoSeverity,
  message: string,
  extra: Partial<Pick<SeoFinding, 'nodeIds' | 'screenIds' | 'keyword'>> = {},
): SeoFinding {
  return { code, severity, message, ...extra }
}

/** The pages that share one value, by that value. */
function sharedValues(
  pages: readonly SeoAuditPage[],
  read: (page: SeoAuditPage) => string | null | undefined,
): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const page of pages) {
    const key = normalized(read(page))
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), page.screenId])
  }
  return new Map([...groups].filter(([, ids]) => ids.length > 1))
}

function coverageOf(page: SeoAuditPage): SeoKeywordCoverage[] {
  return seoKeywordCoverage(page.keywords, {
    title: page.seo.title,
    description: page.seo.description,
    h1: page.facts.h1s[0]?.text,
    body: page.facts.text,
  })
}

function pageFindings(
  page: SeoAuditPage,
  titles: Map<string, string[]>,
  descriptions: Map<string, string[]>,
  coverage: readonly SeoKeywordCoverage[],
): SeoFinding[] {
  const out: SeoFinding[] = []
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

function scoreOf(findings: readonly SeoFinding[]): number {
  return Math.max(0, 100 - findings.reduce((sum, entry) => sum + SEVERITY_WEIGHT[entry.severity], 0))
}

/** Check the pages and the site; nothing here reads, writes or generates. */
export function seoAudit(
  pages: readonly SeoAuditPage[],
  site: SeoAuditSite,
  options: { skipped?: number; notes?: readonly string[] } = {},
): SeoAuditReport {
  const titles = sharedValues(pages, (page) => page.seo.title)
  const descriptions = sharedValues(pages, (page) => page.seo.description)
  const reports: SeoPageReport[] = pages.map((page) => {
    const keywords = coverageOf(page)
    const findings = pageFindings(page, titles, descriptions, keywords)
    return {
      screenId: page.screenId,
      path: page.path,
      name: page.name,
      versionId: page.versionId,
      score: scoreOf(findings),
      findings,
      keywords,
    }
  })

  const siteFindings: SeoFinding[] = []
  if (site.discouraged) {
    siteFindings.push(finding('search-discouraged', 'high', 'Search engines are asked not to index this site, so none of its pages appear in results.'))
  }
  if (blank(site.entity.name) || blank(site.entity.description)) {
    siteFindings.push(finding('entity-incomplete', 'low', 'The structured data does not name and describe who publishes the site.'))
  }
  if (blank(site.agent.whenToUse)) {
    siteFindings.push(finding('llms-guidance-missing', 'low', '/llms.txt carries no guidance of your own for AI agents.'))
  }

  return {
    pages: reports,
    skipped: Math.max(0, options.skipped ?? 0),
    site: siteFindings,
    score: reports.length
      ? Math.round(reports.reduce((sum, report) => sum + report.score, 0) / reports.length)
      : 100,
    notes: [...(options.notes ?? [])],
  }
}

/** How many findings a report holds, the site's included. */
export function seoAuditFindingCount(report: Pick<SeoAuditReport, 'pages' | 'site'>): number {
  return report.pages.reduce((sum, page) => sum + page.findings.length, report.site.length)
}
