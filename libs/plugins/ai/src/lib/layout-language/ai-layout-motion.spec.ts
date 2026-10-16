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

/** AGL-3838. How an AI-built site moves: decided by its kind and seed, in code. */

import {
  ANIMATION_EASINGS,
  ANIMATION_MAX_DURATION_MS,
  ANIMATION_MAX_STAGGER_STEP_MS,
  ANIMATION_PRESETS,
  nodePropsAnimate,
} from '@aglyn/aglyn/app-utils/element-animation'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiLayoutPageCheck } from '../jobs/ai-job-page-language'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import {
  AI_SITE_MOTION_KINDS,
  AI_SITE_MOTION_MOODS,
  aiSiteMotion,
  aiSiteMotionMood,
  aiWithSiteMotion,
} from './ai-layout-motion'

const SEEDS = Array.from({ length: 64 }, (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0)

describe('the motion each kind of site moves in (AGL-3838)', () => {
  it('names only kinds the site kinds list', () => {
    const kinds = AI_SITE_KINDS.map((kind) => kind.id)
    for (const kind of Object.keys(AI_SITE_MOTION_KINDS)) expect(kinds).toContain(kind)
  })

  it('gives every kind a mood, and an unknown kind the standard one', () => {
    for (const kind of AI_SITE_KINDS) expect(Object.keys(AI_SITE_MOTION_MOODS)).toContain(aiSiteMotionMood(kind.id))
    expect(aiSiteMotionMood('not-a-kind')).toBe('standard')
    expect(aiSiteMotionMood(null)).toBe('standard')
  })

  it('keeps every mood inside 400–800 ms, 60–120 ms between items, and the vocabulary', () => {
    for (const range of Object.values(AI_SITE_MOTION_MOODS)) {
      expect(range.duration[0]).toBeGreaterThanOrEqual(400)
      expect(range.duration[1]).toBeLessThanOrEqual(Math.min(800, ANIMATION_MAX_DURATION_MS))
      expect(range.stagger[0]).toBeGreaterThanOrEqual(60)
      expect(range.stagger[1]).toBeLessThanOrEqual(Math.min(120, ANIMATION_MAX_STAGGER_STEP_MS))
      for (const preset of [...range.presets, ...range.media]) expect(ANIMATION_PRESETS).toContain(preset)
      for (const ease of range.eases) expect(ANIMATION_EASINGS).toContain(ease)
    }
    for (const kind of AI_SITE_KINDS) {
      for (const seed of SEEDS) {
        const motion = aiSiteMotion({ kind: kind.id, seed })
        const range = AI_SITE_MOTION_MOODS[aiSiteMotionMood(kind.id)]
        expect(motion.durationMs).toBeGreaterThanOrEqual(range.duration[0])
        expect(motion.durationMs).toBeLessThanOrEqual(range.duration[1])
        expect(motion.staggerStepMs).toBeGreaterThanOrEqual(range.stagger[0])
        expect(motion.staggerStepMs).toBeLessThanOrEqual(range.stagger[1])
        expect(motion.heroStepMs).toBeGreaterThanOrEqual(range.hero[0])
        expect(motion.heroStepMs).toBeLessThanOrEqual(range.hero[1])
      }
    }
  })

  it('moves a calm practice gently, a bold studio with overshoot, a gallery’s pictures by zooming in', () => {
    for (const seed of SEEDS) {
      const law = aiSiteMotion({ kind: 'professional', seed })
      expect(law.preset).toBe('fade')
      expect(['gentle-end', 'gentle-both']).toContain(law.ease)
      const gym = aiSiteMotion({ kind: 'fitness', seed })
      expect(gym).toMatchObject({ preset: 'slide-up', mediaPreset: 'zoom-in', ease: 'overshoot' })
      expect(aiSiteMotion({ kind: 'photography', seed }).mediaPreset).toBe('zoom-in')
      expect(aiSiteMotion({ kind: 'trades', seed })).toMatchObject({ preset: 'slide-up', ease: 'smooth' })
      // A calm site is slower than a bold one, whatever their seeds.
      expect(law.durationMs).toBeGreaterThan(gym.durationMs)
    }
  })

  it('is the same for one site on every page, and differs between sites of one kind', () => {
    expect(aiSiteMotion({ kind: 'business', seed: 42 })).toEqual(aiSiteMotion({ kind: 'business', seed: 42 }))
    const drawn = new Set(SEEDS.map((seed) => JSON.stringify(aiSiteMotion({ kind: 'business', seed }))))
    expect(drawn.size).toBeGreaterThan(8)
  })
})

const block = (kind: string, text: string, items: Array<{ title: string; text: string }> = []) => ({
  kind,
  col: -1,
  text,
  to: '',
  icon: '',
  style: 'none',
  items: items.map((item) => ({ ...item, to: '', icon: '' })),
})

describe('a page the AI designs in the layout language moves (AGL-3838)', () => {
  const screen = {
    title: 'Home',
    slug: '/',
    template: null,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'What we fix', uses: [], items: 3 },
      { name: 'About', uses: [], items: 0 },
    ],
  }
  const sectionIds = ['sec-0', 'sec-1', 'sec-2']
  const answer = {
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Roofs that hold'), block('lede', 'Repairs and replacements across Austin.'), block('button', 'Book an inspection')] },
      {
        band: 'soft',
        align: 'start',
        cols: [],
        blocks: [
          block('heading', 'What we fix'),
          block('cards', '', [
            { title: 'Leaks', text: 'Found and sealed the same week.' },
            { title: 'Storm damage', text: 'Shingles and flashing put back.' },
            { title: 'New roofs', text: 'Tear-off to final inspection.' },
          ]),
        ],
      },
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Family run since 1998'), block('text', 'Two generations on the same streets.')] },
    ],
  }
  const built = (design?: { kind: string; seed: number; home: boolean }) =>
    aiLayoutPageCheck({
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A roofer in Austin.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, repeatsCompiled: true, scrollTargetIds: sectionIds, reusableComponents: false },
      reusableComponents: false,
      ...(design ? { design } : {}),
    })(answer)

  it('opens on load, slides its later sections in on scroll, and staggers its cards', () => {
    const result = built({ kind: 'trades', seed: 7, home: true })
    expect(result.violations).toEqual([])
    const nodes = result.value?.nodes as Record<string, any>
    const moving = Object.entries(nodes).filter(([, node]) => nodePropsAnimate(node.props))
    const inSection = (sectionId: string, id: string): boolean => {
      for (let at: string | null = id; at; at = nodes[at]?.parentId ?? null) if (at === sectionId) return true
      return false
    }
    const first = moving.filter(([id]) => inSection('sec-0', id))
    expect(first.length).toBeGreaterThan(0)
    expect(first.every(([, node]) => node.props.aglynAnimationTrigger === 'load')).toBe(true)
    const later = moving.filter(([id]) => !inSection('sec-0', id))
    expect(later.length).toBeGreaterThan(0)
    expect(later.every(([, node]) => node.props.aglynAnimationTrigger === 'scroll')).toBe(true)
    // The three cards stagger as one group, and nothing inside a card moves on its own.
    const staggered = moving.filter(([id, node]) => node.props.aglynAnimationStagger === true && inSection('sec-1', id))
    expect(staggered).toHaveLength(1)
    expect(nodes[staggered[0][0]].nodes).toHaveLength(3)
    for (const card of nodes[staggered[0][0]].nodes as string[]) {
      expect(moving.filter(([id]) => id !== staggered[0][0] && inSection(card, id))).toEqual([])
    }
    // The first block that moves starts at once; the rest climb after it.
    expect(Math.min(...first.map(([, node]) => node.props.aglynAnimationDelay ?? 0))).toBe(0)
    // Every section's band stays still: only what it holds moves.
    for (const id of [CANVAS_ROOT_ELEMENT_ID, ...sectionIds]) expect(nodePropsAnimate(nodes[id]?.props)).toBe(false)
    // Its motion is the site's own.
    const motion = aiSiteMotion({ kind: 'trades', seed: 7 })
    expect(staggered[0][1].props).toMatchObject({ aglynAnimationStaggerStep: motion.staggerStepMs, aglynAnimationEase: motion.ease })
  })

  it('PINS LCP: on every kind, the first section’s heading and pictures never start hidden (AGL-3581)', () => {
    for (const kind of AI_SITE_KINDS) {
      for (const seed of [1, 7, 42]) {
        const nodes = built({ kind: kind.id, seed, home: true })?.value?.nodes as Record<string, any>
        const inFirst = (id: string): boolean => {
          for (let at: string | null = id; at; at = nodes[at]?.parentId ?? null) if (at === 'sec-0') return true
          return false
        }
        const heading = Object.keys(nodes).find((id) => inFirst(id) && /^(h1|display)/i.test(String(nodes[id].props?.variant ?? '')))
        const pictures = Object.keys(nodes).filter((id) => inFirst(id) && nodes[id].componentId === 'image')
        expect(heading).toBeDefined()
        for (const id of [heading as string, ...pictures]) {
          for (let at: string | null = id; at; at = nodes[at]?.parentId ?? null) {
            expect([kind.id, at, nodePropsAnimate(nodes[at]?.props)]).toEqual([kind.id, at, false])
          }
        }
        // The lede beside the heading still climbs in.
        const moving = Object.keys(nodes).filter((id) => inFirst(id) && nodePropsAnimate(nodes[id].props))
        expect([kind.id, moving.length > 0]).toEqual([kind.id, true])
      }
    }
  })

  it('moves a page whose job names no kind of site, in the standard mood', () => {
    const nodes = built()?.value?.nodes as Record<string, any>
    expect(Object.values(nodes).some((node) => nodePropsAnimate(node.props))).toBe(true)
  })

  it('never overwrites what an author set, so a page run through it again is left as it is', () => {
    const nodes = built({ kind: 'yoga', seed: 3, home: false })?.value?.nodes as Record<string, any>
    expect(aiWithSiteMotion(nodes, { kind: 'fitness', seed: 99 })).toBe(nodes)
  })
})
