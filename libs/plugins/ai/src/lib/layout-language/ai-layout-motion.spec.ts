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
 * AGL-3838, AGL-3941. How an AI-built site moves: the motion style its look
 * chose, else its kind's mood, turned by its seed in code.
 */

import {
  ANIMATION_EASINGS,
  ANIMATION_MAX_DURATION_MS,
  ANIMATION_MAX_STAGGER_STEP_MS,
  ANIMATION_PRESETS,
  NODE_ANIMATION_PROPS,
  nodePropsAnimate,
} from '@aglyn/aglyn/app-utils/element-animation'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiLayoutMotionSiteOf, aiLayoutPageCheck } from '../jobs/ai-job-page-language'
import { AI_JUNIPER_PORTFOLIO_PAGE_ANSWER } from '../jobs/fixtures/ai-juniper-portfolio-page-recording'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import {
  AI_SITE_MOTION_KINDS,
  AI_SITE_MOTION_MOODS,
  AI_SITE_MOTION_STYLE_RANGES,
  AI_SITE_MOTION_STYLES,
  AI_SITE_MOTION_SUITS,
  aiSiteMotion,
  aiSiteMotionMood,
  aiSiteMotionStyle,
  aiWithSiteMotion,
  type AiSiteMotionStyle,
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
      // A calm page fades and rises in turn, never one move repeated.
      expect([...(law.sectionPresets ?? [])].sort()).toEqual(['fade', 'slide-up'])
      expect(law.preset).toBe(law.sectionPresets?.[0])
      expect(law.sides).toBe(true)
      expect(['gentle-end', 'gentle-both']).toContain(law.ease)
      const gym = aiSiteMotion({ kind: 'fitness', seed })
      expect(gym).toMatchObject({ preset: 'slide-up', mediaPreset: 'zoom-in', ease: 'overshoot', sides: true })
      expect(aiSiteMotion({ kind: 'photography', seed }).mediaPreset).toBe('zoom-in')
      const trades = aiSiteMotion({ kind: 'trades', seed })
      expect(trades).toMatchObject({ ease: 'smooth', sides: true })
      expect([...(trades.sectionPresets ?? [])].sort()).toEqual(['fade', 'slide-up'])
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

/**
 * The recorded Juniper Clay Studio portfolio answer (2026-10-08, see its
 * fixture), planned with all three of the sections it gave: its hero, its
 * six "Selected works" cards, and its inquiry — the inquiry with a picture on
 * the left in place of the form: the split Zach pointed at on 2026-10-18, a
 * picture beside a heading, its words and a button.
 */
const juniper = () => {
  const recorded = JSON.parse(JSON.stringify(AI_JUNIPER_PORTFOLIO_PAGE_ANSWER)) as { sections: Array<Record<string, any>> }
  const [hero, works, inquiry] = recorded.sections
  const words = inquiry.blocks
    .filter((entry: { kind: string }) => entry.kind !== 'form')
    .map((entry: Record<string, unknown>) => ({ ...entry, col: 1 }))
  const picture = { kind: 'image', col: 0, text: 'A potter trimming a stoneware vase at the wheel', to: '', style: 'none', icon: '', items: [] }
  return { sections: [hero, works, { ...inquiry, blocks: [picture, ...words] }] }
}

describe('a site’s motion style, chosen with its look (AGL-3941)', () => {
  const screen = {
    title: 'Portfolio',
    slug: '/portfolio',
    template: null,
    sections: [
      { name: 'Portfolio Hero', uses: [], items: 0 },
      { name: 'Selected works', uses: [], items: 6 },
      { name: 'Interested in a piece', uses: [], items: 0 },
    ],
  }
  const sectionIds = ['sec-0', 'sec-1', 'sec-2']
  const build = (site: { kind?: string; seed: number; motion?: AiSiteMotionStyle }) => {
    const result = aiLayoutPageCheck({
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'Juniper Clay Studio, a ceramics studio.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, repeatsCompiled: true, scrollTargetIds: sectionIds, reusableComponents: false },
      reusableComponents: false,
      design: { kind: 'portfolio', seed: site.seed, home: false },
      motion: site,
    })(juniper())
    expect(result.violations).toEqual([])
    return result.value?.nodes as Record<string, any>
  }
  const within = (nodes: Record<string, any>, ancestor: string, id: string): boolean => {
    for (let at: string | null = id; at; at = nodes[at]?.parentId ?? null) if (at === ancestor) return true
    return false
  }
  const motionOf = (nodes: Record<string, any>): Record<string, Record<string, unknown>> =>
    Object.fromEntries(
      Object.keys(nodes)
        .filter((id) => nodePropsAnimate(nodes[id].props))
        .sort()
        .map((id) => [id, Object.fromEntries(NODE_ANIMATION_PROPS.filter((prop) => prop in nodes[id].props).map((prop) => [prop, nodes[id].props[prop]]))]),
    )
  /** The split: the inquiry section's moving blocks, those that hold its picture and those that do not. */
  const split = (nodes: Record<string, any>) => {
    const moving = Object.keys(nodes).filter((id) => within(nodes, 'sec-2', id) && nodePropsAnimate(nodes[id].props))
    const holdsPicture = (id: string) => Object.keys(nodes).some((other) => within(nodes, id, other) && nodes[other].componentId === 'image')
    return { picture: moving.filter(holdsPicture), words: moving.filter((id) => !holdsPicture(id)) }
  }

  it('keeps every style inside 400–800 ms, 60–120 ms between items, and the vocabulary; every mood suits several', () => {
    for (const style of AI_SITE_MOTION_STYLES) {
      const range = AI_SITE_MOTION_STYLE_RANGES[style]
      expect(range.duration[0]).toBeGreaterThanOrEqual(400)
      expect(range.duration[1]).toBeLessThanOrEqual(Math.min(800, ANIMATION_MAX_DURATION_MS))
      expect(range.stagger[0]).toBeGreaterThanOrEqual(60)
      expect(range.stagger[1]).toBeLessThanOrEqual(Math.min(120, ANIMATION_MAX_STAGGER_STEP_MS))
      const presets = [...range.presets, ...range.media, ...(range.heroPresets ?? []), ...(range.groupPresets ?? [])]
      for (const preset of presets) expect(ANIMATION_PRESETS).toContain(preset)
      for (const ease of range.eases) expect(ANIMATION_EASINGS).toContain(ease)
      for (const seed of SEEDS) {
        const motion = aiSiteMotion({ kind: 'portfolio', seed, motion: style })
        expect(motion.durationMs).toBeGreaterThanOrEqual(range.duration[0])
        expect(motion.durationMs).toBeLessThanOrEqual(range.duration[1])
        expect(motion.staggerStepMs).toBeGreaterThanOrEqual(range.stagger[0])
        expect(motion.staggerStepMs).toBeLessThanOrEqual(range.stagger[1])
      }
    }
    for (const suits of Object.values(AI_SITE_MOTION_SUITS)) {
      expect(suits.length).toBeGreaterThanOrEqual(3)
      for (const style of suits) expect(AI_SITE_MOTION_STYLES).toContain(style)
    }
    // Every style suits some mood, so the seed can draw each.
    expect(new Set(Object.values(AI_SITE_MOTION_SUITS).flat())).toEqual(new Set(AI_SITE_MOTION_STYLES))
  })

  it('moves the same recorded page five different ways for the five styles a look can choose', () => {
    const drawn = AI_SITE_MOTION_STYLES.map((motion) => JSON.stringify(motionOf(build({ kind: 'portfolio', seed: 42, motion }))))
    expect(new Set(drawn).size).toBe(AI_SITE_MOTION_STYLES.length)
    // And none of them is the portfolio's mood, which a page whose look chose nothing moves in.
    expect(drawn).not.toContain(JSON.stringify(motionOf(build({ kind: 'portfolio', seed: 42 }))))
  })

  it('still moves two sites that chose the same style apart, by their seeds', () => {
    for (const motion of AI_SITE_MOTION_STYLES) {
      const drawn = new Set(SEEDS.map((seed) => JSON.stringify(aiSiteMotion({ kind: 'portfolio', seed, motion }))))
      expect([motion, drawn.size > 4]).toEqual([motion, true])
      expect(aiSiteMotion({ kind: 'portfolio', seed: 9, motion })).toEqual(aiSiteMotion({ kind: 'portfolio', seed: 9, motion }))
    }
  })

  it('under "sides", brings the split’s picture in from its own side and its words from the other', () => {
    for (const seed of SEEDS.slice(0, 16)) {
      const nodes = build({ kind: 'portfolio', seed, motion: 'sides' })
      const { picture, words } = split(nodes)
      expect(picture).toHaveLength(1)
      expect(words).toHaveLength(1)
      // The picture is on the left, so it comes in from the left; the words from the right, a stagger step after it.
      expect(nodes[picture[0]].props).toMatchObject({ aglynAnimation: 'slide-right', aglynAnimationTrigger: 'scroll' })
      expect(nodes[words[0]].props).toMatchObject({ aglynAnimation: 'slide-left', aglynAnimationTrigger: 'scroll' })
      expect(nodes[words[0]].props.aglynAnimationDelay).toBe(aiSiteMotion({ kind: 'portfolio', seed, motion: 'sides' }).staggerStepMs)
    }
    // No other style slides a split in from its sides.
    for (const motion of AI_SITE_MOTION_STYLES.filter((style) => style !== 'sides')) {
      const presets = Object.values(motionOf(build({ kind: 'portfolio', seed: 42, motion }))).map((props) => props['aglynAnimation'])
      expect([motion, presets.filter((preset) => preset === 'slide-left' || preset === 'slide-right')]).toEqual([motion, []])
    }
  })

  it('draws each kind of section from the style: cascade ripples the cards widest, scale zooms the pictures, still only fades', () => {
    const cards = (nodes: Record<string, any>) =>
      Object.keys(nodes).find((id) => within(nodes, 'sec-1', id) && nodes[id].props?.aglynAnimationStagger === true) as string
    for (const seed of SEEDS.slice(0, 16)) {
      const cascade = build({ kind: 'portfolio', seed, motion: 'cascade' })
      const character = aiSiteMotion({ kind: 'portfolio', seed, motion: 'cascade' })
      // The recorded works are picture cards, so they ripple in the picture preset; word cards take the group's.
      const grid = cards(cascade)
      const pictured = (cascade[grid].nodes as string[]).every((card) =>
        Object.keys(cascade).some((id) => within(cascade, card, id) && cascade[id].componentId === 'image'),
      )
      expect(pictured).toBe(true)
      expect(cascade[grid].props).toMatchObject({ aglynAnimation: character.mediaPreset, aglynAnimationStaggerStep: character.staggerStepMs })
      expect(character.groupPreset).toBeDefined()
      expect(character.staggerStepMs).toBeGreaterThanOrEqual(105)
      const scale = build({ kind: 'portfolio', seed, motion: 'scale' })
      expect(['zoom-in', 'zoom-out']).toContain(scale[split(scale).picture[0]].props.aglynAnimation)
      const still = build({ kind: 'portfolio', seed, motion: 'still' })
      expect(new Set(Object.values(motionOf(still)).map((props) => props['aglynAnimation']))).toEqual(new Set(['fade']))
    }
  })

  it('PINS: under every style the hero’s heading stays still, and only the animation props reduced motion turns off are written', () => {
    const strip = (nodes: Record<string, any>) =>
      Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => [
          id,
          {
            ...node,
            props: Object.fromEntries(Object.entries(node.props ?? {}).filter(([key]) => !(NODE_ANIMATION_PROPS as readonly string[]).includes(key))),
          },
        ]),
      )
    // One page, its motion taken off, moved again in every style.
    const plain = strip(build({ kind: 'portfolio', seed: 1 }))
    for (const motion of AI_SITE_MOTION_STYLES) {
      for (const seed of SEEDS.slice(0, 8)) {
        const nodes = aiWithSiteMotion(plain, { kind: 'portfolio', seed, motion }, { sectionIds })
        const heading = Object.keys(nodes).find((id) => within(nodes, 'sec-0', id) && /^(h1|display)/i.test(String(nodes[id].props?.variant ?? '')))
        expect(heading).toBeDefined()
        for (let at: string | null = heading as string; at; at = nodes[at]?.parentId ?? null) {
          expect([motion, at, nodePropsAnimate(nodes[at]?.props)]).toEqual([motion, at, false])
        }
        // The rest of the hero still climbs in on load.
        expect(Object.keys(nodes).some((id) => within(nodes, 'sec-0', id) && nodes[id].props?.aglynAnimationTrigger === 'load')).toBe(true)
        // Nothing but the `aglynAnimation*` props differs from a page that moves another way: no inline
        // transform, transition or opacity, so the tenant's stylesheet, whose every motion rule sits inside
        // `prefers-reduced-motion: no-preference` (element-animation-assets.spec.ts), is all that plays it.
        expect(strip(nodes)).toEqual(plain)
        for (const props of Object.values(motionOf(nodes))) expect(ANIMATION_PRESETS).toContain(props['aglynAnimation'])
      }
    }
  })

  it('falls back to the kind’s mood, unchanged, for a look that chose no style', () => {
    // As AGL-3838 drew them, before a look could choose.
    expect(aiSiteMotion({ kind: 'portfolio', seed: 42 })).toEqual({
      preset: 'slide-up',
      sectionPresets: ['slide-up', 'fade'],
      sides: true,
      mediaPreset: 'zoom-in',
      ease: 'smooth',
      durationMs: 700,
      staggerStepMs: 90,
      heroStepMs: 110,
    })
    expect(aiSiteMotion({ kind: 'yoga', seed: 7 })).toEqual({
      preset: 'slide-up',
      sectionPresets: ['slide-up', 'fade'],
      sides: true,
      mediaPreset: 'fade',
      ease: 'gentle-end',
      durationMs: 660,
      staggerStepMs: 100,
      heroStepMs: 140,
    })
    for (const seed of SEEDS) {
      const mood = aiSiteMotion({ kind: 'portfolio', seed })
      for (const motion of [null, undefined, '', 'bounce', 'SIDES']) expect(aiSiteMotion({ kind: 'portfolio', seed, motion })).toEqual(mood)
    }
    expect(aiSiteMotionStyle('cascade')).toBe('cascade')
    expect(aiSiteMotionStyle('bounce')).toBeNull()
  })

  it('reads the style from the look a unit is handed, and nothing from a look stored before it chose one', () => {
    const job = (siteStyle?: Record<string, unknown>) =>
      ({ $id: 'job-1-p', inputs: { siteKind: 'portfolio', originJobId: 'job-1', ...(siteStyle ? { siteStyle } : {}) } }) as never
    expect(aiLayoutMotionSiteOf(job({ headerAlign: 'start', rhythm: 'calm', seed: 42, motion: 'cascade' }), '/')).toEqual({
      kind: 'portfolio',
      seed: 42,
      motion: 'cascade',
    })
    expect(aiLayoutMotionSiteOf(job({ headerAlign: 'start', rhythm: 'calm', seed: 42 }), '/')).toEqual({ kind: 'portfolio', seed: 42 })
    expect(aiLayoutMotionSiteOf(job({ seed: 42, motion: 'bounce' }), '/')).toEqual({ kind: 'portfolio', seed: 42 })
    // A job that names no kind of site still carries the style its look chose.
    expect(aiLayoutMotionSiteOf({ $id: 'job-2', inputs: { siteStyle: { motion: 'still' } } } as never, '/')).toMatchObject({ motion: 'still' })
  })
})
