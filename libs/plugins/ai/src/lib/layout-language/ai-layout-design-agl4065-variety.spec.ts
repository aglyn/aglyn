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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import { aiLayoutDesignChoices, aiLayoutKindSignature, type AiLayoutDesignChoices } from './ai-layout-design'
import type { AiLayoutSection } from './ai-layout-language'
import type { AiLayoutTargets } from './ai-layout-links'
import { aiLayoutStoredTree } from './ai-layout-store'

/**
 * Two sites of one kind are drawn apart (AGL-4065). The booth kit's two
 * trades sites, Two Oaks Handyman and Holeshot Moto Repair, built on
 * 2026-10-25, read as one page: the trades signature held one group style
 * (`cards`) and one way of numbering steps (`numbers`), so two trades sites
 * agreed on everything but the hero, and on the hero half the time. Its
 * lists now hold more than one option each, as fitness's do, and every site
 * draws two more choices from its seed: whether a designed group's item
 * titles are set as the theme's headings or as its spaced-capital labels
 * (`headingCase`), and whether its plain and soft bands alternate down the
 * page or the page keeps one ground (`bandRhythm`).
 */

/** 200 pairs of seeds, as distinct jobs' seeds are: spread over the whole range. */
const PAIRS = Array.from({ length: 200 }, (_, index) => [((index * 2 + 1) * 2_654_435_761) >>> 0, ((index * 2 + 2) * 2_246_822_519) >>> 0] as const)
const SEEDS = Array.from({ length: 600 }, (_, index) => ((index + 1) * 2_654_435_761) >>> 0)

const differences = (one: AiLayoutDesignChoices, two: AiLayoutDesignChoices) =>
  (Object.keys(one) as Array<keyof AiLayoutDesignChoices>).filter((key) => one[key] !== two[key]).length

describe.each(['trades', 'fitness'])('two %s sites (AGL-4065)', (kind) => {
  const choices = (seed: number) => aiLayoutDesignChoices({ kind, seed, home: true })

  it('hold at least two options in every list of the signature', () => {
    const signature = aiLayoutKindSignature(kind)
    for (const list of ['heroes', 'groups', 'steps', 'pictures'] as const) {
      expect([list, new Set(signature[list]).size >= 2]).toEqual([list, true])
    }
  })

  it('differ in at least two choices for 95% of 200 pairs of seeds', () => {
    const apart = PAIRS.filter(([one, two]) => differences(choices(one), choices(two)) >= 2).length
    expect(apart / PAIRS.length).toBeGreaterThanOrEqual(0.95)
  })

  it('rarely share one layout: the same hero, group style and steps', () => {
    const same = PAIRS.filter(([one, two]) => {
      const [a, b] = [choices(one), choices(two)]
      return a.hero === b.hero && a.group === b.group && a.steps === b.steps
    }).length
    expect(same / PAIRS.length).toBeLessThanOrEqual(kind === 'trades' ? 1 / 6 : 1 / 4)
  })

  it('draw every group style and both kinds of steps its signature names', () => {
    const signature = aiLayoutKindSignature(kind)
    expect(new Set(SEEDS.map((seed) => choices(seed).group))).toEqual(new Set(signature.groups))
    expect(new Set(SEEDS.map((seed) => choices(seed).steps))).toEqual(new Set(signature.steps))
  })
})

describe('the two seeded choices every site draws (AGL-4065)', () => {
  const share = (kind: string, pick: (choices: AiLayoutDesignChoices) => boolean) =>
    SEEDS.filter((seed) => pick(aiLayoutDesignChoices({ kind, seed, home: true }))).length / SEEDS.length

  it('sets item titles as labels about 30% of the time on a trades or fitness site, about 10% elsewhere', () => {
    for (const kind of ['trades', 'fitness']) {
      const caps = share(kind, (choices) => choices.headingCase === 'caps')
      expect([kind, caps > 0.2 && caps < 0.4]).toEqual([kind, true])
    }
    for (const kind of ['business', 'restaurant', 'portfolio']) {
      const caps = share(kind, (choices) => choices.headingCase === 'caps')
      expect([kind, caps > 0.04 && caps < 0.18]).toEqual([kind, true])
    }
  })

  it('draws both band rhythms for every kind', () => {
    for (const kind of AI_SITE_KINDS) {
      const plain = share(kind.id, (choices) => choices.bandRhythm === 'plain')
      expect([kind.id, plain > 0.15 && plain < 0.65]).toEqual([kind.id, true])
    }
  })
})

// ── What the two choices draw ──────────────────────────────────────────────

const TARGETS: AiLayoutTargets = {
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [],
  formPageId: 'pg-contact',
  components: [],
  facts: 'Two Oaks Handyman, a handyman in Seguin.',
}

const reasons = [
  { title: 'Home repairs', text: 'Fixes around the house, done right.' },
  { title: 'Drywall', text: 'Patched, taped and painted.' },
  { title: 'Fences and decks', text: 'Built and repaired.' },
]

/** A home whose bands the model wrote plain and soft, two plain sections side by side. */
const SECTIONS: AiLayoutSection[] = [
  { band: 'plain', blocks: [{ kind: 'heading', text: 'Fixed right the first time', style: 'large' }, { kind: 'lede', text: 'One handyman for the whole list.' }] },
  { band: 'plain', blocks: [{ kind: 'heading', text: 'What we fix' }, { kind: 'cards', items: reasons }] },
  { band: 'plain', blocks: [{ kind: 'heading', text: 'How a job goes' }, { kind: 'steps', items: reasons }] },
  { band: 'soft', blocks: [{ kind: 'heading', text: 'Our story' }, { kind: 'text', text: 'Since 2012 we have fixed homes around Seguin.' }] },
  { band: 'dark', align: 'center', blocks: [{ kind: 'heading', text: 'Ready for a quote?' }, { kind: 'button', text: 'Get in touch', to: 'page:pg-contact' }] },
]
const PLAN: AiLayoutPagePlan = {
  title: 'Home',
  sections: [
    { name: 'Hero', uses: [], items: 0 },
    { name: 'What we fix', uses: [], items: 3 },
    { name: 'How a job goes', uses: [], items: 3 },
    { name: 'Our story', uses: [], items: 0 },
    { name: 'Call to action', uses: [], items: 0 },
  ],
}
const IDS = PLAN.sections.map((_, index) => `sec-${index + 1}`)

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown> | null; nodes?: string[] }

function build(seed: number) {
  const compiled = aiCompileLayoutPage(SECTIONS, PLAN, TARGETS, { reusableComponents: false, sectionIds: IDS, design: { kind: 'trades', seed, home: true } })
  const context = {
    screenIds: TARGETS.pages.map((entry) => entry.id),
    homeScreenIds: ['pg-home'],
    pageSections: PLAN.sections.map((section) => section.name),
    scrollTargetIds: IDS,
    reusableComponents: false,
    repeatsCompiled: true,
    codeBuilt: true,
  }
  const stored = aiLayoutStoredTree(compiled.tree, 'screen', context, IDS)
  if (stored.ok === false) throw new Error(stored.error)
  const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes }, 'page', context)
  return { compiled, nodes: compiled.tree.nodes as unknown as Record<string, Node>, report }
}

const seedWhere = (pick: (choices: AiLayoutDesignChoices) => boolean): number => {
  for (const seed of SEEDS) if (pick(aiLayoutDesignChoices({ kind: 'trades', seed, home: true }))) return seed
  throw new Error('no seed')
}

/** The paper surface a section's band paints, or none. */
const ground = (nodes: Record<string, Node>, id: string) => (nodes[id]?.sx?.['bgcolor'] === 'background.paper' ? 'soft' : nodes[id]?.props?.['colorScheme'] === 'dark' || nodes[id]?.sx?.['bgcolor'] === 'primary.main' ? 'strong' : 'plain')

describe('a page drawn with the two choices (AGL-4065)', () => {
  it('sets designed item titles in the theme’s label style where the seed draws caps, and as headings where it draws sentence case', () => {
    const labels = (seed: number) => {
      const { nodes, report } = build(seed)
      expect(report.violations.map((violation) => violation.code)).toEqual([])
      const titles = Object.values(nodes).filter((node) => node.componentId === 'muiTypography' && /^h[3-6]$/.test(String(node.props?.['component'])))
      return new Set(titles.map((node) => node.props?.['variant']))
    }
    // Ruled columns, so the group is drawn the design's way.
    expect(labels(seedWhere((choices) => choices.headingCase === 'caps' && choices.group === 'ruled'))).toContain('overline')
    expect(labels(seedWhere((choices) => choices.headingCase === 'sentence' && choices.group === 'ruled'))).not.toContain('overline')
  })

  it('keeps one ground down a page whose rhythm is plain, its strong bands as the model wrote them', () => {
    const seed = seedWhere((choices) => choices.bandRhythm === 'plain')
    const { nodes, report } = build(seed)
    expect(report.violations).toEqual([])
    expect(IDS.slice(1).map((id) => ground(nodes, id)).filter((band) => band === 'soft')).toEqual([])
    expect(ground(nodes, 'sec-5')).toBe('strong')
  })

  it('never sets two plain or two soft bands side by side where the rhythm alternates', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      if (aiLayoutDesignChoices({ kind: 'trades', seed, home: true }).bandRhythm !== 'alternate') continue
      const { nodes, report } = build(seed)
      expect(report.violations).toEqual([])
      const bands = IDS.map((id) => ground(nodes, id))
      for (let at = 2; at < bands.length; at += 1) {
        if (bands[at] !== 'strong' && bands[at - 1] !== 'strong') expect([seed, at, bands[at] !== bands[at - 1]]).toEqual([seed, at, true])
      }
    }
  })
})
