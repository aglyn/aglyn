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
 * How an AI-built site moves (AGL-3838): a small motion CHARACTER per kind of
 * site, turned by the site's design seed, which the platform's entrance pass
 * (`element-motion.ts`) writes onto every page the AI builds.
 *
 * Decided in code, never by the model: no prompt names a preset, no answer
 * carries one, and no credit is spent on it. The same site — same kind, same
 * seed — always moves the same way on every page, and two sites of one kind
 * are drawn apart by their seeds, the way their looks are.
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
 * too"). A page is never one move repeated.
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

/** The motion character of a site: its kind's mood, turned by its seed. */
export function aiSiteMotion(input: { kind?: string | null; seed: number }): ElementMotionCharacter {
  const range = AI_SITE_MOTION_MOODS[aiSiteMotionMood(input.kind)]
  const next = random(input.seed >>> 0)
  const first = Math.floor(next() * range.presets.length) % range.presets.length
  const sectionPresets = range.presets.map((_, index) => range.presets[(first + index) % range.presets.length])
  return {
    preset: sectionPresets[0],
    sectionPresets,
    sides: true,
    mediaPreset: pick(next, range.media),
    ease: pick(next, range.eases),
    durationMs: within(next, range.duration, 10),
    staggerStepMs: within(next, range.stagger, 5),
    heroStepMs: within(next, range.hero, 5),
  }
}

/**
 * A page the AI built, with its site's entrance motion written onto it —
 * or the same node map, when there was nothing left to move.
 */
export function aiWithSiteMotion<T extends Record<string, any>>(
  nodes: T,
  site: { kind?: string | null; seed: number },
  page: { rootId?: string; sectionIds?: readonly string[] } = {},
): T {
  return applyElementMotion(nodes, {
    character: aiSiteMotion(site),
    ...(page.rootId ? { rootId: page.rootId } : {}),
    ...(page.sectionIds?.length ? { sectionIds: page.sectionIds } : {}),
  })
}
