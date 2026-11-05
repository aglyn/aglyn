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

import { SITE_THEME_BASE_NAMES } from '@aglyn/aglyn/app-utils/site-starter'
import {
  AI_SITE_BASES,
  AI_SITE_BUTTONS,
  AI_SITE_CORNERS,
  AI_SITE_GROUNDS,
  aiSiteFontPairing,
  type AiSiteBase,
  type AiSiteButtons,
  type AiSiteCorners,
  type AiSiteGround,
} from './ai-site-kinds'

/**
 * An AI starter's look (AGL-4049): the built-in base theme, font pairing and
 * finer style tokens its listing promises, carried from "Choose your starter"
 * to the look unit, which keeps each one as it keeps what the sites a person
 * likes pin (`AiSiteLookPins`).
 *
 * AI starters are the built-in shape only: a base, a pairing and tokens over
 * it, with the brand color as the start's own brand answer. A starter that
 * carries a full theme of its own is a base starter, which starts no job.
 *
 * Pure, and small: the guided start, the create door and the look unit all
 * read it, and the console does not load the look's theme builder to do so.
 */

/** The job input the look travels in, as text: the door admits scalars only. */
export const AI_SITE_STARTER_LOOK_INPUT = 'starterLook'

/** The longest the input may be. A whole look is under 120 characters. */
export const AI_SITE_STARTER_LOOK_MAX_CHARS = 400

/** What an AI starter's look may say, every part optional. */
export interface AiSiteStarterLook {
  base?: AiSiteBase
  /** A font pairing, by its `SITE_FONT_PAIRINGS` id. */
  fonts?: string
  /** The brand hue, a whole number of degrees from 0 to 359. */
  hue?: number
  ground?: AiSiteGround
  corners?: AiSiteCorners
  buttons?: AiSiteButtons
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined

/**
 * A look, read strictly: each part kept only when it is exactly a value of
 * its vocabulary (a base, a pairing, a ground, corners or buttons this
 * deployment knows, a whole hue from 0 to 359), with nothing coerced and
 * every other key left out. `null` when no part is left.
 */
export function aiSiteStarterLookOf(raw: unknown): AiSiteStarterLook | null {
  if (!isRecord(raw)) return null
  const look: AiSiteStarterLook = {}
  const base = oneOf(raw['base'], AI_SITE_BASES)
  if (base) look.base = base
  if (aiSiteFontPairing(raw['fonts'])) look.fonts = raw['fonts'] as string
  const hue = raw['hue']
  if (typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < 360) look.hue = hue
  const ground = oneOf(raw['ground'], AI_SITE_GROUNDS)
  if (ground) look.ground = ground
  const corners = oneOf(raw['corners'], AI_SITE_CORNERS)
  if (corners) look.corners = corners
  const buttons = oneOf(raw['buttons'], AI_SITE_BUTTONS)
  if (buttons) look.buttons = buttons
  return Object.keys(look).length ? look : null
}

/** A look as the job input carries it. */
export function aiSiteStarterLookInput(look: AiSiteStarterLook): string {
  return JSON.stringify(aiSiteStarterLookOf(look) ?? {})
}

/**
 * The look a job input carries, read strictly: text within
 * {@link AI_SITE_STARTER_LOOK_MAX_CHARS} holding a look
 * ({@link aiSiteStarterLookOf}); anything else is none.
 */
export function aiSiteStarterLookFromInput(value: unknown): AiSiteStarterLook | null {
  if (typeof value !== 'string' || !value || value.length > AI_SITE_STARTER_LOOK_MAX_CHARS) return null
  try {
    return aiSiteStarterLookOf(JSON.parse(value))
  } catch {
    return null
  }
}

/** Why the door refuses a site job's starter look; `null` when it admits it. Its parts are the look unit's to read. */
export function aiSiteStarterLookRefusal(inputs: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const value = inputs?.[AI_SITE_STARTER_LOOK_INPUT]
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' && value.length <= AI_SITE_STARTER_LOOK_MAX_CHARS
    ? null
    : `${AI_SITE_STARTER_LOOK_INPUT} must be text under ${AI_SITE_STARTER_LOOK_MAX_CHARS} characters`
}

/**
 * What a look is set in, in the words the Style card and the review say it:
 * "Set in Bootstrap with Fraunces and Inter; pick another style to change
 * it." The base by its theme's name, the pairing by its families. `null`
 * for a look that names neither.
 */
export function aiSiteStarterLookLine(look: AiSiteStarterLook | null | undefined): string | null {
  if (!look) return null
  const base = look.base ? (look.base === 'starter' ? 'the starter theme' : SITE_THEME_BASE_NAMES[look.base]) : null
  const pairing = aiSiteFontPairing(look.fonts)
  const type = pairing
    ? pairing.heading.family === pairing.body.family
      ? pairing.heading.family
      : `${pairing.heading.family} and ${pairing.body.family}`
    : null
  const set = base && type ? `${base} with ${type}` : (base ?? type)
  return set ? `Set in ${set}; pick another style to change it.` : null
}
