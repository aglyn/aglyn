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
 * Sites I like (AGL-3975, part of AGL-3973): the sites a person names in the
 * guided start as inspiration, as the job carries them.
 *
 * Free names one site and a paid plan three. From each the site job takes
 * SIGNALS only — how the sections run, the colors, the type's mood, the shape
 * of buttons and cards, how the pages move and, on a paid plan, which
 * features it offers — each read by code into the site job's own closed sets
 * (`jobs/ai-site-inspiration-signals.ts`). Never a word, a picture or a logo
 * of theirs: nothing a page says reaches a prompt.
 *
 * Behind `release_ai_site_inspiration`, on by default since 2026-10-28:
 * turned off, the guided start asks for no site and a job's inspiration is
 * never read.
 *
 * Pure and console-safe: the input's name, the limits and how an answer is
 * read. No network.
 */

/** The release flag the whole feature waits behind. */
export const AI_SITE_INSPIRATION_FLAG = 'release_ai_site_inspiration' as const

/**
 * The job input the sites travel in: one string, the addresses separated by
 * spaces, because a job's inputs are scalars (`parseCreateAiJobBody`).
 */
export const AI_SITE_INSPIRATION_INPUT = 'inspiration'

/** How many sites a plan may name: Free one, every paid plan three. */
export const AI_SITE_INSPIRATION_LIMITS = { free: 1, paid: 3 } as const

/** The most any job may carry, whatever its plan. */
export const AI_SITE_INSPIRATION_MAX = AI_SITE_INSPIRATION_LIMITS.paid

/** The longest address one site may be given as. */
export const AI_SITE_INSPIRATION_URL_MAX_CHARS = 300

/** What the guided start says a paid plan adds, beside a Free workspace's locked fields. */
export const AI_SITE_INSPIRATION_PAID_NOTE = `Paid plans can name up to ${AI_SITE_INSPIRATION_LIMITS.paid} sites, and also match the features they offer, like booking, a store or a blog.`

/** How many sites a workspace may name. */
export function aiSiteInspirationLimit(freeTaste: boolean | null | undefined): number {
  return freeTaste ? AI_SITE_INSPIRATION_LIMITS.free : AI_SITE_INSPIRATION_LIMITS.paid
}

/**
 * One address as the job keeps it: https only, no credentials, the default
 * port, no fragment. `null` for anything else. A bare host ("example.com")
 * is read as its https address, the way a person types one.
 */
export function aiSiteInspirationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > AI_SITE_INSPIRATION_URL_MAX_CHARS) return null
  const written = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(written)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  // A host with no dot is a typo or an internal name, never a public site.
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return null
  url.hash = ''
  return url.toString()
}

/**
 * The sites a job's inputs name, or the sentence the door refuses them with.
 * Absent or empty is none. Each must be an https address; more than
 * {@link AI_SITE_INSPIRATION_MAX} is refused, and the same site twice counts
 * once. The plan's own limit is the door's (`aiSiteInspirationRefusal`).
 */
export function parseAiSiteInspiration(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): string[] | string {
  const raw = inputs?.[AI_SITE_INSPIRATION_INPUT]
  if (raw === undefined || raw === null || raw === '') return []
  if (typeof raw !== 'string') {
    return `${AI_SITE_INSPIRATION_INPUT} must be text: the addresses of the sites you like, separated by spaces`
  }
  const urls: string[] = []
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    const url = aiSiteInspirationUrl(word)
    if (!url) return 'Give each site you like as its https address, like https://example.com.'
    if (!urls.includes(url)) urls.push(url)
  }
  if (urls.length > AI_SITE_INSPIRATION_MAX) return `Name at most ${AI_SITE_INSPIRATION_MAX} sites you like.`
  return urls
}

/** Why a workspace may not name this many sites, in a sentence a member reads; `null` when it may. */
export function aiSiteInspirationRefusal(urls: readonly string[], freeTaste: boolean | null | undefined): string | null {
  const limit = aiSiteInspirationLimit(freeTaste)
  if (urls.length <= limit) return null
  return freeTaste
    ? `A Free workspace can name ${AI_SITE_INSPIRATION_LIMITS.free} site you like. ${AI_SITE_INSPIRATION_PAID_NOTE}`
    : `Name at most ${limit} sites you like.`
}

/** The sites as the job input carries them; empty for none, which the start leaves out of its inputs. */
export function aiSiteInspirationInput(urls: readonly string[]): string {
  const kept: string[] = []
  for (const url of urls.map(aiSiteInspirationUrl)) {
    if (url && !kept.includes(url)) kept.push(url)
  }
  return kept.slice(0, AI_SITE_INSPIRATION_MAX).join(' ')
}

/** A site as the review names it: its host, without `www.`. */
export function aiSiteInspirationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
