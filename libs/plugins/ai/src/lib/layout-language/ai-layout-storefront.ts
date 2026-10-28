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

/**
 * A STORE'S STOREFRONT (AGL-3676, second round).
 *
 * Zach, 2026-10-09, on the beta.237 Willow Wick Candles start (job
 * MtlXWjvt9P): "again this … site does not look like a store front". Its home
 * was a lifestyle hero, ONE row of featured products and four text-only bands
 * ("Why soy, why small batch", "How our candles are made", "Made to be
 * loved", "Gifting and shipping"); its Shop page opened with a tall hero and
 * the grid below the fold.
 *
 * A designer storefront (Shopify's Dawn, Craft, Sense; Squarespace's commerce
 * templates) is composed of a handful of PARTS, in a familiar order: a hero
 * that sells, the store's bestsellers, its collections as picture tiles, the
 * brand's story beside a photo, why to buy here with icons, what customers
 * say, and a newsletter sign-up. This module names those parts by the words a
 * plan gives its sections, so the plan step can make sure a store's home has
 * them and the compiler and the listings can draw each one its way.
 *
 * It is NOT a section library (Zach 10/7): the model still names, orders and
 * writes every section, and designs each in the layout language; what code
 * adds is a part the plan left out — named in plain words for the model to
 * design — and the platform elements that show the store's own records.
 *
 * Pure: names and plans only.
 */

import type { AiBuildPlanScreen, AiBuildPlanSection } from '../model/ai-build-plan'

/** A part a storefront home is composed of. */
export type AiStorefrontPart = 'featured' | 'collections' | 'story' | 'values' | 'reviews' | 'signup'

/** The section names that say each part, as a plan or a page heading words it. */
export const AI_STOREFRONT_PART_WORDS: Readonly<Record<AiStorefrontPart, RegExp>> = {
  featured:
    /\b(bestsellers?|best[- ]sellers?|best[- ]selling|featured|new arrivals?|arrivals|just in|favou?rites?|signature|most loved|top picks?|our (?:candles|products|picks)|shop (?:all|now|the))\b/i,
  collections: /\b(collections?|categor(?:y|ies)|shop by|browse by|by scent|scents?|ranges?|families|occasions?|edits?)\b/i,
  story: /\b(story|about|our craft|craft|making|made|maker|process|how (?:we|it)|behind|studio|workshop)\b/i,
  values: /\b(why|promise|promises|values?|difference|shipping|returns?|guarantee|perks?|benefits?|care|small[- ]batch|ingredients?|sustainab\w*)\b/i,
  reviews: /\b(reviews?|testimonials?|customers? (?:say|love)|what (?:people|customers|our customers) say|kind words|praise|loved by|social proof)\b/i,
  signup: /\b(newsletter|subscribe|sign[- ]?up|mailing list|join (?:us|the list|our list)|stay in touch|in the loop|first to know|inbox|letters? from)\b/i,
}

/** Whether a planned section's name says a part. */
export function aiStorefrontSays(part: AiStorefrontPart, name: string): boolean {
  return AI_STOREFRONT_PART_WORDS[part].test(name)
}

/** The plan entry a part the plan left out is added as: plain words the page step designs. */
const ADDED: Readonly<Record<'featured' | 'collections' | 'reviews' | 'signup', AiBuildPlanSection>> = {
  featured: { name: 'Bestsellers', uses: [], items: 4 },
  collections: { name: 'Shop by collection', uses: [], items: 3 },
  reviews: { name: 'Customer reviews', uses: [], items: 0 },
  signup: { name: 'Newsletter sign-up', uses: [], items: 0 },
}

/** The most sections one page of a site start holds (`AI_SITE_MAX_SECTIONS`). */
const MOST_SECTIONS = 8

const firstSegment = (slug: string) => slug.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()

/** A section that closes a page: its call to action, a contact or a sign-up band. */
const CLOSING = /\b(cta|call to action|closing|close|contact|get in touch|visit)\b/i

/**
 * A store plan's screens with the storefront a shopper expects (AGL-3676):
 *
 *  - THE HOME (paid starts only — the Free wall prices each section, and a
 *    Free store sells nothing yet): its hero first, then any part the plan
 *    left out, added under plain names while the page has room (eight
 *    sections), in order of need: the bestsellers the platform lists,
 *    right after the hero; the collections as picture tiles after them; the
 *    newsletter sign-up as the page's last band; and customer reviews (the
 *    store's real ones, which show only once shoppers leave them) before
 *    the close.
 *  - THE SHOP PAGE: grid first. Its product grid section moves to second,
 *    straight under the page's short title, so the products open above the
 *    fold; anything the plan put between them (an intro, a story) follows
 *    the grid.
 *
 * Every section the plan named stays, in its order otherwise; nothing is
 * removed, and a page at eight sections is given nothing more.
 */
export function aiStorefrontPlanScreens<S extends Pick<AiBuildPlanScreen, 'slug' | 'title' | 'sections'>>(
  screens: readonly S[],
  options: { paid: boolean; isShopPage: (screen: S) => boolean; gridSection: (sections: S['sections']) => number },
): S[] {
  return screens.map((screen) => {
    if (firstSegment(screen.slug) === '') return options.paid ? storefrontHome(screen) : screen
    if (!options.isShopPage(screen) || screen.sections.length < 3) return screen
    const grid = options.gridSection(screen.sections)
    if (grid <= 1) return screen
    const sections = [...screen.sections]
    const [moved] = sections.splice(grid, 1)
    sections.splice(1, 0, moved)
    return { ...screen, sections }
  })
}

function storefrontHome<S extends Pick<AiBuildPlanScreen, 'sections'>>(screen: S): S {
  const sections = [...screen.sections]
  if (!sections.length) return screen
  // A section about the collections that also names the bestsellers is the bestsellers'.
  const says = (part: AiStorefrontPart, name: string) =>
    aiStorefrontSays(part, name) && (part !== 'collections' || !aiStorefrontSays('featured', name))
  const has = (part: AiStorefrontPart) => sections.some((section, index) => index > 0 && says(part, section.name))
  const room = () => sections.length < MOST_SECTIONS
  // What a shopper meets first matters most, so the parts are added in that
  // order while the page has room: the bestsellers, the collections, the
  // sign-up, then the reviews — which show nothing until a shopper writes one.
  if (!has('featured') && room()) sections.splice(1, 0, { ...ADDED.featured })
  if (!has('collections') && room()) {
    // The collections follow the bestsellers.
    const featured = sections.findIndex((section, index) => index > 0 && says('featured', section.name))
    sections.splice(featured > 0 ? featured + 1 : 1, 0, { ...ADDED.collections })
  }
  // The newsletter is the page's last band, under any closing call to action.
  if (!has('signup') && room()) sections.push({ ...ADDED.signup })
  if (!has('reviews') && room()) {
    // The reviews come just before the page closes: above a closing sign-up
    // and above a closing call to action.
    let at = sections.length
    if (at - 1 > 0 && says('signup', sections[at - 1].name)) at -= 1
    if (at - 1 > 0 && CLOSING.test(sections[at - 1].name)) at -= 1
    sections.splice(at, 0, { ...ADDED.reviews })
  }
  return sections.length === screen.sections.length ? screen : { ...screen, sections }
}

// ── Icons for a row's items: a store's reasons to buy, any site's reasons, its places ──

/**
 * Words that suggest an icon from the platform's icon library, first match
 * wins: a store's reasons (AGL-3676), then a service business's (AGL-4065) —
 * its languages, its water and its tools, its time and its prices, its
 * riders and its sponsors.
 */
const ICON_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(ship|shipping|shipped|deliver\w*|dispatch\w*|post(?:age|ed)?|courier)\b/i, 'truck'],
  [/\b(returns?|refunds?|exchanges?)\b/i, 'recycle'],
  [/\b(gifts?|gifting|wrapped|wrapping|boxed)\b/i, 'gift'],
  [/\b(languages?|bilingual|spanish|español|english and|translat\w*)\b/i, 'translate'],
  [/\b(water|watering|irrigation|sprinklers?|drip)\b/i, 'water'],
  [/\b(on[- ]time|punctual|hours|time)\b/i, 'clock'],
  [/\b(schedules?|scheduling|calendar|dates?|seasons?|seasonal)\b/i, 'calendar'],
  [/\b(prices?|pricing|estimates?|quotes?|costs?|upfront|fees?)\b/i, 'receipt'],
  [/\b(repairs?|fix\w*|tools?|wrench\w*|trades?|drywall|carpentry|mechanics?)\b/i, 'tools'],
  [/\b(natural|soy|organic|plant|vegan|botanical|clean|non-toxic|eco|sustainab\w*|cotton|wood)\b/i, 'leaf'],
  [/\b(hand|handmade|hand-poured|poured|small[- ]batch|batch|crafted|made|maker|artisan)\b/i, 'care'],
  [/\b(guarantee\w*|secure|safe|safety|warranty|protected|protect\w*|helmets?|insured|licensed)\b/i, 'shield'],
  [/\b(fast|quick|same[- ]day|next[- ]day)\b/i, 'fast'],
  [/\b(quality|award\w*|premium|finest)\b/i, 'award'],
  [/\b(scents?|fragrances?|aroma\w*|candles?|glow|light|burn\w*)\b/i, 'sparkle'],
  [/\b(sponsors?|sponsorship|partners?|partnership)\b/i, 'handshake'],
  [/\b(riders?|racing|racers?|races?|race[- ]day|motocross|podiums?|laps?)\b/i, 'flag'],
  [/\b(famil(?:y|ies)|kids|children|youth|parents)\b/i, 'people'],
  [/\b(phone|call)\b/i, 'phone'],
  [/\b(e-?mail|messages?|inbox)\b/i, 'mail'],
  [/\b(local|town|city|community)\b/i, 'location'],
  [/\b(support|help|questions?|chat|answers?|advice|explain\w*)\b/i, 'chat'],
]

/**
 * The section names that say their items are places (AGL-4065): "Areas we
 * serve", "Towns we serve", "Where we work", "Service area", "Our
 * locations". A practice's or a studio's "areas" of work are not places.
 */
const PLACES =
  /\b(?:(?:service|delivery|coverage) areas?|areas? (?:we (?:serve|cover|work)|served|covered)|towns?|cities|cit(?:y|ies) we|neighbou?rhoods?|where (?:we (?:work|serve|go|are)|to find us)|find us|locations?)\b/i

/**
 * The kinds whose rows take the sparkle where no word names an icon: a calm
 * practice's, a salon's, a celebration's. Every other kind takes the check,
 * and draws the sparkle and the heart nowhere their words do not ask for
 * them (AGL-4065).
 */
const SPARKLE_KINDS: ReadonlySet<string> = new Set(['yoga', 'wellness', 'beauty', 'events'])

/** The icons only those kinds, and a store whose words name its scents and its glow, take from a word. */
const QUIET_ICONS: ReadonlySet<string> = new Set(['sparkle', 'heart'])

/**
 * The icon each item of a row shows (AGL-3676, AGL-4065):
 *
 *  - in a section of places ("Areas we serve"), the place marker, every one
 *    alike: a list of towns is one kind of thing, and the 2026-10-25 booth
 *    kit drew its towns with a marker, a star, a heart and a sparkle;
 *  - else its own where the design named one;
 *  - else one its title suggests, then one its words suggest — "On time" a
 *    clock, "English and Spanish" the translate mark — each once a row;
 *  - else one neutral icon, the same along the row: the check, or the
 *    sparkle on a calm or celebratory site. Never a random mix.
 *
 * `section` is what the section is called (its plan name and its headings);
 * `kind` is the site's kind (`AI_SITE_KINDS`), absent on a page drawn with
 * no design.
 */
export function aiStorefrontItemIcons(
  items: ReadonlyArray<{ title: string; text: string; icon?: string }>,
  known: (word: string | undefined) => boolean,
  options: { section?: string; kind?: string } = {},
): string[] {
  if (options.section && PLACES.test(options.section) && known('location')) return items.map(() => 'location')
  const sparkles = !!options.kind && SPARKLE_KINDS.has(options.kind)
  const neutral = sparkles && known('sparkle') ? 'sparkle' : 'check'
  // A page drawn with no design keeps every word's icon, as before.
  const quiet = !!options.kind && !sparkles && options.kind !== 'store'
  const used = new Set<string>()
  const designed = items.map((item) => {
    if (item.icon && known(item.icon) && !used.has(item.icon)) {
      used.add(item.icon)
      return item.icon
    }
    return ''
  })
  const suggest = (words: string) =>
    ICON_WORDS.find(([pattern, word]) => pattern.test(words) && !used.has(word) && known(word) && !(quiet && QUIET_ICONS.has(word)))?.[1]
  return designed.map((icon, index) => {
    if (icon) return icon
    const item = items[index] as { title: string; text: string }
    const picked = suggest(item.title) ?? suggest(`${item.title} ${item.text}`)
    if (!picked) return neutral
    used.add(picked)
    return picked
  })
}
