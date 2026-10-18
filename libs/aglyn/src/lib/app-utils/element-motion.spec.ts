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
  it('plays the first section’s secondary blocks on load as a ladder, around its heading and picture', () => {
    const nodes = applyElementMotion(page())
    // The row of buttons is opened up too, one rung a button: a call to action, not a group of cards.
    const rungs = ['heroEyebrow', 'heroLede', 'heroCta', 'heroMore']
    rungs.forEach((id, index) => {
      expect(motionOf(nodes, id)).toMatchObject({ aglynAnimation: ELEMENT_MOTION_DEFAULT.preset, aglynAnimationTrigger: 'load' })
      expect(nodes[id].props.aglynAnimationDelay ?? 0).toBe(index * ELEMENT_MOTION_DEFAULT.heroStepMs)
    })
    // Its band never moves, and nothing around its heading and picture moves as one block.
    for (const id of ['hero', 'heroWrap', 'heroGrid', 'heroWordsCell', 'heroWords', 'heroButtons', 'heroPhotoCell']) {
      expect(motionOf(nodes, id)).toEqual({})
    }
  })

  it('PINS LCP: the first section’s main heading and largest picture never move, nor anything holding them (AGL-3581)', () => {
    const nodes = applyElementMotion(page())
    for (const id of ['heroTitle', 'heroPhoto']) {
      expect(motionOf(nodes, id)).toEqual({})
      for (let at: string | null = id; at; at = nodes[at]?.parentId ?? null) expect([at, nodePropsAnimate(nodes[at]?.props)]).toEqual([at, false])
    }
    // The largest picture, not the first: a small one beside it still climbs.
    const base = buildStarterNodes([
      {
        id: 'top',
        componentId: 'section',
        children: [
          { id: 'badge', componentId: 'image', props: { height: '48px' } },
          text('h', 'h2', 'A heading'),
          text('sub', 'h5', 'A subheading'),
          { id: 'big', componentId: 'image', props: { height: '480px' } },
        ],
      },
    ])
    const moved = applyElementMotion(base)
    expect(moving(moved)).toEqual(['badge', 'sub'])
    // With no h1 or display heading, the first heading is the one kept still.
    expect(motionOf(moved, 'h')).toEqual({})
    expect(motionOf(moved, 'big')).toEqual({})
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
    // A section of words alone moves as one block — the third section, so the second of the default turns.
    expect(motionOf(nodes, 'aboutWords')).toMatchObject({ aglynAnimation: 'fade', aglynAnimationTrigger: 'scroll' })
  })

  it('gives later sections the character’s presets in turn, so a page is not one repeated move', () => {
    const character: ElementMotionCharacter = { ...ELEMENT_MOTION_DEFAULT, sectionPresets: ['slide-down', 'zoom-out'] }
    const nodes = applyElementMotion(page(), { character })
    expect(motionOf(nodes, 'servicesTitle')).toMatchObject({ aglynAnimation: 'slide-down' })
    expect(motionOf(nodes, 'aboutWords')).toMatchObject({ aglynAnimation: 'zoom-out' })
    // Without turns, every later section takes the one preset.
    const single = applyElementMotion(page(), { character: { ...ELEMENT_MOTION_DEFAULT, sectionPresets: undefined } })
    expect(motionOf(single, 'aboutWords')).toMatchObject({ aglynAnimation: ELEMENT_MOTION_DEFAULT.preset })
  })

  it('brings a split’s columns in from their own sides, the second a stagger step later', () => {
    const split = (): Record<string, any> =>
      buildStarterNodes([
        { id: 'top', componentId: 'section', children: [text('topTitle', 'h1', 'A title')] },
        {
          id: 'story',
          componentId: 'section',
          children: [
            {
              id: 'storyGrid',
              componentId: 'muiGrid',
              props: { container: true },
              children: [
                {
                  id: 'storyWordsCell',
                  componentId: 'muiGrid',
                  children: [{ id: 'storyWords', componentId: 'muiStack', children: [text('storyTitle', 'h2', 'Our story'), text('storyBody', 'body1', 'Words.')] }],
                },
                { id: 'storyPhotoCell', componentId: 'muiGrid', children: [{ id: 'storyPhoto', componentId: 'image', props: { alt: 'A picture' } }] },
              ],
            },
          ],
        },
      ])
    const nodes = applyElementMotion(split())
    expect(motionOf(nodes, 'storyWordsCell')).toMatchObject({ aglynAnimation: 'slide-right', aglynAnimationTrigger: 'scroll' })
    expect(motionOf(nodes, 'storyPhotoCell')).toMatchObject({
      aglynAnimation: 'slide-left',
      aglynAnimationTrigger: 'scroll',
      aglynAnimationDelay: ELEMENT_MOTION_DEFAULT.staggerStepMs,
    })
    expect(motionOf(nodes, 'storyGrid')).toEqual({})
    // A picture that zooms keeps its zoom; the words still come from their side.
    const zooming = applyElementMotion(split(), { character: { ...ELEMENT_MOTION_DEFAULT, mediaPreset: 'zoom-in' } })
    expect(motionOf(zooming, 'storyWordsCell')).toMatchObject({ aglynAnimation: 'slide-right' })
    expect(motionOf(zooming, 'storyPhotoCell')).toMatchObject({ aglynAnimation: 'zoom-in' })
    // A character without sides brings the columns in one after the other, the picture in the media preset.
    const plain = applyElementMotion(split(), { character: { ...ELEMENT_MOTION_DEFAULT, sides: false, mediaPreset: 'zoom-out' } })
    expect(Object.values(plain).map((node: any) => node.props?.aglynAnimation).filter(Boolean)).not.toContain('slide-right')
    expect(motionOf(plain, 'storyWordsCell')).toMatchObject({ aglynAnimation: ELEMENT_MOTION_DEFAULT.sectionPresets?.[0] })
    expect(motionOf(plain, 'storyPhotoCell')).toMatchObject({ aglynAnimation: 'zoom-out', aglynAnimationDelay: ELEMENT_MOTION_DEFAULT.staggerStepMs })
  })

  it('moves a picture’s frame as the picture, though the picture is laid over it, and never a cover’s backdrop (AGL-3941)', () => {
    const framed = (): Record<string, any> =>
      buildStarterNodes([
        { id: 'top', componentId: 'section', children: [text('topTitle', 'h1', 'A title')] },
        {
          id: 'story',
          componentId: 'section',
          children: [
            {
              id: 'storyGrid',
              componentId: 'muiGrid',
              props: { container: true },
              children: [
                {
                  id: 'storyPhotoCell',
                  componentId: 'muiGrid',
                  children: [
                    {
                      id: 'storyFrame',
                      componentId: 'muiBox',
                      sx: { position: 'relative', overflow: 'hidden', aspectRatio: '4 / 3' },
                      children: [
                        { id: 'storyIcon', componentId: 'icon', props: { iconId: 'camera-outline' } },
                        { id: 'storyPhoto', componentId: 'image', props: { alt: 'A picture' }, sx: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' } },
                      ],
                    },
                  ],
                },
                {
                  id: 'storyWordsCell',
                  componentId: 'muiGrid',
                  children: [{ id: 'storyWords', componentId: 'muiStack', children: [text('storyTitle', 'h2', 'Our story'), text('storyBody', 'body1', 'Words.')] }],
                },
              ],
            },
          ],
        },
        {
          id: 'closing',
          componentId: 'section',
          sx: { position: 'relative', overflow: 'hidden' },
          children: [
            {
              id: 'closingBackdrop',
              componentId: 'muiBox',
              sx: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
              children: [{ id: 'closingPhoto', componentId: 'image', props: { alt: 'A backdrop' } }],
            },
            { id: 'closingWords', componentId: 'muiContainer', sx: { position: 'relative', zIndex: 1 }, children: [text('closingTitle', 'h2', 'Visit us')] },
          ],
        },
      ])
    const nodes = applyElementMotion(framed())
    // The picture on the left comes in from the left with its frame; the words from the right.
    expect(motionOf(nodes, 'storyPhotoCell')).toMatchObject({ aglynAnimation: 'slide-right', aglynAnimationTrigger: 'scroll' })
    expect(motionOf(nodes, 'storyWordsCell')).toMatchObject({ aglynAnimation: 'slide-left' })
    for (const id of ['storyFrame', 'storyIcon', 'storyPhoto']) expect(motionOf(nodes, id)).toEqual({})
    // A cover's backdrop is out of the flow itself: it stays with its band, and only the words move.
    for (const id of ['closingBackdrop', 'closingPhoto']) expect(motionOf(nodes, id)).toEqual({})
    expect(motionOf(nodes, 'closingWords')).toMatchObject({ aglynAnimationTrigger: 'scroll' })
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
            {
              id: 'words',
              componentId: 'muiContainer',
              children: [text('eyebrow', 'overline', 'Hello'), text('title', 'h1', 'Title'), text('lede', 'body1', 'Lede.')],
            },
          ],
        },
      ]),
    )
    expect(moving(nodes)).toEqual(['eyebrow', 'lede'])
    expect(nodes['eyebrow'].props.aglynAnimationDelay).toBeUndefined()
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

  it('gives a group of like items the character’s group preset, whatever its section’s turn (AGL-3941)', () => {
    const character: ElementMotionCharacter = { ...ELEMENT_MOTION_DEFAULT, sectionPresets: ['fade'], groupPreset: 'zoom-in' }
    const nodes = applyElementMotion(page(), { character })
    // The cards take the group's preset; the heading beside them keeps the section's.
    expect(motionOf(nodes, 'servicesGrid')).toMatchObject({ aglynAnimation: 'zoom-in', aglynAnimationStagger: true })
    expect(motionOf(nodes, 'servicesTitle')).toMatchObject({ aglynAnimation: 'fade' })
    expect(motionOf(nodes, 'aboutWords')).toMatchObject({ aglynAnimation: 'fade' })
    // A group whose every item leads with a picture still takes the media preset.
    const gallery = applyElementMotion(
      buildStarterNodes([
        { id: 'top', componentId: 'section', children: [text('topTitle', 'h1', 'Top')] },
        { id: 'gallery', componentId: 'section', children: [grid('pictures', [card('p1', true), card('p2', true)])] },
      ]),
      { character: { ...character, mediaPreset: 'fade' } },
    )
    expect(motionOf(gallery, 'pictures')).toMatchObject({ aglynAnimation: 'fade', aglynAnimationStagger: true })
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

  it('moves the new site’s home: its hero’s secondary blocks climb on load, its feature cards stagger, its form stays still', () => {
    const nodes = buildDefaultHomeScreen('Paperlink').nodes
    expect(nodes['dh_heroOverline'].props.aglynAnimationTrigger).toBe('load')
    expect(nodes['dh_heroSub'].props.aglynAnimationTrigger).toBe('load')
    expect(nodes['dh_heroCta'].props.aglynAnimationTrigger).toBe('load')
    // Its Largest Contentful Paint candidates paint where they stand.
    for (const id of ['dh_heroTitle', 'dh_heroImage', 'dh_heroImageCell']) expect(motionOf(nodes, id)).toEqual({})
    expect(nodes['dh_featuresGrid'].props.aglynAnimationStagger).toBe(true)
    expectStillWhereItMustBe(nodes)
  })

  it('moves every starter page as it is seeded, and leaves the starters a model is shown without motion', () => {
    for (const doc of buildAllStarterTemplateDocs()) {
      const nodes = doc.data['nodes'] as Record<string, any>
      // A page that is only a form or a cart under its heading — a shop's
      // account and cart pages — has nothing to move: the heading is its
      // Largest Contentful Paint, and the rest never moves.
      const words = (id: string) => nodes[id]?.componentId === 'muiTypography'
      const underStill = (id: string | undefined): boolean =>
        !!id && (ELEMENT_MOTION_NEVER.has(nodes[id]?.componentId) || underStill(nodes[id]?.parentId))
      const leaves = Object.entries(nodes).filter(([, node]) => node.parentId && !node.nodes?.length)
      const onlyStill =
        leaves.every(([id]) => underStill(id)) ||
        (leaves.filter(([id]) => !underStill(id)).every(([id]) => words(id)) && leaves.filter(([id]) => words(id)).length === 1)
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
