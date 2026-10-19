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

import type { AnimationEase, AnimationPreset } from '@aglyn/aglyn/app-utils/element-animation'
import {
  applyElementMotion,
  type ElementMotionCharacter,
} from '@aglyn/aglyn/app-utils/element-motion'

/**
 * How an AI-built site moves (AGL-3838, AGL-3941): a motion CHARACTER per
 * site, turned by the site's design seed, which the platform's entrance pass
 * (`element-motion.ts`) writes onto every page the AI builds.
 *
 * The character comes from one of two places:
 *  - the site's MOTION STYLE, when its look chose one (`siteStyle.motion`,
 *    asked with the rest of the look in `submit_site_look`): a small closed
 *    vocabulary of named characters, {@link AI_SITE_MOTION_STYLES}, each of
 *    which says how a hero, a split, a grid of cards and every other section
 *    arrive;
 *  - else the site's KIND, mapped to a mood: what every site built before
 *    the look chose motion, a replay of one, and any job without a look
 *    moves in.
 *
 * Either way the seed picks within the character's ranges — the first
 * preset, the picture preset, the curve, the timing — so two sites that chose
 * the same style still move apart, and one site moves the same way on every
 * page. No page prompt names a preset and no page answer carries one.
 *
 * The moods, by the kinds `ai-site-kinds.ts` lists:
 *  - CALM — practices, health, reading: fades and rises taken in turn, on a
 *    gentle curve, slower.
 *  - BOLD — studios, fitness, music, events: a rise with overshoot, and
 *    pictures that zoom in.
 *  - GALLERY — portfolios and photography: pictures zoom in, one after
 *    another; the words fade or rise.
 *  - STANDARD — everything else: rises and fades taken in turn.
 *
 * In every mood a page's later sections take the mood's presets in turn,
 * starting where the seed says, and a column of words beside a picture comes
 * in from its own side (Zach 2026-10-16: "some slide in ones would be cool
 * too").
 *
 * Every number stays inside the vocabulary's caps, and inside 400–800 ms for
 * a duration and 60–120 ms between staggered items: slower reads as a site
 * that is loading, faster as one that is twitching.
 */

export type AiSiteMotionMood = 'calm' | 'bold' | 'gallery' | 'standard'

interface AiSiteMotionRange {
  /** The word presets: the seed picks the first, and later sections take them in turn from there. */
  presets: readonly AnimationPreset[]
  /** The picture presets the seed picks among. */
  media: readonly AnimationPreset[]
  eases: readonly AnimationEase[]
  /** Inclusive millisecond ranges. */
  duration: readonly [number, number]
  stagger: readonly [number, number]
  hero: readonly [number, number]
  /** Whether a split's picture and words come in from their own sides; absent, they do. */
  sides?: boolean
  /** The first section's presets the seed picks among; absent, it opens on the first section preset. */
  heroPresets?: readonly AnimationPreset[]
  /** The presets a group of like items — a grid of cards, a list — the seed picks among; absent, the section's own. */
  groupPresets?: readonly AnimationPreset[]
}

/** Each mood's range. The seed picks one character from it. */
export const AI_SITE_MOTION_MOODS: Readonly<Record<AiSiteMotionMood, AiSiteMotionRange>> = {
  calm: {
    presets: ['fade', 'slide-up'],
    media: ['fade'],
    eases: ['gentle-end', 'gentle-both'],
    duration: [650, 800],
    stagger: [100, 120],
    hero: [130, 160],
  },
  bold: {
    presets: ['slide-up'],
    media: ['zoom-in'],
    eases: ['overshoot'],
    duration: [450, 600],
    stagger: [60, 80],
    hero: [80, 100],
  },
  gallery: {
    presets: ['fade', 'slide-up'],
    media: ['zoom-in'],
    eases: ['smooth'],
    duration: [600, 750],
    stagger: [80, 110],
    hero: [110, 130],
  },
  standard: {
    presets: ['slide-up', 'fade'],
    media: ['slide-up', 'fade'],
    eases: ['smooth'],
    duration: [500, 700],
    stagger: [70, 100],
    hero: [100, 130],
  },
}

/** Each site kind's mood; a kind not listed is standard. */
export const AI_SITE_MOTION_KINDS: Readonly<Record<string, AiSiteMotionMood>> = {
  professional: 'calm',
  wellness: 'calm',
  yoga: 'calm',
  beauty: 'calm',
  blog: 'calm',
  studio: 'bold',
  fitness: 'bold',
  music: 'bold',
  events: 'bold',
  portfolio: 'gallery',
  photography: 'gallery',
}

/**
 * The motion styles a site's look chooses among (AGL-3941). Persisted on the
 * site's style; never rename one.
 */
export const AI_SITE_MOTION_STYLES = ['sides', 'rise', 'scale', 'cascade', 'still'] as const

export type AiSiteMotionStyle = (typeof AI_SITE_MOTION_STYLES)[number]

/**
 * Each motion style, by what it does to each kind of section:
 *  - SIDES — a split's picture slides in from its own side and its words
 *    from the other; the rest rises and fades in turn. Pictures never zoom,
 *    so a split's picture always takes its side.
 *  - RISE — everything fades up into place; a split's columns rise one
 *    after the other.
 *  - SCALE — pictures scale into place, from smaller or from larger; the
 *    hero's words fade, and later sections fade and rise in turn.
 *  - CASCADE — cards and lists ripple in one after another at the widest
 *    stagger, quick, often with overshoot.
 *  - STILL — near-static: a short, soft fade, and nothing slides or scales.
 *
 * The hero's main heading never moves under any of them (`element-motion.ts`),
 * and every one is written as the same `aglynAnimation*` props, so a visitor
 * who asks for reduced motion sees none of it.
 */
export const AI_SITE_MOTION_STYLE_RANGES: Readonly<Record<AiSiteMotionStyle, AiSiteMotionRange & { words: string }>> = {
  sides: {
    words: "a split section's picture slides in from its own side and its words from the other; the rest rises",
    presets: ['slide-up', 'fade'],
    heroPresets: ['slide-up', 'fade'],
    media: ['fade', 'slide-up'],
    eases: ['smooth', 'gentle-end'],
    duration: [550, 750],
    stagger: [80, 110],
    hero: [100, 130],
    sides: true,
  },
  rise: {
    words: 'everything fades up into place, section after section',
    presets: ['slide-up'],
    heroPresets: ['slide-up'],
    media: ['slide-up', 'fade'],
    eases: ['smooth', 'gentle-end', 'gentle-both'],
    duration: [500, 700],
    stagger: [70, 100],
    hero: [100, 130],
    sides: false,
  },
  scale: {
    words: 'pictures scale into place while the words fade in',
    presets: ['fade', 'slide-up'],
    heroPresets: ['fade'],
    media: ['zoom-in', 'zoom-out'],
    eases: ['smooth', 'gentle-end'],
    duration: [550, 750],
    stagger: [80, 110],
    hero: [100, 130],
    sides: false,
  },
  cascade: {
    words: 'cards and lists ripple in one after another, quick and lively',
    presets: ['slide-up', 'fade'],
    heroPresets: ['slide-up'],
    groupPresets: ['slide-up', 'zoom-in'],
    media: ['slide-up', 'zoom-in'],
    eases: ['overshoot', 'smooth'],
    duration: [450, 600],
    stagger: [105, 120],
    hero: [110, 140],
    sides: false,
  },
  still: {
    words: 'near-still: a short, soft fade, and nothing slides or scales',
    presets: ['fade'],
    heroPresets: ['fade'],
    media: ['fade'],
    eases: ['gentle-end', 'gentle-both'],
    duration: [400, 500],
    stagger: [60, 75],
    hero: [80, 100],
    sides: false,
  },
}

/** The motion styles each mood suits, which the look is offered and the seed draws among. */
export const AI_SITE_MOTION_SUITS: Readonly<Record<AiSiteMotionMood, readonly AiSiteMotionStyle[]>> = {
  calm: ['still', 'rise', 'sides'],
  bold: ['sides', 'scale', 'cascade', 'rise'],
  gallery: ['scale', 'sides', 'still', 'cascade'],
  standard: ['sides', 'rise', 'scale', 'cascade'],
}

/** A motion style, read defensively: `null` for anything outside the vocabulary. */
export function aiSiteMotionStyle(value: unknown): AiSiteMotionStyle | null {
  return typeof value === 'string' && (AI_SITE_MOTION_STYLES as readonly string[]).includes(value) ? (value as AiSiteMotionStyle) : null
}

/** The motion styles that suit a kind of site. */
export function aiSiteMotionStylesFor(kind: string | null | undefined): readonly AiSiteMotionStyle[] {
  return AI_SITE_MOTION_SUITS[aiSiteMotionMood(kind)]
}

/** The mood a kind of site moves in. */
export function aiSiteMotionMood(kind: string | null | undefined): AiSiteMotionMood {
  return (kind && AI_SITE_MOTION_KINDS[kind]) || 'standard'
}

/**
 * A small deterministic generator over a seed (mulberry32), mixed with its
 * own constant so a site's motion does not move in step with its layout.
 */
function random(seed: number): () => number {
  let state = (seed ^ 0x6a09e667) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length) % list.length] as T
/** A value in an inclusive range, on a step: 10 ms for a duration, 5 ms for a gap. */
const within = (next: () => number, [low, high]: readonly [number, number], step: number): number =>
  low + Math.floor(next() * (Math.floor((high - low) / step) + 1)) * step

/**
 * The motion character of a site: its motion style where its look chose one,
 * else its kind's mood, turned by its seed.
 */
export function aiSiteMotion(input: { kind?: string | null; seed: number; motion?: string | null }): ElementMotionCharacter {
  const style = aiSiteMotionStyle(input.motion)
  const range = style ? AI_SITE_MOTION_STYLE_RANGES[style] : AI_SITE_MOTION_MOODS[aiSiteMotionMood(input.kind)]
  const next = random(input.seed >>> 0)
  const first = Math.floor(next() * range.presets.length) % range.presets.length
  const sectionPresets = range.presets.map((_, index) => range.presets[(first + index) % range.presets.length])
  const character: ElementMotionCharacter = {
    preset: sectionPresets[0],
    sectionPresets,
    sides: range.sides ?? true,
    mediaPreset: pick(next, range.media),
    ease: pick(next, range.eases),
    durationMs: within(next, range.duration, 10),
    staggerStepMs: within(next, range.stagger, 5),
    heroStepMs: within(next, range.hero, 5),
  }
  // Drawn after the rest, so a mood, which names neither, draws the same numbers either way.
  if (range.heroPresets?.length) character.preset = pick(next, range.heroPresets)
  if (range.groupPresets?.length) character.groupPreset = pick(next, range.groupPresets)
  return character
}

/**
 * A page the AI built, with its site's entrance motion written onto it —
 * or the same node map, when there was nothing left to move.
 */
export function aiWithSiteMotion<T extends Record<string, any>>(
  nodes: T,
  site: { kind?: string | null; seed: number; motion?: string | null },
  page: { rootId?: string; sectionIds?: readonly string[] } = {},
): T {
  return applyElementMotion(nodes, {
    character: aiSiteMotion(site),
    ...(page.rootId ? { rootId: page.rootId } : {}),
    ...(page.sectionIds?.length ? { sectionIds: page.sectionIds } : {}),
  })
}
