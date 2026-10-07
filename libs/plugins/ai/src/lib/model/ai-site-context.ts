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
  BUSINESS_TONE_LABELS,
  type ResolvedBusinessProfile,
} from '@aglyn/aglyn/app-utils/business-profile'
import type { AiSystemBlock } from '../providers/contract'
import type { AiHostPublishContext } from './ai-host-publish-context'
import type { AiSiteInventory } from './ai-site-inventory'

/**
 * What every AI job knows about the site it works on (AGL-3661), as ONE
 * compact block: the business profile, what the site already has and whether
 * it is live, and what the owner's edits taught it.
 *
 * ── Why it exists ─────────────────────────────────────────────────────────
 *
 * Before it, a job saw its brief, the guided start's answers and the site's
 * name. It named a Free site "Austin Paws Grooming" that was called nothing
 * of the kind, and nothing stopped it inventing a phone number. The block
 * gives it the facts the owner entered and a standing rule for the ones they
 * did not: never invent a name, a contact detail, a price or a review.
 *
 * ── Where it sits, and what that costs ────────────────────────────────────
 *
 * {@link aiSiteContextSystemBlock} marks it a `cacheBreakpoint`, placed AFTER
 * every platform-wide cached block and before the volatile ones. The
 * platform's prefix is still shared by every workspace; this block extends it
 * with one cache entry per site, which every request of a job — each re-ask,
 * each section of a page — reads at the cache rate. It changes only when the
 * owner edits the profile, a page is published, or an edit is remembered.
 *
 * ── Held to a ceiling ─────────────────────────────────────────────────────
 *
 * {@link AI_SITE_CONTEXT_MAX_CHARS}: 400 tokens at the runtime's four
 * characters a token. Lines are dropped from the least useful up — the site
 * index, the profiles, then the preferences — and the closing rule is never
 * dropped, because it is the line that stops an invented phone number.
 */

/** The block's ceiling: 400 tokens at four characters a token. */
export const AI_SITE_CONTEXT_MAX_CHARS = 1_600

/** Pages, forms, components and layouts listed by name in the site index, each. */
export const AI_SITE_CONTEXT_INDEX_PER_KIND = 8

/** The rule every block closes with, whatever else it says. */
export const AI_SITE_CONTEXT_RULE =
  'Never invent a business name, a person’s name, an email address, a phone number, a street address, opening hours, prices, reviews or testimonials. Use only the facts above; where a page needs one that is missing, write around it or leave a bracketed placeholder such as [phone number] for the owner to fill.'

export interface AiSiteContextInput {
  /** The resolved business profile; `null` when the site has none to read. */
  profile: ResolvedBusinessProfile | null
  /**
   * The site's inventory, for a caller that does NOT already send it. A job
   * whose prompt carries the inventory block (the plan step and the writers
   * built on the doctrine) leaves this out: the block would only repeat it.
   */
  inventory?: AiSiteInventory | null
  /** Whether the site is live and where. */
  publish?: AiHostPublishContext | null
  /** What the owner's edits taught, strongest first. */
  preferences?: readonly string[]
  /**
   * Whether the block may carry contact details. An answer that must name
   * nobody and print no address (the insight rules) leaves them out.
   */
  contact?: boolean
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** One labelled line, or nothing for an empty value. */
const line = (label: string, value: string | null | undefined, max = 240): string | null =>
  value && value.trim() ? `${label}: ${clip(value.trim(), max)}` : null

const pathOf = (slug: string) => `/${slug.trim().replace(/^\/+|\/+$/g, '')}`

/**
 * The site's index (AGL-3661): what it already has, by name and id, so a job
 * reuses before it builds. Pages say whether they are live; a form says how
 * many fields it asks for. Pure, so a caller holding an inventory pays one
 * render and no read.
 */
export function aiSiteInventoryIndex(
  inventory: AiSiteInventory | null | undefined,
  publish?: AiHostPublishContext | null,
): string[] {
  if (!inventory) return []
  const live = new Set((publish?.publishedPages ?? []).map((path) => pathOf(path)))
  const cap = AI_SITE_CONTEXT_INDEX_PER_KIND
  const more = (total: number) => (total > cap ? `, and ${total - cap} more` : '')
  const lines: string[] = []
  const pages = inventory.screens.filter((screen) => !screen.template)
  if (pages.length) {
    const rows = pages.slice(0, cap).map((page) => {
      const path = pathOf(page.slug)
      return `${page.name} ${path} (${live.has(path) ? 'live' : 'draft'})`
    })
    lines.push(`Pages: ${rows.join('; ')}${more(pages.length)}`)
  }
  if (inventory.forms.length) {
    const rows = inventory.forms.slice(0, cap).map((form) => `${form.name} [${form.id}, ${form.fields.length} fields]`)
    lines.push(`Forms: ${rows.join('; ')}${more(inventory.forms.length)}`)
  }
  if (inventory.components.length) {
    const rows = inventory.components.slice(0, cap).map((component) => `${component.name} [${component.id}]`)
    lines.push(`Components: ${rows.join('; ')}${more(inventory.components.length)}`)
  }
  if (inventory.layouts.length) {
    const rows = inventory.layouts.slice(0, cap).map((layout) => `${layout.name} [${layout.id}]`)
    lines.push(`Layouts: ${rows.join('; ')}${more(inventory.layouts.length)}`)
  }
  return lines
}

/** The block's lines in priority order; each group is dropped whole when it does not fit. */
function contextGroups(input: AiSiteContextInput): string[][] {
  const { profile, publish, preferences } = input
  const business: string[] = []
  if (profile) {
    const toneLabel = profile.tone ? BUSINESS_TONE_LABELS[profile.tone.value] : null
    const toneNotes = profile.toneNotes?.value ?? ''
    business.push(
      ...[
        line('Business name', profile.name?.value, 120),
        line('What it does', profile.whatYouDo?.value),
        line('Business type', profile.businessType, 80),
        line('Services', profile.services?.value.join('; ')),
        line('Area served', profile.serviceArea?.value, 160),
        line('Audience', profile.audience?.value, 160),
        line('Tone of voice', [toneLabel, toneNotes].filter(Boolean).join(' — ') || null),
      ].filter((entry): entry is string => Boolean(entry)),
    )
  }
  const contact: string[] = []
  if (profile && input.contact !== false) {
    const parts = [
      profile.contact.email ? `email ${profile.contact.email}` : null,
      profile.contact.phone ? `phone ${profile.contact.phone}` : null,
      profile.contact.address ? `address ${profile.contact.address}` : null,
      profile.contact.hours ? `hours ${profile.contact.hours}` : null,
    ].filter(Boolean)
    contact.push(
      parts.length
        ? `Contact details the owner entered (use exactly as written): ${clip(parts.join('; '), 400)}`
        : 'Contact details: none entered yet.',
    )
  }
  const status: string[] = []
  if (publish) {
    status.push(
      publish.published
        ? `Site: live at ${publish.liveUrl ?? 'its address'}; live pages ${clip(publish.publishedPages.join(', '), 200)}`
        : `Site: not published yet${publish.liveUrl ? `; it will be at ${publish.liveUrl}` : ''}`,
    )
  }
  const remembered = preferences?.length
    ? [`What the owner's past edits showed: ${clip(preferences.join('; '), 360)}.`]
    : []
  const profiles =
    profile && input.contact !== false && profile.profiles.length
      ? [`Social profiles: ${clip(profile.profiles.join(', '), 300)}`]
      : []
  const index = aiSiteInventoryIndex(input.inventory, publish)
  // Priority order: what the business is, how to reach it, whether it is
  // live, what the owner taught, its profiles, then what the site holds.
  return [business, contact, status, remembered, profiles, index]
}

/**
 * The block as text (AGL-3661), never over {@link AI_SITE_CONTEXT_MAX_CHARS}.
 * `''` when there is nothing to say, so a caller sends no block at all.
 */
export function aiSiteContextBlock(input: AiSiteContextInput): string {
  const groups = contextGroups(input).filter((group) => group.length)
  if (!groups.length) return ''
  const head = 'About this site, from its owner’s settings. Write for this business and do not contradict these facts:'
  const render = (kept: string[][]) => [head, ...kept.flat(), AI_SITE_CONTEXT_RULE].join('\n')
  const kept = [...groups]
  let text = render(kept)
  while (text.length > AI_SITE_CONTEXT_MAX_CHARS && kept.length > 1) {
    kept.pop()
    text = render(kept)
  }
  if (text.length <= AI_SITE_CONTEXT_MAX_CHARS) return text
  // One group still too long (a very long profile): its lines are cut, the
  // closing rule is kept whole.
  const room = AI_SITE_CONTEXT_MAX_CHARS - head.length - AI_SITE_CONTEXT_RULE.length - 2
  return [head, clip(kept.flat().join('\n'), Math.max(0, room)), AI_SITE_CONTEXT_RULE].join('\n')
}

/**
 * The block as the system block a door appends after its own cached blocks
 * (AGL-3661): a `cacheBreakpoint` of its own, so the platform's prefix ahead
 * of it is still shared and this one is cached per site. `[]` when there is
 * nothing to say.
 *
 * A door already carrying the runtime's limit of breakpoints passes
 * `cache: false`, and the block rides as a volatile block after them instead.
 */
export function aiSiteContextSystemBlock(
  input: AiSiteContextInput | null | undefined,
  options: { cache?: boolean } = {},
): AiSystemBlock[] {
  const text = input ? aiSiteContextBlock(input) : ''
  if (!text) return []
  return [options.cache === false ? { text, volatile: true } : { text, cacheBreakpoint: true }]
}
