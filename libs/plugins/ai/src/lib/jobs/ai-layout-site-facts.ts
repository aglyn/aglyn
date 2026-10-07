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

import type { AiDoctrineNode, AiDoctrineTree, AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { walkTree } from '../runtime/ai-doctrine-validators'

/**
 * What a layout may say about the business it frames (AGL-3596).
 *
 * A layout's header and footer are on every page, so a fact in them is
 * published everywhere at once. Two went wrong on beta.230: the model coined
 * a name for the business ("Austin Paws Grooming" for a site called Hillside
 * Dog Grooming), and a footer is exactly where a model reaches for a phone
 * number, an email or opening hours the brief never gave.
 *
 * - The site's name is the brand, and it is written as the host token that
 *   reads it (`{{host.businessName}}`), so a rename in Setup follows on every
 *   page rather than leaving the name it was built under
 *   (`aiLayoutWithSiteName`).
 * - A contact detail the brief does not give is refused by the layout's own
 *   check (`aiLayoutInventedContactViolations`), so the model is asked again
 *   to leave it out: an email, a phone number, a street address or opening
 *   hours appear in the layout only when the brief has them.
 */

/** The host token that reads a site's own name at render. */
export const AI_SITE_NAME_TOKEN = '{{host.businessName}}'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The tree with every written occurrence of the site's name — the brand, the
 * copyright line — replaced by the host token that reads it. Matched whole,
 * ignoring case and runs of spaces. Anything that is not a node map, and a
 * name too short to match safely, leaves the tree as it came.
 */
export function aiLayoutWithSiteName(tree: unknown, siteName: string | null | undefined): unknown {
  const name = (siteName ?? '').replace(/\s+/g, ' ').trim()
  if (name.length < 3 || !isRecord(tree) || !isRecord(tree['nodes'])) return tree
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
  let changed = false
  const nodes: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(tree['nodes'])) {
    if (!isRecord(node) || !isRecord(node['props'])) {
      nodes[id] = node
      continue
    }
    const props: Record<string, unknown> = {}
    let touched = false
    for (const [key, value] of Object.entries(node['props'])) {
      const next = typeof value === 'string' ? value.replace(pattern, AI_SITE_NAME_TOKEN) : value
      if (next !== value) touched = true
      props[key] = next
    }
    nodes[id] = touched ? { ...node, props } : node
    changed ||= touched
  }
  return changed ? { ...tree, nodes } : tree
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
/** A phone number as people write one: seven or more digits, with the usual separators between them. */
const PHONE = /(?:\+?\(?\d[\d\s().-]{5,}\d)/g

const digitsOf = (value: string) => value.replace(/\D/g, '')

const STREET_SUFFIX =
  'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Circle|Cir|Square|Sq'
/** A street address as a footer writes one: a house number, one to four words, and a street suffix. */
const ADDRESS = new RegExp(`\\b\\d{1,6}\\s+(?:[A-Z0-9][\\w'.-]*\\s+){1,4}(?:${STREET_SUFFIX})\\b\\.?`, 'g')
const DAY = '(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)'
/**
 * Opening hours: a time of day ("9am", "8:30 PM") or a range of days
 * ("Mon–Fri", "Monday through Saturday"). A bare "9–5" is left alone, since
 * "2–3 weeks" is written the same way.
 */
const HOURS = new RegExp(
  [
    '\\b\\d{1,2}(?::\\d{2})?\\s?(?:[ap]\\.?m\\.?)(?![a-z])',
    `\\b${DAY}\\s?(?:[–—-]|to|through|thru)\\s?${DAY}\\b`,
  ].join('|'),
  'gi',
)

/** SVG path data: a move command, then only commands and numbers. */
const SVG_PATH_DATA = /^\s*[Mm][\s\d.,eE+-]*[\d.][\s\d.,eE+\-MmLlHhVvCcSsQqTtAaZz]*$/

/** The words of an address, as a brief and a layout can both spell them. */
const addressKey = (value: string) => {
  const [number, word] = value.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return `${number ?? ''} ${word ?? ''}`
}

/**
 * The contact details a brief gives: its email addresses, the digits of its
 * phone numbers, the house number and first word of its street addresses,
 * and whether it gives opening hours at all.
 */
function briefFacts(brief: string): { emails: Set<string>; digits: string; addresses: Set<string>; hours: boolean } {
  return {
    emails: new Set((brief.match(EMAIL) ?? []).map((email) => email.toLowerCase())),
    digits: digitsOf(brief),
    addresses: new Set((brief.match(ADDRESS) ?? []).map(addressKey)),
    hours: new RegExp(HOURS.source, 'i').test(brief),
  }
}

/**
 * Rule 14 for a layout: every email address, phone number, street address
 * and opening time its words carry is one the brief gives. A number is read
 * by its digits, so a brief's "512.555.0142" admits "(512) 555-0142"; a year
 * or a price is not a phone number, so only a run of seven digits or more is
 * read as one. An address is matched by its house number and first street
 * word; hours are admitted when the brief gives any, since a brief that names
 * its hours is spelled a dozen ways a footer may fairly reword.
 */
export function aiLayoutInventedContactViolations(tree: AiDoctrineTree, brief: string): AiDoctrineViolation[] {
  const given = briefFacts(brief)
  const invented: string[] = []
  const nodeIds: string[] = []
  for (const { id, node } of walkTree(tree)) {
    for (const value of Object.values((node as AiDoctrineNode).props ?? {})) {
      // An icon's drawing (`iconPath`) is SVG path data, whose coordinates read as phone numbers.
      if (typeof value !== 'string' || SVG_PATH_DATA.test(value)) continue
      const matches = (pattern: RegExp): string[] => [...(value.match(pattern) ?? [])]
      const found: string[] = [
        ...matches(EMAIL).filter((email) => !given.emails.has(email.toLowerCase())),
        ...matches(PHONE).filter((phone) => {
          const digits = digitsOf(phone)
          return digits.length >= 7 && !given.digits.includes(digits)
        }),
        ...matches(ADDRESS).filter((address) => !given.addresses.has(addressKey(address))),
        ...(given.hours ? [] : matches(HOURS)),
      ]
      if (!found.length) continue
      invented.push(...found.map((fact) => fact.trim()))
      if (!nodeIds.includes(id)) nodeIds.push(id)
    }
  }
  if (!invented.length) return []
  return [
    {
      rule: 14,
      code: 'contact-not-in-brief',
      message: `${[...new Set(invented)].map((fact) => `"${fact}"`).join(', ')} is not in the brief. A layout shows only the contact details the brief gives: leave this out, and never invent one.`,
      nodeIds,
    },
  ]
}
