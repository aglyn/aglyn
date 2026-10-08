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

import { SEO_LISTING_FIELDS } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import {
  findInventedPrices,
  findStorefrontClaims,
  storefrontClaimViolations,
  type AiStorefrontCopySample,
} from '../model/ai-storefront-claims'
import type { AiTool } from '../providers/contract'
import type { AiGenerationCheckResult } from '../runtime/ai-doctrine'
import { detectOffVoiceCopy, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * The strict tool a site's first posts are written through (AGL-3676), and
 * the check that holds each post to what the site's collection publishes.
 *
 * A post is published with the site, as its own words, so nothing in it may
 * mark a gap for later: no square brackets, no link, no markup the entry
 * renderer does not read. Its body is the markdown-lite the entry editor
 * writes — `##` subheadings, `-` lists, `**bold**`, `*italic*` — and its
 * title, excerpt and search description are plain text. The storefront copy
 * rules hold every part (no health, financial or legal promise; no
 * certification, award or endorsement the brief does not state; no price),
 * and so does a rule of its own: no star rating, review score or testimonial
 * nobody gave.
 */

export const AI_BLOG_POST_TOOL_NAME = 'write_blog_post'

/** A post's bounds, as the tool states them and its check holds them. */
export const AI_BLOG_POST_LIMITS = {
  titleMax: 80,
  excerptMax: 200,
  bodyMin: 600,
  bodyMax: 4_000,
  seoDescriptionMax: SEO_LISTING_FIELDS.description.maxLength,
} as const

/** A post as its check reads it. */
export interface AiBlogPost {
  title: string
  excerpt: string
  /** Markdown-lite. */
  body: string
  seoDescription: string
}

const string = (description: string) => ({ type: 'string', description })

export const AI_BLOG_POST_TOOL: AiTool = {
  name: AI_BLOG_POST_TOOL_NAME,
  description: 'Write one post of a new blog. Every field is required.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'excerpt', 'body', 'seoDescription'],
    properties: {
      title: string(`Plain text, at most ${AI_BLOG_POST_LIMITS.titleMax} characters.`),
      excerpt: string(`One or two plain sentences, at most ${AI_BLOG_POST_LIMITS.excerptMax} characters.`),
      body: string(
        `Markdown-lite, ${AI_BLOG_POST_LIMITS.bodyMin} to ${AI_BLOG_POST_LIMITS.bodyMax} characters: short paragraphs, ## subheadings, - lists, **bold**. No title line.`,
      ),
      seoDescription: string(`One plain sentence, at most ${AI_BLOG_POST_LIMITS.seoDescriptionMax} characters.`),
    },
  },
}

interface Findings {
  violations: AiDoctrineViolation[]
  offending: Record<string, unknown>
}

function fail(findings: Findings, at: string, code: string, message: string, value: unknown): void {
  findings.violations.push({ rule: null, code, message, paths: [at] })
  if (!(at in findings.offending)) findings.offending[at] = value
}

const line = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** Paragraphs: spaces folded within a line, at most one blank line between paragraphs. */
const paragraphs = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((part) => part.replace(/[ \t\f\v]+/g, ' ').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : ''

const HTML = /<\/?[a-z][^>]*>/i
const PLAIN_MARKS = /(^|\n)\s*#{1,6}\s|\*\*[^*\n]+\*\*|__[^_\n]+__|`/
const EMOJI = /\p{Extended_Pictographic}/u
const BRACKET = /[[\]]/
const URL = /\bhttps?:\/\/|\bwww\./i
/** A heading deeper than the entry renderer's subheadings, or a title line. */
const TITLE_HEADING = /(^|\n)\s*#\s/
/** A rating or review score nobody gave. */
const RATING = /\b\d(?:\.\d)?\s*(?:\/\s*(?:5|10)\b|out of (?:5|five|10|ten)\b|stars?\b)|\b(?:five|5|four|4)[- ]star\b|\brated\b|\breviews? (?:say|rave|agree)\b/i

/** One plain-text field: there, within its length, unmarked. */
function checkPlain(findings: Findings, at: string, raw: unknown, label: string, max: number): string {
  if (typeof raw !== 'string') {
    fail(findings, at, 'type', `${label} must be text.`, raw)
    return ''
  }
  const value = line(raw)
  if (!value) {
    fail(findings, at, 'missing', `${label} is required.`, raw)
    return ''
  }
  if (value.length > max) fail(findings, at, 'too-long', `${label} is ${value.length} characters; it may have ${max}.`, raw)
  if (HTML.test(value) || PLAIN_MARKS.test(value)) fail(findings, at, 'markup', `${label} is plain text, with no formatting marks.`, raw)
  if (EMOJI.test(value)) fail(findings, at, 'emoji', `${label} holds no emoji.`, raw)
  if (URL.test(value)) fail(findings, at, 'link', `${label} holds no link.`, raw)
  if (BRACKET.test(value)) {
    fail(findings, at, 'bracket', `${label} is published as written, so it marks no missing fact in brackets.`, raw)
  }
  return value
}

/**
 * A post's answer held to the collection it is published in and the copy
 * rules. `merchantWords` are the brief and the site's own answers, the only
 * source a stated claim or price may come from; `earlierTitles` are the posts
 * already written, which this one must not repeat.
 */
export function checkAiBlogPost(
  answer: Record<string, unknown>,
  context: { merchantWords: string; earlierTitles?: readonly string[] },
): AiGenerationCheckResult<AiBlogPost> {
  const findings: Findings = { violations: [], offending: {} }
  const limits = AI_BLOG_POST_LIMITS
  const title = checkPlain(findings, 'title', answer['title'], 'The title', limits.titleMax)
  if (title && (context.earlierTitles ?? []).some((earlier) => earlier.trim().toLowerCase() === title.toLowerCase())) {
    fail(findings, 'title', 'title-duplicate', 'Another post already has this title; write about something else.', answer['title'])
  }
  const excerpt = checkPlain(findings, 'excerpt', answer['excerpt'], 'The excerpt', limits.excerptMax)
  const seoDescription = checkPlain(
    findings,
    'seoDescription',
    answer['seoDescription'],
    'The search description',
    limits.seoDescriptionMax,
  )
  const raw = answer['body']
  const body = paragraphs(raw)
  if (typeof raw !== 'string' || !body) {
    fail(findings, 'body', 'missing', 'The body is required.', raw)
  } else {
    if (body.length < limits.bodyMin || body.length > limits.bodyMax) {
      fail(findings, 'body', 'length', `The body is ${body.length} characters; write ${limits.bodyMin} to ${limits.bodyMax}.`, raw)
    }
    if (HTML.test(body)) fail(findings, 'body', 'markup', 'The body is markdown-lite, with no HTML.', raw)
    if (TITLE_HEADING.test(body)) fail(findings, 'body', 'title-line', 'The title renders on its own; the body uses ## subheadings only.', raw)
    if (EMOJI.test(body)) fail(findings, 'body', 'emoji', 'The body holds no emoji.', raw)
    if (URL.test(body)) fail(findings, 'body', 'link', 'The body holds no link.', raw)
    if (BRACKET.test(body)) {
      fail(findings, 'body', 'bracket', 'The body is published as written, so it holds no square brackets: no links and no missing fact marked.', raw)
    }
  }
  const samples: AiStorefrontCopySample[] = [
    { at: 'title', text: title },
    { at: 'excerpt', text: excerpt },
    { at: 'body', text: body },
    { at: 'seoDescription', text: seoDescription },
  ]
  for (const sample of samples) {
    const rating = RATING.exec(sample.text)
    if (rating && !context.merchantWords.toLowerCase().includes(rating[0].toLowerCase())) {
      fail(findings, sample.at, 'rating-invented', `The post gives a rating or review nobody gave. Remove: "${rating[0]}".`, sample.text)
    }
  }
  findings.violations.push(
    ...storefrontClaimViolations(
      findStorefrontClaims(samples, context.merchantWords),
      findInventedPrices(samples, context.merchantWords),
    ),
    ...detectOffVoiceCopy(samples, null),
  )
  return {
    value: findings.violations.length ? null : { title, excerpt, body, seoDescription },
    violations: findings.violations,
    offending: findings.offending,
  }
}
