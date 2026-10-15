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

/** AGL-3838. The entrance-motion pass a code-built page is run through. */

import { buildDefaultHomeScreen } from './default-site'
import {
  ANIMATION_EASINGS,
  ANIMATION_MAX_DURATION_MS,
  ANIMATION_MAX_STAGGER_STEP_MS,
  ANIMATION_PRESETS,
  ANIMATION_TRIGGERS,
  NODE_ANIMATION_PROPS,
  nodePropsAnimate,
  resolveElementAnimation,
} from './element-animation'
import {
  ELEMENT_MOTION_DEFAULT,
  ELEMENT_MOTION_HERO_RUNGS,
  ELEMENT_MOTION_NEVER,
  applyElementMotion,
  type ElementMotionCharacter,
} from './element-motion'
import { buildStarterNodes, starterText as text, type StarterNodeSpec } from './starter-template-nodes'
import { STARTER_TEMPLATES, buildAllStarterTemplateDocs } from './starter-templates'

const card = (id: string, picture = false): StarterNodeSpec => ({
  id,
  componentId: 'muiCard',
  children: [
    ...(picture ? [{ id: `${id}-img`, componentId: 'image', props: { alt: 'A picture' } }] : []),
    text(`${id}-title`, 'h3', 'A card'),
    text(`${id}-body`, 'body1', 'Its words.'),
  ],
})

const grid = (id: string, cards: StarterNodeSpec[]): StarterNodeSpec => ({
  id,
  componentId: 'muiGrid',
  props: { container: true },
  children: cards.map((child) => ({ id: `${child.id}-cell`, componentId: 'muiGrid', props: { size: 'xs:12 md:4' }, children: [child] })),
})

const page = (): Record<string, any> =>
  buildStarterNodes([
    {
      id: 'hero',
      componentId: 'section',
      sx: { bgcolor: 'primary.main' },
      children: [
        {
          id: 'heroWrap',
          componentId: 'muiContainer',
          children: [
            {
              id: 'heroGrid',
              componentId: 'muiGrid',
              props: { container: true },
              children: [
                {
                  id: 'heroWordsCell',
                  componentId: 'muiGrid',
                  children: [
                    {
                      id: 'heroWords',
                      componentId: 'muiStack',
                      children: [
                        text('heroEyebrow', 'overline', 'Hello'),
                        text('heroTitle', 'h1', 'A title'),
                        text('heroLede', 'body1', 'A lede.'),
                        {
                          id: 'heroButtons',
                          componentId: 'muiStack',
                          props: { direction: 'row' },
                          children: [
                            { id: 'heroCta', componentId: 'muiButton', props: { children: 'Go' } },
                            { id: 'heroMore', componentId: 'muiButton', props: { children: 'More' } },
                          ],
                        },
                      ],
                    },
                  ],
                },
                { id: 'heroPhotoCell', componentId: 'muiGrid', children: [{ id: 'heroPhoto', componentId: 'image' }] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'services',
      componentId: 'section',
      children: [
        {
          id: 'servicesWrap',
          componentId: 'muiContainer',
          children: [
            {
              id: 'servicesStack',
              componentId: 'muiStack',
              children: [text('servicesTitle', 'h2', 'Services'), grid('servicesGrid', [card('s1'), card('s2'), card('s3')])],
            },
          ],
        },
      ],
    },
    {
      id: 'about',
      componentId: 'section',
      children: [
        {
          id: 'aboutWords',
          componentId: 'muiStack',
          children: [text('aboutTitle', 'h2', 'About'), text('aboutBody', 'body1', 'Words.')],
        },
      ],
    },
    {
      id: 'contact',
      componentId: 'section',
      children: [
        {
          id: 'contactStack',
          componentId: 'muiStack',
          children: [
            text('contactTitle', 'h2', 'Get in touch'),
            { id: 'contactForm', componentId: 'form', children: [{ id: 'contactField', componentId: 'muiInput' }] },
          ],
        },
      ],
    },
  ])

const motionOf = (nodes: Record<string, any>, id: string) => {
  const props = nodes[id]?.props ?? {}
  return Object.fromEntries(NODE_ANIMATION_PROPS.filter((prop) => prop in props).map((prop) => [prop, props[prop]]))
}
const moving = (nodes: Record<string, any>): string[] =>
  Object.keys(nodes).filter((id) => nodePropsAnimate(nodes[id]?.props)).sort()

describe('applyElementMotion (AGL-3838)', () => {
  it('plays the first section on load as a ladder, opening the column of words beside its picture', () => {
    const nodes = applyElementMotion(page())
    const rungs = ['heroEyebrow', 'heroTitle', 'heroLede', 'heroButtons', 'heroPhotoCell']
    rungs.forEach((id, index) => {
      expect(motionOf(nodes, id)).toMatchObject({ aglynAnimationTrigger: 'load' })
      expect(nodes[id].props.aglynAnimationDelay ?? 0).toBe(index * ELEMENT_MOTION_DEFAULT.heroStepMs)
    })
    expect(nodes['heroTitle'].props.aglynAnimation).toBe(ELEMENT_MOTION_DEFAULT.preset)
    // The picture takes the media preset.
    expect(nodes['heroPhotoCell'].props.aglynAnimation).toBe(ELEMENT_MOTION_DEFAULT.mediaPreset)
    // Its band never moves: only what it holds.
    for (const id of ['hero', 'heroWrap', 'heroGrid', 'heroWordsCell', 'heroWords']) expect(motionOf(nodes, id)).toEqual({})
    // A row of two buttons is a call to action, not a group of cards.
    expect(nodes['heroButtons'].props.aglynAnimationStagger).toBeUndefined()
  })

  it('slides later sections in on scroll, and staggers a grid of cards instead of moving it as one block', () => {
    const nodes = applyElementMotion(page())
    expect(motionOf(nodes, 'servicesTitle')).toEqual({
      aglynAnimation: 'slide-up',
      aglynAnimationTrigger: 'scroll',
      aglynAnimationDuration: ELEMENT_MOTION_DEFAULT.durationMs,
      aglynAnimationEase: ELEMENT_MOTION_DEFAULT.ease,
    })
    expect(motionOf(nodes, 'servicesGrid')).toMatchObject({
      aglynAnimationTrigger: 'scroll',
      aglynAnimationStagger: true,
      aglynAnimationStaggerStep: ELEMENT_MOTION_DEFAULT.staggerStepMs,
    })
    // Nothing nested: no card, cell or word inside the staggered grid moves on its own.
    for (const id of Object.keys(nodes).filter((key) => /^s\d/.test(key))) expect(motionOf(nodes, id)).toEqual({})
    expect(motionOf(nodes, 'servicesStack')).toEqual({})
    // A section of words alone moves as one block.
    expect(motionOf(nodes, 'aboutWords')).toMatchObject({ aglynAnimation: 'slide-up', aglynAnimationTrigger: 'scroll' })
  })

  it('never moves a form or its fields, nor the block that holds one', () => {
    const nodes = applyElementMotion(page())
    expect(motionOf(nodes, 'contactForm')).toEqual({})
    expect(motionOf(nodes, 'contactField')).toEqual({})
    expect(motionOf(nodes, 'contactStack')).toEqual({})
    // What is beside it still moves.
    expect(motionOf(nodes, 'contactTitle')).toMatchObject({ aglynAnimationTrigger: 'scroll' })
  })

  it('never overwrites an author’s choice — `none` included — and never nests under one', () => {
    const base = page()
    base['servicesGrid'].props = { ...base['servicesGrid'].props, aglynAnimation: 'none' }
    base['aboutWords'].props = { aglynAnimation: 'zoom-out', aglynAnimationTrigger: 'hover' }
    const nodes = applyElementMotion(base)
    expect(motionOf(nodes, 'servicesGrid')).toEqual({ aglynAnimation: 'none' })
    expect(motionOf(nodes, 'aboutWords')).toEqual({ aglynAnimation: 'zoom-out', aglynAnimationTrigger: 'hover' })
    expect(moving(nodes).filter((id) => /^s\d|^about/.test(id))).toEqual(['aboutWords'])
  })

  it('leaves the frame, pinned and hidden elements alone', () => {
    const base = buildStarterNodes([
      { id: 'bar', componentId: 'muiAppBar', children: [text('barTitle', 'h6', 'Site')] },
      {
        id: 'band',
        componentId: 'section',
        children: [
          { id: 'pinned', componentId: 'muiBox', sx: { position: { xs: 'static', md: 'sticky' } }, children: [text('pinnedWords', 'body1', 'Pinned.')] },
          { id: 'gone', componentId: 'muiBox', children: [text('goneWords', 'body1', 'Hidden.')] },
          text('words', 'body1', 'Words.'),
        ],
      },
    ])
    base['gone'] = { ...base['gone'], hidden: true }
    expect(moving(applyElementMotion(base))).toEqual(['words'])
  })

  it('leaves a cover photo’s backdrop with its band, and starts the ladder at the first block that moves', () => {
    const nodes = applyElementMotion(
      buildStarterNodes([
        {
          id: 'cover',
          componentId: 'section',
          children: [
            { id: 'backdrop', componentId: 'muiBox', sx: { position: 'absolute', top: 0 }, children: [{ id: 'photo', componentId: 'image' }] },
            { id: 'words', componentId: 'muiContainer', children: [text('title', 'h1', 'Title'), text('lede', 'body1', 'Lede.')] },
          ],
        },
      ]),
    )
    expect(moving(nodes)).toEqual(['lede', 'title'])
    expect(nodes['title'].props.aglynAnimationDelay).toBeUndefined()
    expect(nodes['lede'].props.aglynAnimationDelay).toBe(ELEMENT_MOTION_DEFAULT.heroStepMs)
  })

  it('staggers a dataset repeat and a picture gallery, the gallery with the media preset', () => {
    const character: ElementMotionCharacter = { ...ELEMENT_MOTION_DEFAULT, mediaPreset: 'zoom-in' }
    const nodes = applyElementMotion(
      buildStarterNodes([
        { id: 'top', componentId: 'section', children: [text('topTitle', 'h1', 'Top')] },
        {
          id: 'records',
          componentId: 'muiBox',
          props: { repeatDataset: 'team' },
          children: [card('member', true)],
        },
        { id: 'gallery', componentId: 'section', children: [grid('pictures', [card('p1', true), card('p2', true)])] },
      ]),
      { character },
    )
    expect(motionOf(nodes, 'records')).toMatchObject({ aglynAnimationStagger: true, aglynAnimation: 'zoom-in' })
    expect(motionOf(nodes, 'pictures')).toMatchObject({ aglynAnimationStagger: true, aglynAnimation: 'zoom-in' })
  })

  it('climbs at most the ladder’s rungs, the rest sharing the last', () => {
    const lines = Array.from({ length: 9 }, (_, index) => text(`line${index}`, 'body1', 'Words.'))
    const nodes = applyElementMotion(buildStarterNodes([{ id: 'hero', componentId: 'section', children: lines }]))
    const delays = lines.map((line) => nodes[line.id].props.aglynAnimationDelay ?? 0)
    expect(Math.max(...delays)).toBe((ELEMENT_MOTION_HERO_RUNGS - 1) * ELEMENT_MOTION_DEFAULT.heroStepMs)
  })

  it('is idempotent: a page it already moved comes back as the same object', () => {
    const once = applyElementMotion(page())
    expect(applyElementMotion(once)).toBe(once)
    const empty = buildStarterNodes([])
    expect(applyElementMotion(empty)).toBe(empty)
  })

  it('does not change the nodes it was given', () => {
    const base = page()
    const before = JSON.stringify(base)
    applyElementMotion(base)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('writes only the vocabulary’s own values, inside its caps, which the renderer resolves', () => {
    const nodes = applyElementMotion(page())
    for (const id of moving(nodes)) {
      const props = nodes[id].props
      expect(ANIMATION_PRESETS).toContain(props.aglynAnimation)
      expect(ANIMATION_TRIGGERS).toContain(props.aglynAnimationTrigger)
      expect(ANIMATION_EASINGS).toContain(props.aglynAnimationEase)
      expect(props.aglynAnimationDuration).toBeLessThanOrEqual(ANIMATION_MAX_DURATION_MS)
      if (props.aglynAnimationStagger) expect(props.aglynAnimationStaggerStep).toBeLessThanOrEqual(ANIMATION_MAX_STAGGER_STEP_MS)
      expect(resolveElementAnimation(props)).toBeDefined()
    }
  })

  it('moves the new site’s home: its hero climbs on load, its feature cards stagger, its form stays still', () => {
    const nodes = buildDefaultHomeScreen('Paperlink').nodes
    expect(nodes['dh_heroTitle'].props.aglynAnimationTrigger).toBe('load')
    expect(nodes['dh_heroImageCell'].props.aglynAnimationTrigger).toBe('load')
    expect(nodes['dh_featuresGrid'].props.aglynAnimationStagger).toBe(true)
    expectStillWhereItMustBe(nodes)
  })

  it('moves every starter page as it is seeded, and leaves the starters a model is shown without motion', () => {
    for (const doc of buildAllStarterTemplateDocs()) {
      const nodes = doc.data['nodes'] as Record<string, any>
      // A page that is only a form — a shop's account page — has nothing to move.
      const underStill = (id: string | undefined): boolean =>
        !!id && (ELEMENT_MOTION_NEVER.has(nodes[id]?.componentId) || underStill(nodes[id]?.parentId))
      const onlyStill = Object.entries(nodes)
        .filter(([, node]) => node.parentId && !node.nodes?.length)
        .every(([id]) => underStill(id))
      if (!onlyStill) expect([doc.id, moving(nodes).length > 0]).toEqual([doc.id, true])
      expectStillWhereItMustBe(nodes)
    }
    for (const starter of STARTER_TEMPLATES) {
      for (const screen of starter.screens) expect(moving(screen.nodes)).toEqual([])
    }
  })
})

/** No form, field, frame element, or anything inside one, carries motion. */
function expectStillWhereItMustBe(nodes: Record<string, any>): void {
  const still = (id: string): void => {
    expect([id, nodePropsAnimate(nodes[id]?.props)]).toEqual([id, false])
    for (const child of nodes[id]?.nodes ?? []) still(child)
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (ELEMENT_MOTION_NEVER.has(node.componentId)) still(id)
  }
}
