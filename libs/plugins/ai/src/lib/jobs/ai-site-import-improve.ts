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
 * IMPROVE IT, GENERATIVE: A PAGE REDESIGNED FROM A LEDGER (AGL-4152).
 *
 * Today's Improve it draws the source's layout in a new design and rewords its
 * lines in place. Behind `SITE_IMPORT_GENERATIVE_RELEASE_FLAG` a main page is
 * instead designed the way Start with AI designs one, from what the import
 * read: one `submit_improved_page` answer plans the sections and the grid and
 * writes the words, and code places what the source holds.
 *
 *   1. The answer is told the page as a LEDGER (`aiSiteImportLedgerText`): each
 *      picture, form, plan, table, quote, video and contact line by a ref a
 *      `keep` block places, each link's destination, and the numbered lines it
 *      rewrites freely.
 *   2. It is held by code: the honesty validator over its words and its refs
 *      (`ai-site-import-honesty.ts`), then the page compiled and scored on the
 *      kept ledger and the design lines (`siteImportFidelity`). A miss is named
 *      in the one re-ask.
 *   3. Compiled by the site compiler with `keep` expanded to the source's own
 *      blocks, and a picture asked for in words left as a slot the page step's
 *      pictures fill or drop.
 *
 * Nothing here runs with the flag off, or for Keep my site.
 *=========================================*/

import { fenceUntrustedText, UNTRUSTED_TEXT_RULE } from '@aglyn/shared-util-tools/untrusted-text'
import type { AiLayoutDesign, AiLayoutHeroVariant } from '../layout-language/ai-layout-design'
import { aiLayoutDesignChoices, aiLayoutGroupVariant } from '../layout-language/ai-layout-design'
import {
  AI_LAYOUT_ALIGNS,
  AI_LAYOUT_BANDS,
  AI_LAYOUT_MAX_COLS,
  AI_LAYOUT_STYLES,
  aiReadLayoutBlock,
  type AiLayoutBlock,
  type AiLayoutImportHero,
  type AiLayoutItem,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from '../layout-language/ai-layout-language'
import { AI_ICON_WORDS } from '../runtime/ai-icon-library'
import type { AiSiteImportAddedSection, AiSiteImportPagePictures, AiSiteImportPageRole, AiSiteImportPlan } from '../model/ai-site-import'
import { aiSiteHomeArc } from '../model/ai-site-home-arcs'
import { siteImportContentKept, type SiteImportFidelityTheme, type SiteImportPageFidelity } from '../model/ai-site-import-fidelity'
import { siteImportLedger, type SiteImportLedger, type SiteImportLedgerItem } from '../model/ai-site-import-ledger'
import { AI_SITE_IMPORT_PAGE_CEILING_CREDITS } from '../model/ai-site-import'
import { estimateAiBilledUsd } from '../providers/catalog'
import type { AiSystemBlock, AiTool, AiUsage } from '../providers/contract'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import type { AiGenerationCheck } from '../runtime/ai-doctrine'
import type { AiCopyFraming, AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import type { SiteImportBlock } from '../site-import/site-import-html'
import { siteImportLabel } from '../site-import/site-import-page'
import { aiSiteImportHonesty, aiSiteImportImprovedPlaced, type AiSiteImportImprovedBlock, type AiSiteImportImprovedSection } from './ai-site-import-honesty'
import {
  aiSiteImportLayoutOf,
  aiSiteImportLinkTo,
  aiSiteImportMapScope,
  aiSiteImportNodeBlocks,
  aiSiteImportTakePicture,
  type AiSiteImportDesigned,
} from './ai-site-import-compile'
import { aiSiteImportTextParts, type AiSiteImportDocument } from './ai-site-import-document'

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

/*------------------------------------------
 * The tool and its cached text
 *-----------------------------------------*/

/** The answer's kind of generation: the name its re-ask and its doctrine scope go by. */
export const AI_SITE_IMPORT_IMPROVE_KIND = 'page-improve'

/**
 * The most items a redesign's group keeps (AGL-4152): every item its owner's
 * page has, where the layout language's own pages stop at seven. A page
 * brought in is compiled as its source lays it out, with no such limit.
 */
export const AI_SITE_IMPORT_IMPROVE_MAX_ITEMS = 24

/** What a block may be: the layout language's words and groups, and `keep`. A customer's quote and a figure only ever arrive by `keep`. */
export const AI_SITE_IMPORT_IMPROVE_BLOCK_KINDS = ['eyebrow', 'heading', 'lede', 'text', 'note', 'list', 'button', 'image', 'cards', 'steps', 'faq', 'keep'] as const

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'text', 'to', 'icon', 'ref'],
  properties: {
    title: { type: 'string' },
    text: { type: 'string' },
    to: { type: 'string' },
    icon: { type: 'string' },
    ref: { type: 'string' },
  },
} as const

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'col', 'text', 'to', 'style', 'icon', 'items', 'ref'],
  properties: {
    kind: { type: 'string', enum: [...AI_SITE_IMPORT_IMPROVE_BLOCK_KINDS] },
    col: { type: 'integer' },
    text: { type: 'string' },
    to: { type: 'string' },
    style: { type: 'string', enum: [...AI_LAYOUT_STYLES, 'none'] },
    icon: { type: 'string' },
    items: { type: 'array', items: ITEM_SCHEMA },
    ref: { type: 'string' },
  },
} as const

/** The redesign tool: the `submit_page` language, a `keep` block, and a picture on an item by its ref. */
export const AI_SITE_IMPORT_IMPROVE_TOOL: AiTool = {
  name: 'submit_improved_page',
  description: 'Submit the redesigned page: its sections in order, in the layout language, each thing the page must keep placed with a keep block.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['sections'],
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['band', 'cols', 'align', 'blocks'],
          properties: {
            band: { type: 'string', enum: [...AI_LAYOUT_BANDS] },
            cols: { type: 'array', items: { type: 'integer' } },
            align: { type: 'string', enum: [...AI_LAYOUT_ALIGNS] },
            blocks: { type: 'array', items: BLOCK_SCHEMA },
          },
        },
      },
    },
  },
}

/** What a redesign is told, cached: every page of every site shares these bytes. */
export const AI_SITE_IMPORT_IMPROVE_TEXT = [
  "You redesign one page of a small business's existing website the way a professional web designer and copywriter would, so the new page looks far better than the old one: polished, organized and inviting, never the old page restyled. The old page is usually plain: one column, flat grounds, a text link for a call to action, its sections in the order someone typed them. Plan the page again from what a visitor needs, in the order they need it, add the sections it lacks, and write every word. The platform turns your design into the page in the site's own theme, so never describe styling beyond the words below.",
  '',
  'Answer with submit_improved_page. A page is a list of sections, top to bottom, and you decide how many and what each one is. A section has:',
  '- band: plain (the page), soft (a set-apart ground), brand (the brand color) or dark.',
  '- cols: relative column widths for a row: [1, 1] for halves, [7, 5] for a wide and a narrow column, [1, 1, 1]; at most 4. [] for one column.',
  '- align: start or center. Center only a short section: an opening, a closing call to action, a heading over a group.',
  '- blocks: what it shows, top to bottom. A block with col 0 or more goes in that column of the row; col -1 spans the section, above the row when it comes first and below it when it comes last.',
  'Every field is always written: a block that does not use one writes "" (text, to, icon, ref), "none" (style), -1 (col) or [] (items); an item that does not use one writes "".',
  '',
  'Block kinds:',
  '- eyebrow: a short label over a heading. heading: the first heading of the first section is the page title; the first heading of any other section is its heading. lede: the larger sentence under a heading. text: a paragraph. note: small print.',
  '- button: text is its label, to where it goes, style primary (filled), secondary (outlined) or quiet. Two in a row read as a pair.',
  '- cards, steps, faq: a group of items, each a title and a text. cards are services, features or reasons; steps are numbered and in order; faq items are a question and its answer. An item may carry an icon, a to, and ref naming a picture of the page, shown on the card.',
  '- list: short lines, title only.',
  '- image: text describes a picture the page should have where none of its own fits; the platform finds one, or leaves it out.',
  '- keep: ref names one thing of the ledger, drawn exactly as the owner has it, so write nothing for it: a picture, form, plan, table, quote, video, contact line, figures, logos, tabs, or a group. Place every thing the ledger marks must, exactly once, wherever it serves the page best, in a column if that helps.',
  '- A group:n of the ledger is a set of like items the old page shows (its cards, steps, questions or list). keep it to draw it whole as the owner has it, with the pictures and links it holds; or write its items again as a group of your own, every link and fact of it kept. A page too long to show whole has its groups folded: each is shown by its titles, marked must, and kept whole, and you write only what is around them.',
  'icon (on a block or an item) is one of: ' + AI_ICON_WORDS.join(', ') + '.',
  '',
  'Where a link goes (to): page:<id> for a page the ledger names, #<n> for section n of this page, form for the form on this page, phone or email for the number or address the page gives, or an https: address the ledger lists. Every link the ledger lists must go somewhere on the page, as a button or an item.',
  '',
  "A designer's page is made of sections like these; choose and order the ones this page needs:",
  '- Hero: the page title, a lede, a filled primary button and a quieter second one, beside a picture (cols [7, 5]: the words in col 0, the picture in col 1) or with the picture behind the words (one column, the picture first). Every opening places a picture: the page\'s own by keep, else an image block.',
  '- Offer as a card grid: a heading, a lede, then cards, one item for each service or thing offered, each with an icon; three or four across.',
  '- Figures or badges: figures the ledger holds, kept (keep stats:n); plain facts the page states, such as how long the business has run or that it is licensed, as cards of two to four items with icons, each saying the fact exactly as the page does.',
  '- How it works: a heading and steps of three or four items, from first asking to done.',
  '- Why choose it: cards of three with icons, each a reason the site supports.',
  '- A quote drawn as a quote: its own section on a soft or dark ground, centered: a short heading and the kept quote alone.',
  '- Pictures in a row: cols [1, 1, 1] or [1, 1], one picture kept in each column with a one-line caption under it. Pictures are never stacked one under another.',
  '- Words beside a picture: cols [1, 1] or [5, 7]: a heading, a lede, a paragraph and a button in one column and a picture in the other, the side alternating down the page.',
  '- Questions: a heading and a faq of three to six questions a visitor of this kind of business asks, each answered only with what the site says.',
  '- Contact: the kept form on a framed ground (a soft band, cols [5, 7]): beside it a heading, a welcoming line, the kept contact line and a call or email button.',
  '- Closing band: the last section, on a brand or dark ground, centered: a heading that says what the visitor gets, one line, and a filled primary button.',
  '',
  'Plan it as a designer would:',
  '- Give the page the sections its role asks for. The request names its role and how many new sections it needs: a new section is one the old page has nowhere, such as how it works, why choose it or the questions people ask, written from what the site says and what this kind of business generally does.',
  '- Draw like things as a group: three or more services, reasons or steps are cards or steps, never headings and paragraphs one under another; a set of questions is a faq; two or three pictures are a row.',
  '- Vary it: no two neighboring sections share a shape or a ground. Alternate plain and soft, and keep brand and dark to one or two sections a page, usually the closing band.',
  '- Each heading says what the visitor gets, in a few specific words; never "Welcome", "Our services" or "Ready when you are" alone.',
  '- Put the phone or email the page gives on a button (to phone, to email) where a visitor would call or write, beside the kept contact line.',
  '',
  "Writing: plain, specific and in the owner's voice, each heading a clear promise, each paragraph leading with the benefit, nothing that does not earn its place. Headings and card titles are in sentence case, so a capital reads as a name. Say what the page says, in stronger words, keeping every fact it gives; and you may say what this kind of business generally does.",
  'Never write a name, number, price, date, testimonial, client, award, credential, address or guarantee the page or the site does not give. A fact you do not have is left out, never a gap or a placeholder. Say a figure, a price, a phone or a name exactly as the page does.',
].join('\n')

/** The site's own digest, which every page of one import reads ahead of its ledger: cached once per site. */
export function aiSiteImportImproveDigest(input: {
  siteName: string | null
  /** What the home page says of the site, and the pages of the import. */
  scope: readonly string[]
  plan?: AiSiteImportPlan | null
}): string {
  return [
    fenceUntrustedText("What the owner's site says of itself", [clean(input.siteName), ...input.scope].filter(Boolean).join('\n'), { maxChars: AI_SITE_IMPORT_IMPROVE_DIGEST_CHARS }),
    ...(input.plan ? [fenceUntrustedText('The plan every page of this site is drawn to', JSON.stringify(input.plan), { maxChars: 4_000 })] : []),
  ].join('\n')
}

/** The most of a site's own words the digest holds. */
export const AI_SITE_IMPORT_IMPROVE_DIGEST_CHARS = 16_000

/** A redesign's system blocks: the platform's text cached across sites, then this site's digest, cached once per site. The ledger rides the user turn. */
export function aiSiteImportImproveInstructions(digest: string): readonly AiSystemBlock[] {
  return [
    { text: AI_SITE_IMPORT_IMPROVE_TEXT, cacheBreakpoint: true },
    { text: UNTRUSTED_TEXT_RULE },
    { text: digest, cacheBreakpoint: true, site: true },
  ]
}

/*------------------------------------------
 * The ledger as the answer reads it
 *-----------------------------------------*/

/** The most characters a page's ledger shows. */
export const AI_SITE_IMPORT_LEDGER_MAX_CHARS = 16_000

const textOf = (block: SiteImportBlock | undefined): string => (block && block.kind !== 'image' ? clean(block.text) : '')

const short = (text: string, most = 80) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

/** A ledger item, in a few words: what it is and what it shows. */
function shownItem(item: SiteImportLedgerItem, doc: Pick<AiSiteImportDocument, 'blocks' | 'photos'>): string {
  const must = item.must ? ' must' : ''
  const words = item.lines.map((ref) => textOf(doc.blocks[ref])).filter(Boolean)
  switch (item.kind) {
    case 'picture': {
      const block = doc.blocks[item.lines[0] as number]
      const url = block?.kind === 'image' ? block.url : ''
      const photo = doc.photos.find((entry) => entry.from === url)
      const alt = block?.kind === 'image' ? clean(block.alt) : ''
      return `${item.ref}${must} (${photo?.width && photo.height ? `${photo.width}×${photo.height}, ` : ''}"${short(alt, 60)}")`
    }
    case 'form':
      return `${item.ref}${must} (a form)`
    case 'video':
      return `${item.ref}${must} (a film)`
    case 'plan':
      return `${item.ref}${must} (${item.node?.kind === 'group' ? item.node.items.length : 0} plans: ${short(words.slice(0, 6).join(', '), 120)})`
    case 'table':
      return `${item.ref}${must} (${item.node?.kind === 'table' ? item.node.rows.length : 0} rows: ${short(words.slice(0, 6).join(', '), 120)})`
    case 'stats':
      return `${item.ref}${must} (figures: ${short(words.join(', '), 120)})`
    case 'logos':
      return `${item.ref}${must} (a strip of logos)`
    case 'tabs':
      return `${item.ref}${must} (tabs: ${short(words.slice(0, 4).join(', '), 120)})`
    case 'group': {
      const node = item.node?.kind === 'group' ? item.node : null
      // Each item by its first line that says something in words: a step's number is no title.
      const titles = (node?.items ?? []).map((entry) => textOf(doc.blocks[entry.lines.find((ref) => /\p{L}/u.test(textOf(doc.blocks[ref]))) as number])).filter(Boolean)
      const linked = (node?.items ?? []).filter((entry) => entry.to || entry.lines.some((ref) => doc.blocks[ref]?.kind === 'link')).length
      const kind = node?.group === 'text' || !node ? 'like items' : node.group
      const shown = titles.slice(0, item.folded ? 16 : 6).map((title) => `"${short(title, 40)}"`).join(', ')
      return `${item.ref}${must} (${node?.items.length ?? 0} ${kind}${linked ? `, ${linked} linked` : ''}: ${shown}${titles.length > (item.folded ? 16 : 6) ? ', …' : ''}${item.holds?.length ? `; holds ${item.holds.join(', ')}` : ''})`
    }
    default:
      return `${item.ref}${must} (${short(words.join(' '), 160)})`
  }
}

/**
 * A page's ledger as its answer reads it (AGL-4152): what it may place, where
 * each link goes, and every line it rewrites, numbered. Uncached, per page, and
 * fenced by the prompt: every word of it is the owner's.
 */
export function aiSiteImportLedgerText(ledger: SiteImportLedger, doc: Pick<AiSiteImportDocument, 'blocks' | 'photos'>, destinations: ReadonlyMap<string, string>): string {
  // A link a folded group holds goes where it went by its keep: it is not listed again.
  const folded = new Set(ledger.items.flatMap((item) => (item.folded ? item.lines : [])))
  const links = ledger.links.flatMap((link) => {
    const to = destinations.get(link.ref)
    return to && !folded.has(link.line) ? [`${link.ref} → ${to} ("${short(link.text, 60)}")`] : []
  })
  // A long page shows each group by its titles alone, kept whole: what is around them is written (AGL-4152).
  const lines = ledger.folded ? ledger.lines.filter((line) => !line.group) : ledger.lines
  return [
    ...(ledger.folded ? ['This page is long: its groups are folded, each shown by its titles and kept whole with keep.'] : []),
    'Things to place with keep, each once; "must" may not be left out:',
    ...(ledger.items.length ? ledger.items.map((item) => shownItem(item, doc)) : ['(none)']),
    '',
    'Links that must go somewhere on the page:',
    ...(links.length ? links : ['(none)']),
    '',
    'The lines of the old page, by section, which you rewrite as the page needs:',
    ...lines.map((line) => `[${line.line}] section ${line.section + 1}, ${line.kind}${line.group && !ledger.folded ? ` in ${line.group}` : ''}: ${line.text}`),
  ].join('\n')
}

/** Everywhere a link may go on this page, as an answer writes it, each with the destination it means. */
export function aiSiteImportImproveDestinations(doc: AiSiteImportDocument, ledger: SiteImportLedger, input: { sections?: number; formSection?: number | null } = {}): Map<string, string> {
  const scope = { doc, pathTo: new Map(doc.links.map((link) => [link.path.replace(/\/+$/, '') || '/', link.id])) }
  const out = new Map<string, string>()
  for (const link of ledger.links) {
    const to = aiSiteImportLinkTo(scope, link.href)
    if (to) {
      out.set(link.ref, to)
      out.set(to, to)
    }
  }
  for (const page of doc.links) out.set(`page:${page.id}`, `page:${page.id}`)
  // A new page has no contact line of its own: it may send a visitor to what the site gives (AGL-4152).
  const text = [...doc.blocks.map((block) => (block.kind === 'image' ? '' : block.text)), ...(doc.proposed ? (doc.siteLines ?? []) : [])].join(' \n ')
  const phone = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/.exec(text)?.[0]
  if (phone && phone.replace(/\D/g, '').length >= 7) out.set('phone', `tel:${phone.replace(/[^\d+]/g, '')}`)
  const email = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u.exec(text)?.[0]
  if (email) out.set('email', `mailto:${email}`)
  for (const [key, to] of [...out]) if (key === 'phone' || key === 'email') out.set(to, to)
  if (input.formSection !== null && input.formSection !== undefined) out.set('form', `#${input.formSection + 1}`)
  for (let n = 1; n <= (input.sections ?? 0); n += 1) out.set(`#${n}`, `#${n}`)
  return out
}

/** A redesign's user turn: the page, its kind of site, how its opening is drawn, and its ledger, fenced as the owner's data. */
export function aiSiteImportImprovePrompt(input: {
  screen: { title: string; slug: string }
  doc: Pick<AiSiteImportDocument, 'url' | 'blocks' | 'photos' | 'proposed'>
  ledger: SiteImportLedger
  destinations: ReadonlyMap<string, string>
  kindLines: readonly string[]
  seed: string
  /** What the page is for and what it needs (`aiSiteImportImproveRoleLines`). */
  roleLines?: readonly string[]
}): string {
  return [
    `Page: "${input.screen.title}" at ${input.screen.slug}`,
    // A page the site's plan proposed: there is no old page to keep, so it is written whole from what the site says.
    ...(input.doc.proposed ? ['This page is new: the site has no such page yet. Its one line says what it tells a visitor. Write it from what the site says of itself and what this kind of business generally does, inventing no fact.'] : []),
    ...(input.roleLines ?? []),
    ...input.kindLines,
    "The page's ledger, what it holds and where it links:",
    fenceUntrustedText(`The owner's page ${input.doc.url}`, aiSiteImportLedgerText(input.ledger, input.doc, input.destinations), { maxChars: AI_SITE_IMPORT_LEDGER_MAX_CHARS }),
    `Design seed: ${input.seed}.`,
  ].join('\n')
}

/*------------------------------------------
 * What the page is for, and what it needs
 *-----------------------------------------*/

/**
 * How many new sections a page of each role is asked for (AGL-4152): a home
 * or a main service page two, a contact page none, its form framed instead.
 */
export const AI_SITE_IMPORT_NEW_SECTIONS: Readonly<Record<AiSiteImportPageRole, number>> = {
  home: 2,
  service: 2,
  about: 1,
  gallery: 1,
  pricing: 1,
  other: 1,
  contact: 0,
  faq: 0,
}

/** The most sections a redesigned page runs to: a page the source already fills has no room for more. */
export const AI_SITE_IMPORT_IMPROVE_MOST_SECTIONS = 10

/** What a page is for, as its plan says, else from its address and what it holds. */
export function aiSiteImportPageRoleOf(doc: Pick<AiSiteImportDocument, 'role' | 'proposed' | 'url' | 'title' | 'blocks' | 'forms' | 'layout'>, slug: string): AiSiteImportPageRole {
  if (doc.role) return doc.role
  if (slug === '/' || slug === '') return 'home'
  const words = `${slug} ${doc.title}`.toLowerCase()
  if (/\b(?:faq|faqs|questions)\b/.test(words)) return 'faq'
  if (/\b(?:contact|visit|find-us|location|book|booking|estimate|quote)\b/.test(words)) return 'contact'
  if (/\b(?:about|story|team|people)\b/.test(words)) return 'about'
  if (/\b(?:pricing|prices|rates|plans)\b/.test(words)) return 'pricing'
  if (/\b(?:gallery|portfolio|projects|work)\b/.test(words)) return 'gallery'
  if (doc.proposed) return 'other'
  return 'service'
}

/** How many new sections a page is asked for: its role's, where the page has room, and none on a long page, whose groups fold. */
export function aiSiteImportNewSectionsWanted(role: AiSiteImportPageRole, ledger: Pick<SiteImportLedger, 'folded' | 'lines' | 'items'>, proposed = false): number {
  if (proposed || ledger.folded) return 0
  const sections = new Set([...ledger.lines.map((line) => line.section), ...ledger.items.map((item) => item.section)]).size
  return Math.max(0, Math.min(AI_SITE_IMPORT_NEW_SECTIONS[role], AI_SITE_IMPORT_IMPROVE_MOST_SECTIONS - 1 - sections))
}

/** What each role's page tells, in the order a designer would tell it. */
const ROLE_PLAN: Readonly<Record<AiSiteImportPageRole, string>> = {
  home: 'the front door of the site: the hero, what the business offers, why choose it, how it works, the questions people ask, and the closing band',
  service: 'what the service is: the hero, what is included as cards, how it works as steps, why choose it, the questions people ask about it, and the closing band',
  about: 'the story and the people: the hero, the story beside a picture, what the business values or why choose it as cards, a kept quote where the ledger has one, and the closing band',
  contact: 'how to reach the business: a short, welcoming opening, the form on a framed ground beside how to reach it, what happens after a visitor writes where the site says so, and no closing band',
  gallery: 'the work in pictures: the hero, the pictures in rows with short captions, what the work is, and the closing band',
  pricing: 'the prices, exactly as kept: the hero, the plans or table kept whole, what is included, the questions people ask about paying, and the closing band',
  faq: 'the questions: a short opening, the questions as a faq, and the closing band',
  other: 'what the page is for: the hero, its content drawn as groups and pictures, and the closing band',
}

/** The lines a redesign's request says of its page's role and what it needs (AGL-4152). */
export function aiSiteImportImproveRoleLines(input: { role: AiSiteImportPageRole; wanted: number; folded: boolean; kind?: string | null; seed: number }): string[] {
  const { role, wanted } = input
  // A home tells its story as a site start's does (`ai-site-home-arcs.ts`), one of its kind's arcs by the job's seed.
  const arc = role === 'home' ? aiSiteHomeArc({ kind: input.kind ?? null, seed: input.seed }) : null
  return [
    `This page's role: ${role}, ${ROLE_PLAN[role]}.`,
    ...(arc ? [`This home tells its story in this order, after the hero: ${arc.sections.map((section) => section.words).join('; ')}. Where it says the brief, read what the site says. Fold the old page's sections into these, and keep the order.`] : []),
    wanted ? `It needs at least ${wanted} new ${wanted === 1 ? 'section' : 'sections'}: ${wanted === 1 ? 'one' : 'sections'} the old page has nowhere, for this role.` : input.folded ? 'It is long: plan its order and its grounds, keep its groups whole, and add nothing it does not need.' : 'It needs no new section; organize and draw what it has.',
  ]
}

/**
 * The sections a redesign added (AGL-4152), by index: neither the opening nor
 * a closing band, holding nothing kept but a picture, saying something of
 * its own, and the rework of no section of the old page. Each section of the
 * old page past its opening is reworked by the one section that says most
 * of it; another section drawing on its words, such as a why-us of the
 * opening's facts, is new.
 */
export function aiSiteImportImproveNewSections(answer: readonly AiSiteImportImprovedSection[], ledger: Pick<SiteImportLedger, 'lines' | 'items'>): number[] {
  const kinds = new Map(ledger.items.map((item) => [item.ref, item.kind]))
  const sources = new Map<number, string[]>()
  for (const line of ledger.lines) sources.set(line.section, [...(sources.get(line.section) ?? []), line.text])
  const said = answer.map((section) =>
    section.blocks
      .flatMap((block) => (block.kind === 'keep' ? [] : [block.kind === 'image' ? '' : (block.text ?? ''), ...(block.items ?? []).flatMap((item) => [item.title, item.text])]))
      .join(' '),
  )
  const reworked = new Set<number>()
  // The old page's opening is the new page's: a section drawing on its facts, such as a why-us, is new.
  for (const [at, lines] of sources) {
    if (at === 0) continue
    const text = lines.join(' ')
    let best = -1
    let most = 0.5
    said.forEach((words, index) => {
      const kept = siteImportContentKept(text, words)
      if (kept >= most) {
        most = kept
        best = index
      }
    })
    if (best >= 0) reworked.add(best)
  }
  const last = answer.length - 1
  return answer.flatMap((section, index) => {
    if (index === 0 || reworked.has(index)) return []
    if (section.blocks.some((block) => block.kind === 'keep' && kinds.get(block.ref) !== 'picture')) return []
    const groups = section.blocks.filter((block) => block.kind !== 'keep' && (block.items?.length ?? 0) >= 2)
    const words = section.blocks.filter((block) => block.kind === 'text' || block.kind === 'lede')
    // A closing band: a heading, a line at most and a button, last.
    if (index === last && !groups.length && words.length <= 1 && section.blocks.some((block) => block.kind === 'button')) return []
    return groups.length || words.length ? [index] : []
  })
}

/** A section's shape, as a designer tells sections apart: what the variety of a page is counted in. */
function shapeOf(section: AiSiteImportImprovedSection, kinds: ReadonlyMap<string, string>): string {
  const kept = section.blocks.flatMap((block) => (block.kind === 'keep' ? [kinds.get(block.ref) ?? ''] : []))
  const pictures = kept.filter((kind) => kind === 'picture').length + section.blocks.filter((block) => block.kind === 'image').length
  const group = section.blocks.find((block) => block.kind !== 'keep' && (block.items?.length ?? 0) >= 2)
  if (kept.includes('form')) return 'form'
  if (kept.includes('quote')) return 'quote'
  if (group) return group.kind
  const whole = kept.find((kind) => kind !== 'picture' && kind !== 'contact')
  if (whole) return whole
  if (pictures >= 2) return 'pictures'
  if (pictures && section.cols) return 'split'
  return section.blocks.some((block) => block.kind === 'button') && !section.blocks.some((block) => block.kind === 'text') ? 'band' : 'words'
}

/** What a redesign is asked to be, by its role (AGL-4152). */
export interface AiSiteImportImproveNeeds {
  role: AiSiteImportPageRole
  /** New sections it needs (`aiSiteImportNewSectionsWanted`). */
  wanted: number
}

/** The fewest shapes a page of four sections or more is drawn in. */
export const AI_SITE_IMPORT_IMPROVE_LEAST_SHAPES = 3

/** Roles whose opening holds a picture. */
const PICTURED_OPENINGS: ReadonlySet<AiSiteImportPageRole> = new Set(['home', 'service', 'about', 'gallery', 'other'])

/**
 * Whether a redesign is planned as a designer's page (AGL-4152), answer by
 * answer: the new sections its role asks for, a picture in its opening, and
 * sections drawn in more than one or two shapes. Each miss is named for the
 * one re-ask.
 */
export function aiSiteImportImprovePlanMisses(answer: readonly AiSiteImportImprovedSection[], input: { ledger: Pick<SiteImportLedger, 'lines' | 'items' | 'folded'>; needs: AiSiteImportImproveNeeds }): AiDoctrineViolation[] {
  const out: AiDoctrineViolation[] = []
  const added = aiSiteImportImproveNewSections(answer, input.ledger)
  if (added.length < input.needs.wanted) {
    out.push({
      rule: null,
      code: 'improve-new-sections',
      message: `The page adds ${added.length} new ${added.length === 1 ? 'section' : 'sections'}; as a ${input.needs.role} page it needs at least ${input.needs.wanted}: sections the old page has nowhere, such as how it works as steps, why choose it as cards, or the questions people ask as a faq, written from what the site says.`,
    })
  }
  const opening = answer[0]?.blocks ?? []
  if (PICTURED_OPENINGS.has(input.needs.role) && !opening.some((block) => block.kind === 'image' || (block.kind === 'keep' && block.ref.startsWith('picture:')))) {
    out.push({ rule: null, code: 'improve-opening', message: "The opening has no picture. Place the page's own picture there with keep, or an image block, beside the words or behind them." })
  }
  const kinds = new Map(input.ledger.items.map((item) => [item.ref, item.kind as string]))
  const shapes = new Set(answer.slice(1).map((section) => shapeOf(section, kinds)))
  if (answer.length >= 4 && shapes.size < AI_SITE_IMPORT_IMPROVE_LEAST_SHAPES) {
    out.push({ rule: null, code: 'improve-shapes', message: `The sections after the opening are drawn in ${shapes.size === 1 ? 'one shape' : `${shapes.size} shapes`}. Vary them: a card grid, steps, words beside a picture, a row of pictures, a faq, a quote on its own ground, a closing band.` })
  }
  return out
}

/*------------------------------------------
 * The answer read
 *-----------------------------------------*/

/** A redesign's answer, read by position: `null` where it gave no section it can draw. */
export function aiReadImprovedPage(raw: unknown, settled: AiLayoutSettlement[] = []): AiSiteImportImprovedSection[] | null {
  const given = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>)['sections']) ? ((raw as Record<string, unknown>)['sections'] as unknown[]) : null
  if (!given) return null
  const sections: AiSiteImportImprovedSection[] = []
  given.forEach((entry, index) => {
    const section = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    if (!section) return
    const cols = Array.isArray(section['cols']) ? section['cols'].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0).slice(0, AI_LAYOUT_MAX_COLS).map((value) => Math.min(12, Math.max(1, Math.round(value)))) : []
    const blocks: AiSiteImportImprovedBlock[] = []
    ;(Array.isArray(section['blocks']) ? section['blocks'] : []).forEach((raw: unknown, position: number) => {
      const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
      if (!entry) return
      const col = typeof entry['col'] === 'number' && Number.isInteger(entry['col']) && entry['col'] >= 0 && cols.length >= 2 ? Math.min(entry['col'], cols.length - 1) : undefined
      if (entry['kind'] === 'keep') {
        const ref = clean(entry['ref'])
        if (ref) blocks.push({ kind: 'keep', ref, ...(col !== undefined ? { col } : {}) })
        return
      }
      const block = aiReadLayoutBlock(entry, `sections[${index}].blocks[${position}]`, settled, { mostItems: AI_SITE_IMPORT_IMPROVE_MAX_ITEMS })
      if (!block) return
      const { col: _col, ...rest } = block
      blocks.push({ ...rest, ...(col !== undefined ? { col } : {}) })
    })
    if (!blocks.length) return
    const band = AI_LAYOUT_BANDS.find((value) => value === section['band'])
    const align = AI_LAYOUT_ALIGNS.find((value) => value === section['align'])
    sections.push({ ...(band ? { band } : {}), ...(cols.length >= 2 ? { cols } : {}), ...(align ? { align } : {}), blocks })
  })
  return sections.length ? sections : null
}

/*------------------------------------------
 * The answer in the compiler's language
 *-----------------------------------------*/

/** The site's hero as a page brought in draws it: a collage or a portrait holds what a page brought in does not. */
export function aiSiteImportImproveHero(design: AiLayoutDesign, plan?: AiSiteImportPlan | null): AiLayoutImportHero {
  const chosen = (plan?.design.hero as AiLayoutHeroVariant | undefined) ?? aiLayoutDesignChoices(design).hero
  return chosen === 'collage' || chosen === 'portrait' ? 'split' : chosen
}

/** How many of a group's items sit across: planned for how much each says. */
export function aiSiteImportImproveColumns(items: readonly AiLayoutItem[]): number {
  const count = items.length
  if (count <= 3) return count
  const longest = Math.max(...items.map((item) => item.text.length))
  if (count === 4) return longest > 110 ? 2 : 4
  return 3
}

const WORD_KINDS = new Set(['eyebrow', 'heading', 'lede', 'text', 'note', 'button'])

/** The longest quote a kept set of quotes sets side by side. */
const QUOTE_ACROSS_CHARS = 220

/** The frame a source's picture is cropped to where a redesign places it: wide across the page, closer in a column. */
const FRAME: Readonly<Record<'wide' | 'column', string>> = { wide: '16 / 9', column: '4 / 3' }

export interface AiSiteImportImproveCompileInput {
  doc: AiSiteImportDocument
  ledger: SiteImportLedger
  design: AiLayoutDesign
  destinations: ReadonlyMap<string, string>
  formId: string | null
  plan?: AiSiteImportPlan | null
  /** The theme the page is drawn in, where it is known: a brand band only where the brand itself fills. */
  theme?: SiteImportFidelityTheme | null
}

/** What a redesign compiles into, and what its row and its check say of it. */
export interface AiSiteImportImprovedPage {
  given: AiSiteImportDesigned
  names: string[]
  written: string[]
  added: AiSiteImportAddedSection[]
  pictures: AiSiteImportPagePictures
}

/** The sections' names: each heading's words, as a label, told apart. */
function sectionNames(sections: readonly AiLayoutSection[], title: string): string[] {
  const taken = new Set<string>()
  return sections.map((section, index) => {
    const heading = section.blocks.find((block) => block.kind === 'heading' && block.text)?.text
    const base = siteImportLabel(heading ?? '') || (index === 0 ? siteImportLabel(title) : '') || `Section ${index + 1}`
    let name = base
    for (let at = 2; taken.has(name.toLowerCase()); at += 1) name = `${base.slice(0, 50)} (${at})`
    taken.add(name.toLowerCase())
    return name
  })
}

/** The sections a redesign holds, in the compiler's language: every `keep` expanded to the source's own blocks, every link resolved. */
export function aiSiteImportImprovedPage(answer: readonly AiSiteImportImprovedSection[], input: AiSiteImportImproveCompileInput): AiSiteImportImprovedPage {
  const { doc, ledger, design, destinations } = input
  const scope = aiSiteImportMapScope(doc, { formId: input.formId, finish: 'improve' })
  const items = new Map(ledger.items.map((item) => [item.ref, item]))
  const choices = aiLayoutDesignChoices(design)
  const written: string[] = []
  // A brand band in a brand the theme had to deepen would read as neither: dark holds its place.
  const deepened = !!input.theme && !!input.theme.button.fill && input.theme.button.fill !== input.theme.light.brand
  const resolve = (to: string | undefined): string | undefined => {
    if (!to) return undefined
    return destinations.get(to) ?? undefined
  }
  const say = (text: string | undefined) => {
    if (text?.trim()) written.push(clean(text))
  }
  const pictureOf = (ref: string, frame: string) => {
    const item = items.get(ref)
    if (item?.kind !== 'picture') return null
    const picture = aiSiteImportTakePicture(scope, item.lines[0])
    return picture ? { ...picture, fit: { ratio: frame, cropped: true as const, objectFit: 'cover' as const, rounded: true as const } } : null
  }
  // A few short quotes kept whole sit side by side, as a designer sets them, wherever the old page stacked them; in a column, one under another.
  const across = (block: AiLayoutBlock, inColumn: boolean): Partial<AiLayoutBlock> => {
    const items = block.items ?? []
    if (block.kind !== 'quotes' || inColumn || items.length < 2 || items.length > 4 || items.some((entry) => entry.title.length > QUOTE_ACROSS_CHARS)) return {}
    return { columns: Math.min(3, items.length) }
  }
  const keepOf = (ref: string, col: number | undefined): AiLayoutBlock[] => {
    const item = items.get(ref)
    if (!item) return []
    const placed = col !== undefined ? { col } : {}
    if (item.kind === 'picture') {
      const picture = pictureOf(ref, col !== undefined ? FRAME.column : FRAME.wide)
      return picture ? [{ kind: 'image', picture, ...placed }] : []
    }
    if (!item.node) return []
    scope.answer = null
    scope.groupAt = 0
    return aiSiteImportNodeBlocks(scope, [item.node], { cols: null, allowed: false }).map((block) => ({ ...block, ...placed, ...across(block, col !== undefined) }))
  }
  const sections = answer.map((section, index): AiLayoutSection => {
    scope.at = `sections[${index}]`
    const words = section.blocks.flatMap((block) => (block.kind === 'heading' || block.kind === 'eyebrow' ? [block.text ?? ''] : [])).join(' ')
    const blocks = section.blocks.flatMap((raw): AiLayoutBlock[] => {
      if (raw.kind === 'keep') return keepOf(raw.ref, raw.col)
      const block = raw
      const placed = block.col !== undefined ? { col: block.col } : {}
      if (block.kind === 'image') {
        const { col: _col, ...rest } = block
        return [{ ...rest, ...placed }]
      }
      if (block.kind === 'text' || block.kind === 'lede' || block.kind === 'note') {
        say(block.text)
        return aiSiteImportTextParts(block.text ?? '').map((part) => ({ ...block, text: part }))
      }
      if (block.kind === 'heading' || block.kind === 'eyebrow') {
        say(block.text)
        return [block]
      }
      if (block.kind === 'button') {
        say(block.text)
        const to = resolve(block.to)
        const { to: _asked, ...rest } = block
        return [{ ...rest, ...(to ? { to } : {}) }]
      }
      const groupItems = (block.items ?? []).map((item, at): AiLayoutItem => {
        say(item.title)
        say(item.text)
        const picture = item.ref ? pictureOf(item.ref, '4 / 3') : null
        const to = resolve(item.to)
        const { ref: _ref, to: _to, ...rest } = item
        return { ...rest, ...(block.kind === 'steps' ? { figure: String(at + 1) } : {}), ...(picture ? { picture } : {}), ...(to ? { to } : {}) }
      })
      if (block.kind === 'list') return [{ ...block, items: groupItems, columns: groupItems.length >= 6 ? 2 : 1 }]
      if (block.kind === 'faq') return [{ ...block, items: groupItems, columns: 1 }]
      const pictured = groupItems.every((item) => item.picture)
      const iconed = groupItems.every((item) => item.icon)
      const wanted = aiLayoutGroupVariant(design, choices, words)
      const variant = pictured ? (choices.group === 'cards' ? 'articles' : 'pictures') : wanted === 'icons' && !iconed ? 'cards' : wanted === 'menu' || wanted === 'pictures' || wanted === 'articles' ? 'cards' : wanted
      return [{ ...block, items: groupItems, columns: aiSiteImportImproveColumns(groupItems), variant }]
    })
    const pictures = blocks.filter((block) => block.kind === 'image' || block.kind === 'video')
    const opens = index === 0 && pictures.length === 1 && blocks.every((block) => block.kind === 'image' || block.kind === 'video' || WORD_KINDS.has(block.kind))
    const hero = opens ? aiSiteImportImproveHero(design, input.plan) : null
    const band = section.band === 'brand' && deepened ? 'dark' : section.band
    return {
      ...(band ? { band } : {}),
      ...(section.align ? { align: section.align } : {}),
      // A hero draws its own columns, and frames its own picture.
      ...(section.cols && !hero ? { cols: section.cols } : {}),
      ...(hero ? { hero, blocks: blocks.map((block) => (block.kind === 'image' && block.picture ? { ...block, picture: { ...block.picture, fit: undefined } } : block)) } : { blocks }),
    }
  })
  const names = sectionNames(sections, doc.title)
  const added: AiSiteImportAddedSection[] = aiSiteImportImproveNewSections(answer, ledger).map((index) => {
    const group = sections[index]?.blocks.find((block) => block.items?.length)
    return { heading: names[index] as string, ...(group?.items?.length ? { items: group.items.length } : {}) }
  })
  const placed = new Set(aiSiteImportImprovedPlaced(answer, ledger))
  const allPictures = ledger.items.filter((item) => item.kind === 'picture')
  const unplaced = allPictures.filter((item) => !placed.has(item.ref)).flatMap((item) => {
    const block = doc.blocks[item.lines[0] as number]
    return block?.kind === 'image' ? [block.url] : []
  })
  return {
    given: { sections, used: scope.used, missing: scope.missing, settled: scope.settled },
    names,
    written,
    added,
    pictures: {
      source: allPictures.length - unplaced.length,
      stock: 0,
      generated: 0,
      slots: sections.reduce((total, section) => total + section.blocks.filter((block) => block.kind === 'image' && !block.picture).length, 0),
      unplaced,
    },
  }
}

/*------------------------------------------
 * The check
 *-----------------------------------------*/

/** The most an answer may ask for, whatever the page and the model: a whole page's design and words, with its thinking. */
export const AI_SITE_IMPORT_IMPROVE_MOST_TOKENS = 8_000

/**
 * Room a page's ceiling keeps for its listing pass (AGL-4152): its p90 is 1,
 * and it runs a model only where the source left the listing empty.
 */
export const AI_SITE_IMPORT_LISTING_ROOM_CREDITS = 10

/**
 * What a page's redesign may spend, its answer and its re-ask together
 * (AGL-4152): the page's ceiling, less its listing pass's room. Held in code
 * (`aiSiteImportImproveTokensWithin`): an answer asks no more than the
 * ceiling buys, and a re-ask it cannot pay for is not asked.
 */
export const AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS = AI_SITE_IMPORT_PAGE_CEILING_CREDITS - AI_SITE_IMPORT_LISTING_ROOM_CREDITS

/** Characters a token is counted at, before a request is sent: fewer than the text runs, so a guess is never under. */
const CHARS_PER_TOKEN = 3

const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const plus = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})

/** What a request reads before it is sent, at worst: its system blocks written to the cache, its turn as input. */
export function aiSiteImportImproveInputUsage(input: { systemChars: number; promptChars: number }): AiUsage {
  return { ...ZERO, inputTokens: Math.ceil(input.promptChars / CHARS_PER_TOKEN), cacheWriteTokens: Math.ceil(input.systemChars / CHARS_PER_TOKEN) }
}

/** What a usage is billed in credits on a model. */
export function aiSiteImportImproveCredits(usage: AiUsage, model: string): number {
  return assistCreditsFromUsd(estimateAiBilledUsd(usage, model))
}

/**
 * The most output tokens a request may write (AGL-4152) with `spent` already
 * spent and `input` still to read, and stay inside `ceiling` credits; at
 * most `most`, and 0 where its reading alone would pass the ceiling.
 */
export function aiSiteImportImproveTokensWithin(input: { model: string; spent: AiUsage; input: AiUsage; ceiling?: number; most: number }): number {
  const ceiling = input.ceiling ?? AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS
  const before = plus(input.spent, input.input)
  const fits = (tokens: number) => aiSiteImportImproveCredits({ ...before, outputTokens: before.outputTokens + tokens }, input.model) <= ceiling
  if (!fits(0)) return 0
  let low = 0
  let high = Math.max(0, Math.floor(input.most))
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits(mid)) low = mid
    else high = mid - 1
  }
  return low
}

/** The least share of the last answer's length a re-ask must have room for: less, and it would be cut off. */
export const AI_SITE_IMPORT_REASK_ROOM = 0.9

/** What a re-ask reads beyond its first request: the re-ask's own words naming what missed. */
const REASK_TOKENS = 600

/**
 * Whether a redesign's re-ask fits its page's ceiling (AGL-4152): the most
 * tokens it may ask, given what the first answer spent, or 0 where the room
 * left is under what the first answer wrote, and the page falls back with
 * no re-ask rather than pass its ceiling.
 */
export function aiSiteImportImproveReaskTokens(input: { model: string; spent: AiUsage; lastOutput: number; most: number; ceiling?: number }): number {
  // The re-ask reads what the first request read, its system now from the cache at worst at the write's rate, and the re-ask's words.
  const again: AiUsage = { ...ZERO, inputTokens: input.spent.inputTokens + REASK_TOKENS, cacheReadTokens: input.spent.cacheReadTokens, cacheWriteTokens: input.spent.cacheWriteTokens }
  const room = aiSiteImportImproveTokensWithin({ model: input.model, spent: input.spent, input: again, most: input.most, ...(input.ceiling !== undefined ? { ceiling: input.ceiling } : {}) })
  return room >= Math.ceil(input.lastOutput * AI_SITE_IMPORT_REASK_ROOM) ? room : 0
}

/** What a redesign settled: the page built, what it added and what it shows. */
export interface AiSiteImportImproved<T> {
  built: T
  page: AiSiteImportImprovedPage
}

/** Every line a redesign's facts may come from: its page, what the site says of itself, its wave's other pages, its name. */
export function aiSiteImportImproveScope(doc: Pick<AiSiteImportDocument, 'blocks' | 'siteLines' | 'scope' | 'title'>, siteName: string | null): string[] {
  const own = doc.blocks.flatMap((block) => (block.kind === 'image' ? (block.alt ? [block.alt] : []) : block.text ? [block.text] : []))
  return [...own, ...(doc.siteLines ?? []), ...(doc.scope ?? []), doc.title, ...(siteName ? [siteName] : [])].map(clean).filter(Boolean)
}

/** What each line that missed says to the one re-ask. */
const MISS: Readonly<Record<string, string>> = {
  facts: 'The page leaves out a fact the owner gives. Say every name, number, price, date, phone and address the ledger shows.',
  invented: 'The page says something nothing on the site supports.',
  held: 'Something the ledger marks must is not on the page. Place it with a keep block.',
  links: 'A link the ledger lists goes nowhere on the page. Link to it from a button or an item.',
  meaning: "The page has drifted from what the owner says. Keep more of the old page's substance in the new words.",
  cta: 'The opening needs a filled primary button with a real destination, and the last section a button or the form: close on a call to action.',
  rhythm: 'Neighboring sections sit on one ground. Alternate plain and soft, or set one on a strong band.',
  columns: 'Sections stack like things in one column, or the page draws no group at all. Set a picture beside its words, and three or more like items as cards, steps or a faq.',
  framing: 'A picture is drawn taller than a screen holds. Set it in a column, or on a card.',
  contrast: 'A section is drawn on a ground its words do not read on. Choose another band.',
  phone: 'A section does not hold on a phone. Use the language’s rows and groups, which stack.',
}

/** A scored redesign's misses, each as the re-ask names it: what is red on its ledger and its design lines. */
export function aiSiteImportImprovedMisses(report: Pick<SiteImportPageFidelity, 'improved'>): AiDoctrineViolation[] {
  const improved = report.improved
  if (!improved) return []
  return improved.red.flatMap((name) => {
    if (name === 'frame') return []
    const ledger = improved.ledger as unknown as Record<string, { missing?: string[]; found?: string[] } | undefined>
    const shown = [...(ledger[name]?.missing ?? []), ...(ledger[name]?.found ?? [])].map((token) => token.replace(/^[a-z]+:/, ''))
    const message = MISS[name] ?? `The page falls short on ${name}.`
    return [{ rule: null, code: `improve-${name}`, message, ...(shown.length ? { detail: `Named: ${shown.join(', ')}.` } : {}) }]
  })
}

/** A redesign's read for a page: its ledger, and everywhere a link may go. */
export function aiSiteImportImproveLedger(doc: AiSiteImportDocument): SiteImportLedger {
  return siteImportLedger({ layout: aiSiteImportLayoutOf(doc), blocks: doc.blocks })
}

/**
 * A redesign's check (AGL-4152), answer by answer: its words and refs held to
 * what the import read, its page compiled and held to the doctrine as a page
 * written (`build`), and scored (`score`). Any miss is named for the one
 * re-ask; a second miss is the caller's fallback.
 */
export function aiSiteImportImproveCheck<T>(input: {
  doc: AiSiteImportDocument
  ledger: SiteImportLedger
  design: AiLayoutDesign
  scope: readonly string[]
  formId: string | null
  framing?: AiCopyFraming | null
  plan?: AiSiteImportPlan | null
  theme?: SiteImportFidelityTheme | null
  /** What the page is for and the new sections it needs; absent, nothing is asked of its plan. */
  needs?: AiSiteImportImproveNeeds | null
  build: (page: AiSiteImportImprovedPage) => { value: T | null; violations: AiDoctrineViolation[] }
  score: (built: T, destinations: readonly string[]) => AiDoctrineViolation[]
}): AiGenerationCheck<AiSiteImportImproved<T>> {
  return (answer) => {
    const read = aiReadImprovedPage(answer)
    if (!read) return { value: null, violations: [{ rule: null, code: 'improve-unreadable', message: `The answer gave no section that can be drawn. Answer with ${AI_SITE_IMPORT_IMPROVE_TOOL.name}.` }] }
    const formAt = read.findIndex((section) => section.blocks.some((block) => block.kind === 'keep' && block.ref.startsWith('form:')))
    const destinations = aiSiteImportImproveDestinations(input.doc, input.ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt })
    const honesty = aiSiteImportHonesty(read, { ledger: input.ledger, scope: input.scope, destinations, framing: input.framing ?? null })
    // What it lost and how it is planned, named together, so the one re-ask mends both.
    const planned = input.needs ? aiSiteImportImprovePlanMisses(read, { ledger: input.ledger, needs: input.needs }) : []
    if (honesty.length || planned.length) return { value: null, violations: [...honesty, ...planned] }
    const page = aiSiteImportImprovedPage(read, { doc: input.doc, ledger: input.ledger, design: input.design, destinations, formId: input.formId, plan: input.plan ?? null, theme: input.theme ?? null })
    const built = input.build(page)
    if (!built.value) return { value: null, violations: built.violations }
    const wanted = input.ledger.links.flatMap((link) => {
      const to = destinations.get(link.ref)
      return to ? [to] : []
    })
    const missed = input.score(built.value, [...new Set(wanted)])
    if (missed.length) return { value: null, violations: missed }
    return { value: { built: built.value, page }, violations: [] }
  }
}
