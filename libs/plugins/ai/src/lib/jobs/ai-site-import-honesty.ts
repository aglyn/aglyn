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

/*==========================================
 * NEW COPY MAY SAY WHAT THE SOURCE SUPPORTS, AND NOTHING IT DOES NOT (AGL-4152).
 *
 * A redesign may describe what the source says and what this kind of business
 * generally does. It may not make up a name, number, price, date, testimonial,
 * client, award, credential, address or guarantee, and it may not lose what
 * the ledger holds. This is the gate, pure, one answer at a time:
 *
 * - `improve-invented-fact`: a word of its copy says a fact, a name, a
 *   credential or a guarantee outside what the import read, or a link goes
 *   somewhere the source does not.
 * - `improve-dropped-item`: something the ledger holds is not on the page, or
 *   is on it twice.
 *
 * Each names the line, so the one re-ask can mend that line.
 *=========================================*/

import { aiLayoutGuardContacts } from '../layout-language/ai-layout-copy'
import type { AiLayoutBlock, AiLayoutItem } from '../layout-language/ai-layout-language'
import { siteImportFactScope, siteImportFactTokens, type SiteImportFactScope } from '../model/ai-site-import-fidelity'
import type { SiteImportLedger } from '../model/ai-site-import-ledger'
import { detectOffVoiceCopy, type AiCopyFraming, type AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { aiPlaceholderTokens } from '../runtime/ai-placeholder-tokens'

export const AI_SITE_IMPORT_INVENTED_FACT_CODE = 'improve-invented-fact'
export const AI_SITE_IMPORT_DROPPED_ITEM_CODE = 'improve-dropped-item'

/** A block a redesign answered: the layout language, or a `keep` of a ledger ref. */
export type AiSiteImportImprovedBlock = (Omit<AiLayoutBlock, 'kind'> & { kind: AiLayoutBlock['kind'] }) | { kind: 'keep'; ref: string; col?: number }

/** A section a redesign answered. */
export interface AiSiteImportImprovedSection {
  band?: 'plain' | 'soft' | 'brand' | 'dark'
  cols?: number[]
  align?: 'start' | 'center'
  blocks: AiSiteImportImprovedBlock[]
}

/** What a redesign's copy is held against. */
export interface AiSiteImportHonestyScope {
  ledger: SiteImportLedger
  /** Every line the import read: this page's, the wave's other pages', and what the home page says of the site. */
  scope: readonly string[]
  /** Where a link may go, as an answer writes it, and the ledger's links' own destinations. */
  destinations: ReadonlyMap<string, string>
  framing?: AiCopyFraming | null
}

/** Words past a sentence's first that are no one's name, in any heading: the short form of a question list. */
const NO_NAMES = new Set(['FAQ', 'FAQs', 'I'])

/**
 * Credentials and guarantees: outside what the source says, each is a claim
 * only its owner can make, however a sentence puts it.
 */
const CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['licensed', /\blicen[sc]ed\b/i],
  ['certified', /\b(?:board-)?certified\b/i],
  ['accredited', /\baccredited\b/i],
  ['insured', /\binsured\b/i],
  ['bonded', /\bbonded\b/i],
  ['award', /\baward(?:s|-winning)?\b/i],
  ['guarantee', /\bguarantee[ds]?\b/i],
  ['warranty', /\bwarrant(?:y|ies)\b/i],
  ['money-back', /\bmoney[- ]back\b/i],
  ['top-rated', /\btop[- ]rated\b/i],
  ['five-star', /\b(?:5|five)[- ]star\b/i],
  ['voted', /\bvoted\b/i],
  ['featured in', /\bfeatured in\b/i],
  ['trusted by', /\btrusted by\b/i],
]

/** A count no digit says: "hundreds of clients", "two decades", "ten years". */
const COUNTS = [
  /\b(?:hundreds|thousands|millions|dozens|decades?|centur(?:y|ies))\b/i,
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\s+(?:years?|clients?|customers?|families|projects?|homes?|offices?|locations?|reviews?|stars?)\b/i,
]

/** A word that opens a line in quotation marks and runs on: a testimonial, whoever is made to say it. */
const QUOTED = /^["“”'‘][^"“”]{15,}["“”]/

/** Whether text is in the source's own words: its fact tokens, and whatever a scope says of it. */
export interface AiSiteImportHonestyFacts {
  facts: SiteImportFactScope
  tokens: ReadonlySet<string>
  /** The source's words, as one text, for what a claim is checked against. */
  said: string
}

/** What every line of an answer is checked against. */
export function aiSiteImportHonestyFacts(scope: readonly string[]): AiSiteImportHonestyFacts {
  const facts = siteImportFactScope(scope)
  return { facts, tokens: new Set(scope.flatMap((text) => siteImportFactTokens(text, facts, false))), said: scope.join(' \n ') }
}

const shown = (token: string) => `"${token.replace(/^[a-z]+:/, '')}"`

/** What one line of new copy says that the source does not: a reason in words, or `null`. */
export function aiSiteImportInventedIn(text: string, held: AiSiteImportHonestyFacts): string | null {
  const invented = siteImportFactTokens(text, held.facts, true).filter((token) => !held.tokens.has(token) && !(token.startsWith('name:') && NO_NAMES.has(token.slice(5))))
  if (invented.length) return `it says ${[...new Set(invented)].map(shown).join(', ')}, which nothing the site says supports. Say only names and figures the site gives; a heading is in sentence case, so a capital reads as a name.`
  for (const [claim, pattern] of CLAIMS) {
    if (pattern.test(text) && !pattern.test(held.said)) return `it claims ${shown(claim)}, which the site does not. Leave credentials, awards and guarantees to the owner.`
  }
  for (const pattern of COUNTS) {
    const found = pattern.exec(text)?.[0]
    if (found && !new RegExp(`\\b${found.replace(/\s+/g, '\\s+')}\\b`, 'i').test(held.said)) return `it says ${shown(found)}, a count the site does not give.`
  }
  if (QUOTED.test(text.trim()) && !held.said.includes(text.trim().slice(1, 20))) return 'it reads as a testimonial the site does not have. Quote a customer only by keeping their quote.'
  return null
}

/** Each written line of a block, as its place on the page names it. */
function writtenLines(block: AiLayoutBlock, at: string): Array<{ at: string; text: string }> {
  const out: Array<{ at: string; text: string }> = []
  if (block.text && block.kind !== 'image') out.push({ at, text: block.text })
  ;(block.items ?? []).forEach((item: AiLayoutItem, index) => {
    if (item.title.trim()) out.push({ at: `${at}, item ${index + 1}`, text: item.title })
    if (item.text.trim()) out.push({ at: `${at}, item ${index + 1}`, text: item.text })
  })
  return out
}

/** Where a block sends a visitor, its own and its items'. */
const linksOf = (block: AiLayoutBlock): string[] => [...(block.to ? [block.to] : []), ...(block.items ?? []).flatMap((item) => (item.to ? [item.to] : []))]

/** Every picture ref an answer's blocks place. */
const placedOf = (sections: readonly AiSiteImportImprovedSection[]): string[] =>
  sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === 'keep' ? [(block as { ref: string }).ref] : ((block as AiLayoutBlock).items ?? []).flatMap((item) => (item.ref ? [item.ref] : [])))),
  )

const invented = (message: string, detail?: string): AiDoctrineViolation => ({ rule: 14, code: AI_SITE_IMPORT_INVENTED_FACT_CODE, message, ...(detail ? { detail } : {}) })
const dropped = (message: string): AiDoctrineViolation => ({ rule: null, code: AI_SITE_IMPORT_DROPPED_ITEM_CODE, message })

/**
 * An answer held to what the import read, and to its ledger (AGL-4152). No
 * violation is a redesign that may be built; each one names its line.
 */
export function aiSiteImportHonesty(sections: readonly AiSiteImportImprovedSection[], input: AiSiteImportHonestyScope): AiDoctrineViolation[] {
  const held = aiSiteImportHonestyFacts(input.scope)
  const contacts = input.scope.join(' \n ')
  const out: AiDoctrineViolation[] = []
  const refs = new Map(input.ledger.items.map((item) => [item.ref, item]))
  const placed = placedOf(sections)
  const links = new Set<string>()
  sections.forEach((section, index) => {
    section.blocks.forEach((raw, position) => {
      if (raw.kind === 'keep') return
      const block = raw as AiLayoutBlock
      const at = `section ${index + 1}, block ${position + 1}`
      for (const line of writtenLines(block, at)) {
        const reason = aiSiteImportInventedIn(line.text, held)
        if (reason) out.push(invented(`${line.at}, "${line.text.slice(0, 80)}": ${reason}`))
        else if (aiLayoutGuardContacts(line.text, contacts) !== line.text) out.push(invented(`${line.at}, "${line.text.slice(0, 80)}": it gives a phone number or email the site does not.`))
        else if (/\[[^\]]*\]/.test(line.text) || aiPlaceholderTokens(line.text).length || detectOffVoiceCopy([{ at: 'line', text: line.text }], input.framing ?? null).length) {
          out.push(invented(`${line.at}, "${line.text.slice(0, 80)}": it holds filler, a placeholder or a word that calls the work simple or cheap. Write real words.`))
        }
      }
      for (const to of linksOf(block)) {
        if (input.destinations.has(to)) links.add(input.destinations.get(to) as string)
        else out.push(invented(`${at}: it links to "${to.slice(0, 80)}", which is not a page of this site, form, phone, email, a section as #n, or an address the source links.`))
      }
    })
  })
  // What the ledger holds: each thing that must land, once; no ref twice, and none it does not hold.
  for (const ref of new Set(placed)) {
    if (!refs.has(ref)) out.push(dropped(`keep "${ref.slice(0, 40)}" names nothing on this page. Use only the refs the page lists.`))
    else if (placed.filter((entry) => entry === ref).length > 1) out.push(dropped(`${ref} is placed ${placed.filter((entry) => entry === ref).length} times. Place it once.`))
  }
  for (const item of input.ledger.items) {
    if (item.must && !placed.includes(item.ref)) out.push(dropped(`${item.ref} is not on the page. Place it with a keep block, exactly once.`))
  }
  const kept = new Set(sections.flatMap((section) => section.blocks.flatMap((block) => (block.kind === 'keep' ? [(block as { ref: string }).ref] : []))))
  const keptLines = new Set(input.ledger.items.filter((item) => kept.has(item.ref)).flatMap((item) => item.lines))
  for (const link of input.ledger.links) {
    const to = input.destinations.get(link.ref)
    if (!to || links.has(to) || keptLines.has(link.line)) continue
    out.push(dropped(`${link.ref} ("${link.text.slice(0, 60)}") goes nowhere on the page. Link to it from a button or an item.`))
  }
  return out
}
