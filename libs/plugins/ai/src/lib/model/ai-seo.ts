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
  isSeoListingFieldKey,
  type SeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { AiJobOutput, AiJobSummary } from './ai-jobs.types'

/**
 * SEO by AI (AGL-2910): the proposals an `seo` job produces, in the shape
 * both the job step and the console cards read. Pure data and readers — no
 * server import — so a card can type what it renders from the same module
 * the step writes it with.
 *
 * ## Proposals, never writes
 *
 * Every value here is a PROPOSAL. A page's search listing is served from the
 * screen document, so a job never writes it: the values are staged in the
 * page's SEO card and saved there. A site audit's content fixes — an image
 * description, a page's one `h1` — become a new unpublished version only
 * when a person applies them, and the site-wide proposals land in the SEO
 * form unsaved. Nothing a job produces changes what a published site serves.
 *
 * ## The outputs of a job
 *
 * - `fields:{screen|product}:{id}` — one listing's values ({@link AiSeoFieldsProposal}).
 * - `audit:report` — the site audit: every audited page, its findings and
 *   its score, and which pages need generated fixes ({@link AiSeoAuditReport}).
 * - `audit:site` — structured data for the site's entity and the agent
 *   guidance `/llms.txt` leads with ({@link AiSeoSiteBatch}).
 * - `audit:fixes:{n}` — one batch of page fixes ({@link AiSeoFixesBatch}).
 */

/** What an `seo` job is about, as its `inputs.target` names it. */
export type AiSeoTarget = 'screen' | 'product' | 'site'

export const AI_SEO_TARGETS: readonly AiSeoTarget[] = ['screen', 'product', 'site']

/** What an `seo` job is about, or `null` when its inputs name nothing an SEO job writes. */
export function aiSeoJobTarget(inputs: Record<string, unknown> | null | undefined): AiSeoTarget | null {
  const target = inputs?.['target']
  return typeof target === 'string' && (AI_SEO_TARGETS as readonly string[]).includes(target)
    ? (target as AiSeoTarget)
    : null
}

/** Proposed values for one listing, by field. */
export type AiSeoFieldValues = Partial<Record<SeoListingFieldKey, string>>

/** Whether, and where, a page already says a target keyword. */
export interface AiSeoKeywordCoverage {
  keyword: string
  inTitle: boolean
  inDescription: boolean
  inH1: boolean
  inBody: boolean
}

/** A proposal for one page's or one product's search listing. */
export interface AiSeoFieldsProposal {
  kind: 'fields'
  subject: {
    kind: 'screen' | 'product'
    /** `null` for a product not saved yet. */
    id: string | null
    name: string
    /** The page's public path, for a screen. */
    path?: string | null
  }
  values: AiSeoFieldValues
  /** The target keywords the listing was asked to cover, and where it now does. */
  keywords: AiSeoKeywordCoverage[]
  /** Customer-safe lines worth knowing (a field left out, and why). */
  notes: string[]
}

export type AiSeoFindingCode =
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

export type AiSeoSeverity = 'high' | 'medium' | 'low'

export interface AiSeoFinding {
  code: AiSeoFindingCode
  severity: AiSeoSeverity
  /** One customer-safe sentence. */
  message: string
  /** The elements it is about: the images without a description, the extra headings. */
  nodeIds?: string[]
  /** The other pages it involves: a duplicate's twins. */
  screenIds?: string[]
  /** The target keyword, for `keyword-missing`. */
  keyword?: string
}

/** One audited page. */
export interface AiSeoPageReport {
  screenId: string
  /** The public path, `/` for the home page. */
  path: string
  name: string
  /** The published version the page was audited on. */
  versionId: string | null
  /** 100 with nothing found, less for each finding by its severity. */
  score: number
  findings: AiSeoFinding[]
  keywords: AiSeoKeywordCoverage[]
}

/** The site audit: every audited page, what was found, and what still needs generating. */
export interface AiSeoAuditReport {
  kind: 'audit'
  pages: AiSeoPageReport[]
  /** Published pages past the audit's page cap, not audited. */
  skipped: number
  /** Findings about the site rather than a page. */
  site: AiSeoFinding[]
  /** Whether the site-wide proposal (structured data, agent guidance) is owed. */
  siteProposal: boolean
  /** Pages whose fixes need generated text, in the order the batches take them. */
  queue: string[]
  /** How many pages one batch of fixes carries. */
  batchSize: number
  /** The average page score. */
  score: number
  /** Customer-safe lines about the audit itself: a keyword line naming no page, say. */
  notes: string[]
}

/** A content fix: applied into a NEW version of the page, never the published one. */
export type AiSeoContentFix =
  /** An image with no description gets one. */
  | { kind: 'image-alt'; nodeId: string; alt: string }
  /** An existing heading becomes the page's `h1`, with this text. */
  | { kind: 'h1-set'; nodeId: string; text: string }
  /** A page with no heading to promote gets a new `h1` at the top of its content. */
  | { kind: 'h1-insert'; text: string }
  /** An extra `h1` becomes an `h2`, so the page keeps one. */
  | { kind: 'h1-demote'; nodeId: string }

/** Everything proposed for one page. */
export interface AiSeoPageFix {
  screenId: string
  /** Listing values, staged in the page's SEO card and saved there. */
  values: AiSeoFieldValues
  content: AiSeoContentFix[]
  /** Findings with no fix a job can make — an orphan needs a person's link. */
  guidance: string[]
}

export interface AiSeoFixesBatch {
  kind: 'fixes'
  /** 1-based. */
  batch: number
  fixes: AiSeoPageFix[]
  notes: string[]
}

/** The site's structured-data fields a proposal may fill, by form field name. */
export const AI_SEO_ENTITY_FORM_FIELDS = [
  'seo.entity.type',
  'seo.entity.name',
  'seo.entity.description',
  'seo.entity.email',
  'seo.entity.telephone',
  'seo.entity.contactType',
] as const

/** The agent guidance fields `/llms.txt` leads with, by form field name. */
export const AI_SEO_AGENT_FORM_FIELDS = ['seo.agent.whenToUse', 'seo.agent.howToUse'] as const

export type AiSeoSiteFormField =
  | (typeof AI_SEO_ENTITY_FORM_FIELDS)[number]
  | (typeof AI_SEO_AGENT_FORM_FIELDS)[number]

export interface AiSeoSiteProposal {
  /** Values for the site SEO form, by field name; only what the site's pages support. */
  values: Partial<Record<AiSeoSiteFormField, string>>
  /** `/llms.txt` as it would read once the guidance is saved. */
  llmsPreview: string
  notes: string[]
}

export interface AiSeoSiteBatch {
  kind: 'site'
  site: AiSeoSiteProposal
}

export type AiSeoProposal =
  | AiSeoFieldsProposal
  | AiSeoAuditReport
  | AiSeoFixesBatch
  | AiSeoSiteBatch

/** Output ids, one place. */
export const AI_SEO_OUTPUT_IDS = {
  report: 'audit:report',
  site: 'audit:site',
  fixes: (batch: number) => `audit:fixes:${batch}`,
  fields: (kind: 'screen' | 'product', id: string | null) => `fields:${kind}:${id ?? 'new'}`,
} as const

/** What each finding is called where it is listed. */
export const AI_SEO_FINDING_LABELS: Record<AiSeoFindingCode, string> = {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

function readValues(value: unknown): AiSeoFieldValues {
  const out: AiSeoFieldValues = {}
  if (!isRecord(value)) return out
  for (const [key, entry] of Object.entries(value)) {
    if (isSeoListingFieldKey(key) && typeof entry === 'string') out[key] = entry
  }
  return out
}

/** A stored proposal, or `null` for anything that is not one. */
export function readAiSeoProposal(value: unknown): AiSeoProposal | null {
  if (!isRecord(value)) return null
  switch (value['kind']) {
    case 'fields': {
      const subject = isRecord(value['subject']) ? value['subject'] : null
      if (!subject || (subject['kind'] !== 'screen' && subject['kind'] !== 'product')) return null
      return {
        kind: 'fields',
        subject: {
          kind: subject['kind'],
          id: typeof subject['id'] === 'string' ? subject['id'] : null,
          name: String(subject['name'] ?? ''),
          path: typeof subject['path'] === 'string' ? subject['path'] : null,
        },
        values: readValues(value['values']),
        keywords: Array.isArray(value['keywords']) ? (value['keywords'] as AiSeoKeywordCoverage[]) : [],
        notes: strings(value['notes']),
      }
    }
    case 'audit':
      return Array.isArray(value['pages']) ? (value as unknown as AiSeoAuditReport) : null
    case 'fixes':
      return Array.isArray(value['fixes']) ? (value as unknown as AiSeoFixesBatch) : null
    case 'site':
      return isRecord(value['site']) ? (value as unknown as AiSeoSiteBatch) : null
    default:
      return null
  }
}

/** One site audit, put back together from a job's outputs. */
export interface AiSeoAuditView {
  report: AiSeoAuditReport
  /** Every page fix proposed so far, by screen id. */
  fixes: Record<string, AiSeoPageFix>
  site: AiSeoSiteProposal | null
  /** Batches recorded so far. */
  batches: number
  /** Whether every batch the report queued has been recorded. */
  complete: boolean
}

/** The audit a job's outputs describe, or `null` when they describe none. */
export function aiSeoAuditView(outputs: readonly AiJobOutput[]): AiSeoAuditView | null {
  let report: AiSeoAuditReport | null = null
  let site: AiSeoSiteProposal | null = null
  const fixes: Record<string, AiSeoPageFix> = {}
  let batches = 0
  for (const output of outputs) {
    if (output.resource !== 'seo') continue
    const proposal = readAiSeoProposal(output.proposal)
    if (!proposal) continue
    if (proposal.kind === 'audit') report = proposal
    else if (proposal.kind === 'site') site = proposal.site
    else if (proposal.kind === 'fixes') {
      batches += 1
      for (const fix of proposal.fixes) fixes[fix.screenId] = fix
    }
  }
  if (!report) return null
  const owedBatches = Math.ceil(report.queue.length / Math.max(1, report.batchSize))
  return {
    report,
    fixes,
    site,
    batches,
    complete: batches >= owedBatches && (!report.siteProposal || site !== null),
  }
}

/** The listing proposal a job produced, when it produced one. */
export function aiSeoFieldsProposalOf(job: Pick<AiJobSummary, 'outputs'> | null): AiSeoFieldsProposal | null {
  for (const output of job?.outputs ?? []) {
    if (output.resource !== 'seo') continue
    const proposal = readAiSeoProposal(output.proposal)
    if (proposal?.kind === 'fields') return proposal
  }
  return null
}

/** How many content fixes, and how many staged listings, an audit view would apply. */
export function aiSeoApplyCounts(view: AiSeoAuditView): { pagesWithContent: number; pagesWithValues: number } {
  let pagesWithContent = 0
  let pagesWithValues = 0
  for (const fix of Object.values(view.fixes)) {
    if (fix.content.length) pagesWithContent += 1
    if (Object.keys(fix.values).length) pagesWithValues += 1
  }
  return { pagesWithContent, pagesWithValues }
}
