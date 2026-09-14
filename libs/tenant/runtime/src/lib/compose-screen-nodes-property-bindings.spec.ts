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
 * A COMPONENT PROPERTY DRIVES A NON-TEXT FIELD, ON THE PUBLISHED PAGE
 * (AGL-2871).
 *
 * Inside a reusable component a field with no text box can be bound to one of
 * the component's properties, and each page that places the component sets
 * the value. The graft is unit-tested beside itself;
 * what only this can see is the rest of the tenant pipeline running after it —
 * repeatables, bindings, host tokens, denormalizing — any stage of which could
 * turn a real `false` back into text or drop the value on the floor before the
 * element reads it.
 *
 * So the fixtures run through `composeNodesWithChrome`, the function every
 * published page is composed by, with only its reads stubbed.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetForms(...a),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetDatasets(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
  getWorkflows: (...a: unknown[]) => mockGetWorkflows(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

/**
 * The marketing hero film: its player opens in a lightbox or plays in place,
 * and shows or hides the browser controls, per placement.
 */
const HERO_FILM = {
  rootId: 'f-root',
  nodes: {
    'f-root': { $id: 'f-root', componentId: 'muiStack', nodes: ['f-video'] },
    'f-video': {
      $id: 'f-video',
      componentId: 'video',
      parentId: 'f-root',
      props: {
        src: 'https://cdn.example.com/hero.mp4',
        poster: 'https://cdn.example.com/hero.jpg',
        lightbox: '{{prop.playInLightbox}}',
        controls: '{{prop.showControls}}',
      },
    },
  },
  props: [
    { name: 'playInLightbox', type: 'boolean', label: 'Play in a lightbox' },
    { name: 'showControls', type: 'boolean', defaultValue: 'true' },
  ],
}

/** A page placing the film once, with whatever this page chose. */
const pagePlacingFilm = (propValues?: Record<string, unknown>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero'] },
  hero: {
    $id: 'hero',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: { refId: 'heroFilm', ...(propValues ? { propValues } : {}) },
    nodes: [],
  },
})

const compose = (screenNodes: Record<string, unknown>) =>
  composeNodesWithChrome({ hostId: 'h1', screenNodes: screenNodes as never })

/** The film's player as the page ships it. */
const video = (nodes: Record<string, any>) => nodes['cmp__hero__f-video']

describe('component properties driving non-text fields on the published page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: {} },
      layout: {},
    })
    mockGetComponents.mockResolvedValue({
      definitions: { heroFilm: HERO_FILM },
    })
    mockGetVariables.mockResolvedValue([])
    mockGetFunctions.mockResolvedValue([])
    mockGetDatasets.mockResolvedValue([])
    mockGetWorkflows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue([])
    mockGetForms.mockResolvedValue({ forms: {} })
  })

  describe('a switch bound to a Yes / no property', () => {
    it('reaches the element as a real boolean, whichever way the page set it', async () => {
      const lightbox = video(await compose(pagePlacingFilm({ playInLightbox: true })))
      expect(lightbox.props.lightbox).toBe(true)

      // The string a checkbox round-tripped through text can arrive as. As a
      // string it is non-empty, which the player would read as "open in a
      // lightbox".
      const inPlace = video(
        await compose(pagePlacingFilm({ playInLightbox: 'false' })),
      )
      expect(inPlace.props.lightbox).toBe(false)
    })

    it("uses the property's default where the page chose nothing", async () => {
      const unset = video(await compose(pagePlacingFilm()))
      expect(unset.props.controls).toBe(true)
      // No default declared: a Yes / no nobody set is a no.
      expect(unset.props.lightbox).toBe(false)

      const hidden = video(
        await compose(pagePlacingFilm({ showControls: false })),
      )
      expect(hidden.props.controls).toBe(false)
    })

    it('keeps every value the component set for itself', async () => {
      const shipped = video(await compose(pagePlacingFilm({ playInLightbox: true })))
      expect(shipped.props).toMatchObject({
        src: 'https://cdn.example.com/hero.mp4',
        poster: 'https://cdn.example.com/hero.jpg',
      })
    })
  })

  describe('a dropdown bound to a Choice, and a Screen picker bound to a Link', () => {
    /** The marketing card's "See …" link: its style and target per page. */
    const CARD = {
      rootId: 'c-root',
      nodes: {
        'c-root': { $id: 'c-root', componentId: 'muiStack', nodes: ['c-more'] },
        'c-more': {
          $id: 'c-more',
          componentId: 'muiScreenLink',
          parentId: 'c-root',
          props: {
            children: 'See {{prop.subject}}',
            screenId: '{{prop.moreLink}}',
            variant: '{{prop.linkStyle}}',
          },
        },
      },
      props: [
        { name: 'subject', type: 'text', defaultValue: 'more' },
        { name: 'moreLink', type: 'href', defaultValue: 'screen:products' },
        {
          name: 'linkStyle',
          type: 'choice',
          options: [
            { value: 'text', label: 'Plain' },
            { value: 'outlined', label: 'Outlined' },
          ],
        },
      ],
    }

    const pagePlacingCard = (propValues?: Record<string, unknown>) => ({
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['card'] },
      card: {
        $id: 'card',
        componentId: 'reusableInstance',
        parentId: ROOT,
        props: { refId: 'card', ...(propValues ? { propValues } : {}) },
        nodes: [],
      },
    })

    const link = (nodes: Record<string, any>) => nodes['cmp__card__c-more']

    beforeEach(() => {
      mockGetComponents.mockResolvedValue({ definitions: { card: CARD } })
    })

    it('ships the style and the target the page chose', async () => {
      const shipped = link(
        await compose(
          pagePlacingCard({
            subject: 'pricing',
            moreLink: 'screen:pricing',
            linkStyle: 'outlined',
          }),
        ),
      )
      expect(shipped.props).toMatchObject({
        children: 'See pricing',
        screenId: 'screen:pricing',
        variant: 'outlined',
      })
    })

    it('ships the element its own style when no page and no default chose one', async () => {
      const shipped = link(await compose(pagePlacingCard()))
      // `variant: ''` would reach the button as no style at all.
      expect('variant' in shipped.props).toBe(false)
      expect(shipped.props.screenId).toBe('screen:products')
    })
  })

  describe('an icon picker bound to an Icon property', () => {
    const DATASETS_ICON = {
      iconId: 'mdiDatabase',
      iconPath: 'M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11',
    }
    const CRM_ICON = {
      iconId: 'mdiAccountGroup',
      iconPath: 'M12,5.5A3.5,3.5 0 0,1 15.5,9',
    }

    /** The marketing card's icon chip. */
    const CHIP_CARD = {
      rootId: 'i-root',
      nodes: {
        'i-root': { $id: 'i-root', componentId: 'muiStack', nodes: ['i-chip'] },
        'i-chip': {
          $id: 'i-chip',
          componentId: 'icon',
          parentId: 'i-root',
          props: { iconId: '{{prop.productIcon}}', size: 28 },
        },
      },
      props: [
        {
          name: 'productIcon',
          type: 'icon',
          defaultValue: DATASETS_ICON.iconId,
          defaultIconPath: DATASETS_ICON.iconPath,
        },
      ],
    }

    const pagePlacingChip = (propValues?: Record<string, unknown>) => ({
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['chipCard'] },
      chipCard: {
        $id: 'chipCard',
        componentId: 'reusableInstance',
        parentId: ROOT,
        props: { refId: 'chipCard', ...(propValues ? { propValues } : {}) },
        nodes: [],
      },
    })

    const chip = (nodes: Record<string, any>) => nodes['cmp__chipCard__i-chip']

    beforeEach(() => {
      mockGetComponents.mockResolvedValue({
        definitions: { chipCard: CHIP_CARD },
      })
    })

    it("ships the page's icon with the path the page picked it with", async () => {
      // The path is the half a published page can draw: the catalog it would
      // take to look the id up is never loaded here.
      const shipped = chip(
        await compose(pagePlacingChip({ productIcon: CRM_ICON })),
      )
      expect(shipped.props).toMatchObject({ ...CRM_ICON, size: 28 })
    })

    it("ships the property's default icon, path and all, where the page picked none", async () => {
      const shipped = chip(await compose(pagePlacingChip()))
      expect(shipped.props).toMatchObject(DATASETS_ICON)
    })

    /**
     * A Number property bound into the icon's size (AGL-2880). As the text
     * `'40'` MUI would compile `font-size: 40`, which no browser applies.
     */
    it('ships a size bound to a Number property as a number', async () => {
      mockGetComponents.mockResolvedValue({
        definitions: {
          chipCard: {
            ...CHIP_CARD,
            nodes: {
              ...CHIP_CARD.nodes,
              'i-chip': {
                ...CHIP_CARD.nodes['i-chip'],
                props: {
                  iconId: '{{prop.productIcon}}',
                  size: '{{prop.chipSize}}',
                },
              },
            },
            props: [
              ...CHIP_CARD.props,
              { name: 'chipSize', type: 'number', defaultValue: '28' },
            ],
          },
        },
      })
      expect(chip(await compose(pagePlacingChip())).props.size).toBe(28)
      expect(
        chip(await compose(pagePlacingChip({ chipSize: 40 }))).props.size,
      ).toBe(40)
    })
  })
})

/**
 * EVERY PROPERTY KIND REACHES ITS FIELD TYPED, ON THE PUBLISHED PAGE
 * (AGL-2893).
 *
 * The graft hands each bound field the value its property's kind holds — a
 * color token, a CSS length, a list of answers, a date, a number from a
 * slider — and switches a property off where its condition does not hold.
 * What only this can see is every later stage of the published pipeline
 * leaving those values as the graft handed them.
 */
describe('every property kind on the published page (AGL-2893)', () => {
  const BAND = {
    rootId: 'b-root',
    nodes: {
      'b-root': {
        $id: 'b-root',
        componentId: 'muiStack',
        nodes: ['b-card', 'b-cta'],
        props: {
          bgcolor: '{{prop.accent}}',
          maxWidth: '{{prop.width}}',
          spacing: '{{prop.gap}}',
        },
      },
      'b-card': {
        $id: 'b-card',
        componentId: 'productGrid',
        parentId: 'b-root',
        props: {
          productId: '{{prop.product}}',
          tags: '{{prop.topics}}',
          publishedOn: '{{prop.launch}}',
          columns: '{{prop.columns}}',
          media: '{{prop.poster}}',
        },
      },
      'b-cta': {
        $id: 'b-cta',
        componentId: 'muiButton',
        parentId: 'b-root',
        props: {
          children: '{{prop.ctaLabel}}',
          hideUnless: '{{prop.ctaLink}}',
          screenId: '{{prop.ctaLink}}',
        },
      },
    },
    props: [
      { name: 'accent', type: 'color-picker', defaultValue: 'primary.main' },
      { name: 'width', type: 'css-dimension' },
      { name: 'gap', type: 'preset-choice', settings: { presets: 'gap' } },
      { name: 'product', type: 'product-select' },
      {
        name: 'topics',
        type: 'dual-list-select',
        options: [{ value: 'crm' }, { value: 'dam' }],
      },
      { name: 'launch', type: 'date-picker' },
      { name: 'columns', type: 'slider', settings: { min: 1, max: 4 } },
      { name: 'poster', type: 'image', defaultValue: 'media:org:acme/poster' },
      { name: 'showCta', type: 'boolean', defaultValue: 'true' },
      {
        name: 'ctaLabel',
        type: 'text',
        defaultValue: 'Talk to sales',
        condition: { when: 'showCta', is: true },
      },
      {
        name: 'ctaLink',
        type: 'href',
        defaultValue: 'screen:contact',
        condition: { when: 'showCta', is: true },
      },
    ],
  }

  const pagePlacingBand = (propValues?: Record<string, unknown>) => ({
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['band'] },
    band: {
      $id: 'band',
      componentId: 'reusableInstance',
      parentId: ROOT,
      props: { refId: 'band', ...(propValues ? { propValues } : {}) },
      nodes: [],
    },
  })

  beforeEach(() => {
    mockGetComponents.mockResolvedValue({ definitions: { band: BAND } })
  })

  it("ships each field the page's value exactly as its kind holds it", async () => {
    const nodes = await compose(
      pagePlacingBand({
        accent: 'secondary.dark',
        width: '960px',
        gap: 3,
        product: 'prod_42',
        topics: ['crm', 'dam'],
        launch: '2026-09-13',
        columns: 3,
      }),
    )
    // The instance and its definition's root are one element.
    expect(nodes['band'].props).toMatchObject({
      bgcolor: 'secondary.dark',
      maxWidth: '960px',
      spacing: 3,
    })
    expect(nodes['cmp__band__b-card'].props).toMatchObject({
      productId: 'prod_42',
      tags: ['crm', 'dam'],
      publishedOn: '2026-09-13',
      columns: 3,
      media: 'media:org:acme/poster',
    })
  })

  it('leaves each field its own default where neither page nor component chose', async () => {
    const card = (await compose(pagePlacingBand()))['cmp__band__b-card'].props
    for (const key of ['productId', 'tags', 'publishedOn', 'columns']) {
      expect(key in card).toBe(false)
    }
  })

  it('switches a property off where its condition does not hold', async () => {
    const on = await compose(pagePlacingBand())
    expect(on['cmp__band__b-cta'].props).toMatchObject({
      children: 'Talk to sales',
      screenId: 'screen:contact',
    })
    // With the call to action off, its link is off too, so the button that
    // hides without a link is not on the page at all.
    const off = await compose(pagePlacingBand({ showCta: false }))
    expect(off['cmp__band__b-cta']).toBeUndefined()
  })
})

/**
 * A LAYOUT'S PROPERTIES, SET BY THE SCREEN THAT RENDERS INSIDE IT (AGL-2893).
 *
 * The screen version stores its values beside its layout binding, keyed by
 * layout. What only this can see is the whole published read: the version's
 * values reaching the layout walked from the same document, the layout's
 * declared properties arriving with its published version, and the rest of
 * the pipeline leaving the typed values as they were applied.
 */
describe("a layout's properties on the published page (AGL-2893)", () => {
  const mockGetScreenVersion = jest.requireMock('./get-screen-version')
    .default as jest.Mock
  const mockApplySchedule = jest.requireMock('./apply-publish-schedule')
    .default as jest.Mock

  const LAYOUT = {
    nodes: {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['banner', 'slot'] },
      banner: {
        $id: 'banner',
        componentId: 'muiAlert',
        parentId: ROOT,
        props: {
          children: '{{prop.bannerText}}',
          hideUnless: '{{prop.showBanner}}',
          icon: '{{prop.showIcon}}',
        },
      },
      slot: { $id: 'slot', componentId: 'layoutSlot', parentId: ROOT },
    },
    props: [
      { name: 'showBanner', type: 'boolean', defaultValue: false },
      { name: 'bannerText', type: 'text', defaultValue: 'We are hiring' },
      { name: 'showIcon', type: 'checkbox', defaultValue: true },
    ],
  }

  const SCREEN_NODES = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['copy'] },
    copy: {
      $id: 'copy',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'Pricing' },
    },
  }

  const composeScreen = async (version: Record<string, unknown>) => {
    mockGetScreenVersion.mockResolvedValue({
      version: { nodes: SCREEN_NODES, ...version },
    })
    const { composeScreenNodes } = await import('./compose-screen-nodes')
    return (await composeScreenNodes({
      hostId: 'h1',
      screenId: 'pricing',
      screen: { $id: 'pricing', versionId: 'v1' } as never,
    })) as any
  }

  /** The layout's banner, in the tree the page ships. */
  const findBanner = (tree: Record<string, any>): any =>
    Object.values(tree ?? {}).find((node) => node?.componentId === 'muiAlert')

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetComponents.mockResolvedValue({ definitions: {} })
    mockGetVariables.mockResolvedValue([])
    mockGetFunctions.mockResolvedValue([])
    mockGetDatasets.mockResolvedValue([])
    mockGetWorkflows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue([])
    mockGetForms.mockResolvedValue({ forms: {} })
    mockApplySchedule.mockResolvedValue(null)
    mockGetPublishedLayoutVersion.mockImplementation(async ({ layoutId }: any) =>
      layoutId === 'site'
        ? { version: LAYOUT, layout: { $id: 'site' } }
        : { version: undefined, layout: undefined },
    )
  })

  it('renders the defaults where the screen sets nothing', async () => {
    const tree = await composeScreen({ layoutId: 'site' })
    // The layout framed the screen...
    expect(tree['copy'].parentId).toBe('layout__slot')
    // ...and its banner defaults to hidden, so it is not in the page at all.
    expect(findBanner(tree)).toBeUndefined()
    expect(tree['_@_'].nodes).toEqual(['layout__slot'])
  })

  it("renders the screen's values for its layout, typed", async () => {
    const tree = await composeScreen({
      layoutId: 'site',
      layoutPropValues: {
        site: { showBanner: true, bannerText: 'Launch week', showIcon: false },
      },
    })
    expect(findBanner(tree)?.props).toMatchObject({
      children: 'Launch week',
      icon: false,
    })
  })

  it('reads no values meant for a different layout', async () => {
    const tree = await composeScreen({
      layoutId: 'site',
      layoutPropValues: { retired: { showBanner: true } },
    })
    expect(tree['copy'].parentId).toBe('layout__slot')
    expect(findBanner(tree)).toBeUndefined()
  })
})
