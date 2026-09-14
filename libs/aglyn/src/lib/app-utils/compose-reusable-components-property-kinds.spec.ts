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

import type { ReusableComponentProp } from '../foundation/definitions/platform.types'
import {
  applyDeclaredProps,
  composeReusableComponentNodes,
  detachInstanceSubtree,
  REUSABLE_INSTANCE_COMPONENT_ID,
  resolveComponentPropTokens,
} from './compose-reusable-components'
import { buildComponentDefaultTokens, buildComponentDefaultValues } from './reusable-prop-values'

/**
 * Every property kind reaches the field bound to it as the value the kind
 * holds (AGL-2893), and every property stored before the kinds existed renders
 * exactly as it did.
 *
 * The graft is the one place per-instance scope exists, and canvas, Preview and
 * the tenant all run it — so this is where a boolean must stay a boolean, a
 * list a list and a color token a color token, and where a stored value from
 * before must not change meaning.
 */

const instance = (
  id: string,
  refId: string,
  propValues?: Record<string, unknown>,
) => ({
  $id: id,
  componentId: REUSABLE_INSTANCE_COMPONENT_ID,
  props: {
    refId,
    name: 'Placed component',
    ...(propValues ? { propValues } : {}),
  },
  nodes: [] as string[],
})

describe('properties stored before every kind existed render exactly as before (AGL-2893)', () => {
  /**
   * The shapes live components store: the 8 original kinds, every default
   * written as text by the old dialog, and an instance written by the old
   * Attributes panel — a real boolean, the `'false'` text a round trip can
   * leave, a choice value and an icon pick with its path.
   */
  const EXPLORE_BAND = {
    rootId: 'band',
    nodes: {
      band: { $id: 'band', componentId: 'muiStack', nodes: ['title', 'cards', 'cta'] },
      title: {
        $id: 'title',
        componentId: 'muiTypography',
        parentId: 'band',
        props: { children: '{{prop.headline}}', variant: '{{prop.titleVariant}}' },
      },
      cards: {
        $id: 'cards',
        componentId: 'muiStack',
        parentId: 'band',
        nodes: ['console', 'crm'],
      },
      console: {
        $id: 'console',
        componentId: 'muiCard',
        parentId: 'cards',
        props: { hideIf: '{{prop.hideConsole}}' },
      },
      crm: {
        $id: 'crm',
        componentId: 'icon',
        parentId: 'cards',
        props: { iconId: '{{prop.crmIcon}}', size: '{{prop.iconSize}}' },
      },
      cta: {
        $id: 'cta',
        componentId: 'muiButton',
        parentId: 'band',
        props: {
          children: '{{prop.ctaLabel}}',
          screenId: '{{prop.ctaLink}}',
          lightbox: '{{prop.playInLightbox}}',
          startIconSrc: '{{prop.ctaImage}}',
          description: '{{prop.body}}',
        },
      },
    },
    props: [
      { name: 'headline', type: 'text', label: 'Headline', defaultValue: 'Explore the platform' },
      { name: 'body', type: 'richText' },
      { name: 'ctaImage', type: 'image', defaultValue: 'media:org:abc/def' },
      { name: 'ctaLabel', defaultValue: 'See everything' },
      { name: 'ctaLink', type: 'href', defaultValue: 'screen:product' },
      { name: 'iconSize', type: 'number', defaultValue: '28' },
      { name: 'hideConsole', type: 'boolean', label: 'Hide Console card', defaultValue: 'false' },
      { name: 'playInLightbox', type: 'boolean', defaultValue: 'true' },
      {
        name: 'titleVariant',
        type: 'choice',
        options: [{ value: 'h2', label: 'Large' }, { value: 'h3', label: 'Medium' }],
        defaultValue: 'h2',
      },
      {
        name: 'crmIcon',
        type: 'icon',
        defaultValue: 'mdiAccountGroup',
        defaultIconPath: 'M12,5.5A3.5,3.5',
      },
    ] as ReusableComponentProp[],
  }

  const compose = (propValues?: Record<string, unknown>) =>
    composeReusableComponentNodes(
      { explore: instance('explore', 'band', propValues) } as never,
      { band: EXPLORE_BAND as never },
    ) as Record<string, any>

  it('renders the defaults, typed as they always were, where the page set nothing', () => {
    const nodes = compose()
    expect(nodes['cmp__explore__title'].props).toEqual({
      children: 'Explore the platform',
      variant: 'h2',
    })
    expect(nodes['cmp__explore__crm'].props).toEqual({
      iconId: 'mdiAccountGroup',
      iconPath: 'M12,5.5A3.5,3.5',
      size: 28,
    })
    expect(nodes['cmp__explore__cta'].props).toEqual({
      children: 'See everything',
      screenId: 'screen:product',
      lightbox: true,
      startIconSrc: 'media:org:abc/def',
      description: '',
    })
    // A default of `'false'` is a no, so the card stays.
    expect(nodes['cmp__explore__console']).toBeDefined()
  })

  it("renders a page's stored values the way the old panel wrote them", () => {
    const nodes = compose({
      headline: 'Every product',
      hideConsole: true,
      playInLightbox: 'false',
      titleVariant: 'h3',
      iconSize: 40,
      crmIcon: { iconId: 'mdiRocket', iconPath: 'M13,22L11,18' },
      ctaLink: '/pricing',
    })
    expect(nodes['cmp__explore__title'].props).toEqual({
      children: 'Every product',
      variant: 'h3',
    })
    // `hideConsole: true` prunes the card and its place in the list.
    expect(nodes['cmp__explore__console']).toBeUndefined()
    expect(nodes['cmp__explore__cards'].nodes).toEqual(['cmp__explore__crm'])
    expect(nodes['cmp__explore__crm'].props).toEqual({
      iconId: 'mdiRocket',
      iconPath: 'M13,22L11,18',
      size: 40,
    })
    expect(nodes['cmp__explore__cta'].props).toMatchObject({
      lightbox: false,
      screenId: '/pricing',
    })
  })

  it('reads the text spelling of a no, which a checkbox round trip leaves behind', () => {
    const nodes = compose({ hideConsole: 'false', playInLightbox: 'off' })
    expect(nodes['cmp__explore__console']).toBeDefined()
    expect(nodes['cmp__explore__cta'].props.lightbox).toBe(false)
  })
})

describe('every property kind reaches its field as the value it holds (AGL-2893)', () => {
  /** One element per kind, each attribute bound to one property. */
  const KITCHEN_SINK = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['el', 'text'] },
      el: {
        $id: 'el',
        componentId: 'kitchenSink',
        parentId: 'root',
        props: {
          color: '{{prop.accent}}',
          width: '{{prop.width}}',
          border: '{{prop.border}}',
          backgroundImage: '{{prop.fill}}',
          span: '{{prop.span}}',
          borderRadius: '{{prop.radius}}',
          fontWeight: '{{prop.weight}}',
          uploadDate: '{{prop.day}}',
          startsAt: '{{prop.time}}',
          body: '{{prop.doc}}',
          rows: '{{prop.table}}',
          revealTarget: '{{prop.target}}',
          productId: '{{prop.product}}',
          collectionId: '{{prop.collection}}',
          categoryId: '{{prop.category}}',
          datasetId: '{{prop.dataset}}',
          datasetFieldId: '{{prop.datasetField}}',
          formId: '{{prop.form}}',
          listingId: '{{prop.plugin}}',
          pluginProps: '{{prop.pluginSettings}}',
          columns: '{{prop.columns}}',
          dense: '{{prop.dense}}',
          topics: '{{prop.topics}}',
          align: '{{prop.align}}',
          size: '{{prop.size}}',
          tags: '{{prop.tags}}',
          filters: '{{prop.filters}}',
        },
      },
      text: {
        $id: 'text',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: 'Topics: {{prop.topics}} in {{prop.accent}}' },
      },
    },
    props: [
      { name: 'accent', type: 'color-picker', defaultValue: 'primary.main' },
      { name: 'width', type: 'css-dimension' },
      { name: 'border', type: 'css-border' },
      { name: 'fill', type: 'css-gradient' },
      { name: 'span', type: 'breakpoint-span' },
      { name: 'radius', type: 'preset-choice', settings: { presets: 'cornerRadius' } },
      { name: 'weight', type: 'theme-scale', settings: { scale: 'fontWeight' } },
      { name: 'day', type: 'date-picker' },
      { name: 'time', type: 'time-picker' },
      { name: 'doc', type: 'markdown' },
      { name: 'table', type: 'data-table' },
      { name: 'target', type: 'node-select' },
      { name: 'product', type: 'product-select' },
      { name: 'collection', type: 'collection-select' },
      { name: 'category', type: 'category-select' },
      { name: 'dataset', type: 'dataset-select' },
      { name: 'datasetField', type: 'dataset-field-select' },
      { name: 'form', type: 'form-select' },
      { name: 'plugin', type: 'plugin-select' },
      { name: 'pluginSettings', type: 'plugin-settings', settings: { pluginProperty: 'plugin' } },
      { name: 'columns', type: 'slider', settings: { min: 1, max: 6 } },
      { name: 'dense', type: 'checkbox' },
      {
        name: 'topics',
        type: 'dual-list-select',
        options: [{ value: 'crm' }, { value: 'dam' }, { value: 'besigner' }],
      },
      { name: 'align', type: 'radio', options: [{ value: 'left' }, { value: 'center' }] },
      { name: 'size', type: 'toggle-button', options: [{ value: 'sm' }, { value: 'lg' }] },
      { name: 'tags', type: 'checkbox', options: [{ value: 'new' }, { value: 'sale' }] },
      {
        name: 'filters',
        type: 'choice',
        options: [{ value: 'a' }, { value: 'b' }],
        settings: { isMulti: true },
      },
    ] as ReusableComponentProp[],
  }

  const PAGE_VALUES = {
    accent: 'secondary.dark',
    width: '320px',
    border: '1px dashed',
    fill: 'linear-gradient(90deg, var(--mui-palette-primary-main, #1f2937) 0%, #fff 100%)',
    span: 'xs:12 md:6',
    radius: 2,
    weight: 'fontWeightBold',
    day: '2026-09-13',
    time: '09:30',
    doc: '**Every** product, one platform.',
    table: '| Plan | Price |\n| Pro | $99 |',
    target: 'thanks-panel',
    product: 'prod_123',
    collection: 'col_456',
    category: 'cat_789',
    dataset: 'ds_jobs',
    datasetField: 'fld_title',
    form: 'form_contact',
    plugin: 'listing_maps',
    pluginSettings: '{"zoom":12}',
    columns: 3,
    dense: true,
    topics: ['crm', 'besigner'],
    align: 'center',
    size: 'lg',
    tags: ['sale'],
    filters: ['a', 'b'],
  }

  const compose = (propValues?: Record<string, unknown>) =>
    composeReusableComponentNodes(
      { sink: instance('sink', 'sink', propValues) } as never,
      { sink: KITCHEN_SINK as never },
    ) as Record<string, any>

  it("hands each field the page's value exactly as the page stored it", () => {
    const element = compose(PAGE_VALUES)['cmp__sink__el'].props
    expect(element).toEqual({
      color: 'secondary.dark',
      width: '320px',
      border: '1px dashed',
      backgroundImage: PAGE_VALUES.fill,
      span: 'xs:12 md:6',
      borderRadius: 2,
      fontWeight: 'fontWeightBold',
      uploadDate: '2026-09-13',
      startsAt: '09:30',
      body: PAGE_VALUES.doc,
      rows: PAGE_VALUES.table,
      revealTarget: 'thanks-panel',
      productId: 'prod_123',
      collectionId: 'col_456',
      categoryId: 'cat_789',
      datasetId: 'ds_jobs',
      datasetFieldId: 'fld_title',
      formId: 'form_contact',
      listingId: 'listing_maps',
      pluginProps: '{"zoom":12}',
      columns: 3,
      dense: true,
      topics: ['crm', 'besigner'],
      align: 'center',
      size: 'lg',
      tags: ['sale'],
      filters: ['a', 'b'],
    })
  })

  it('leaves each field its own default where the page and the component set nothing', () => {
    const element = compose()['cmp__sink__el'].props
    // The one default declared arrives; a single checkbox nobody ticked is a no.
    expect(element).toEqual({ color: 'primary.main', dense: false })
  })

  it('never lets two fields share one list', () => {
    const nodes = compose(PAGE_VALUES)
    const element = nodes['cmp__sink__el'].props
    expect(element.topics).not.toBe(PAGE_VALUES.topics)
  })

  it('substitutes a value into text as words, whatever its kind', () => {
    expect(compose(PAGE_VALUES)['cmp__sink__text'].props.children).toBe(
      'Topics: crm, besigner in secondary.dark',
    )
  })

  it('draws a component editor with the typed defaults', () => {
    const drawn = resolveComponentPropTokens(
      KITCHEN_SINK.nodes as never,
      KITCHEN_SINK.props,
      buildComponentDefaultTokens(KITCHEN_SINK.props),
      undefined,
      buildComponentDefaultValues(KITCHEN_SINK.props),
    ) as Record<string, any>
    expect(drawn['el'].props).toEqual({ color: 'primary.main', dense: false })
  })

  it('detaches into the typed values the instance was rendering', () => {
    let counter = 0
    const detached = detachInstanceSubtree(
      { sink: instance('sink', 'sink', PAGE_VALUES) } as never,
      'sink',
      KITCHEN_SINK as never,
      () => `n${++counter}`,
    ) as Record<string, any>
    const element = Object.values(detached).find(
      (node: any) => node?.componentId === 'kitchenSink',
    ) as any
    expect(element.props).toMatchObject({
      topics: ['crm', 'besigner'],
      columns: 3,
      borderRadius: 2,
    })
  })
})

describe('a property applies only while its condition holds (AGL-2893)', () => {
  const CTA = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['label', 'button'] },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.ctaLabel}}', color: '{{prop.ctaColor}}' },
      },
      button: {
        $id: 'button',
        componentId: 'muiButton',
        parentId: 'root',
        props: {
          children: 'Go',
          hideUnless: '{{prop.ctaLink}}',
          screenId: '{{prop.ctaLink}}',
          disableElevation: '{{prop.flat}}',
        },
      },
    },
    props: [
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
      {
        name: 'ctaColor',
        type: 'color-picker',
        defaultValue: 'primary.main',
        condition: [{ when: 'showCta', is: true }, { when: 'style', is: 'loud' }],
      },
      {
        name: 'style',
        type: 'radio',
        options: [{ value: 'quiet' }, { value: 'loud' }],
        defaultValue: 'loud',
      },
      {
        name: 'flat',
        type: 'boolean',
        defaultValue: 'true',
        condition: { when: 'style', is: 'quiet', notMatch: true },
      },
    ] as ReusableComponentProp[],
  }

  const compose = (propValues?: Record<string, unknown>) =>
    composeReusableComponentNodes(
      { cta: instance('cta', 'cta', propValues) } as never,
      { cta: CTA as never },
    ) as Record<string, any>

  it('applies every property whose condition holds', () => {
    const nodes = compose()
    expect(nodes['cmp__cta__label'].props).toEqual({
      children: 'Talk to sales',
      color: 'primary.main',
    })
    expect(nodes['cmp__cta__button'].props).toEqual({
      children: 'Go',
      screenId: 'screen:contact',
      disableElevation: true,
    })
  })

  it('renders a property whose condition fails as one with no value and no default', () => {
    const nodes = compose({ showCta: false, ctaLabel: 'Book now', style: 'quiet' })
    // Text is empty, a typed field keeps its own default, a Yes / no is a no.
    expect(nodes['cmp__cta__label'].props).toEqual({ children: '' })
    // `hideUnless` bound to a Link that is off removes the button entirely.
    expect(nodes['cmp__cta__button']).toBeUndefined()
  })

  it('switches off a Yes / no to a no, whatever its default', () => {
    const nodes = compose({ style: 'quiet' })
    expect(nodes['cmp__cta__button'].props.disableElevation).toBe(false)
  })

  it('runs the same way over a layout or any tree handed its values directly', () => {
    const nodes = applyDeclaredProps(
      CTA.nodes as never,
      CTA.props,
      { showCta: false },
      'root',
    ) as Record<string, any>
    expect(nodes['button']).toBeUndefined()
    expect(nodes['label'].props.children).toBe('')
  })
})

describe('a property handed on to a component placed inside (AGL-2893)', () => {
  const INNER = {
    rootId: 'i-root',
    nodes: {
      'i-root': {
        $id: 'i-root',
        componentId: 'icon',
        props: { iconId: '{{prop.icon}}', topics: '{{prop.topics}}', dense: '{{prop.dense}}' },
      },
    },
    props: [
      { name: 'icon', type: 'icon' },
      { name: 'topics', type: 'dual-list-select', options: [{ value: 'a' }, { value: 'b' }] },
      { name: 'dense', type: 'boolean', defaultValue: 'true' },
    ] as ReusableComponentProp[],
  }
  const OUTER = {
    rootId: 'o-root',
    nodes: {
      'o-root': { $id: 'o-root', componentId: 'muiStack', nodes: ['o-inner'] },
      'o-inner': {
        ...instance('o-inner', 'inner', {
          icon: '{{prop.badge}}',
          topics: '{{prop.picked}}',
          dense: '{{prop.compact}}',
        }),
        parentId: 'o-root',
      },
    },
    props: [
      { name: 'badge', type: 'icon', defaultValue: 'mdiStar', defaultIconPath: 'M1,1' },
      { name: 'picked', type: 'dual-list-select', options: [{ value: 'a' }, { value: 'b' }] },
      { name: 'compact', type: 'boolean' },
    ] as ReusableComponentProp[],
  }

  const compose = (propValues?: Record<string, unknown>) =>
    composeReusableComponentNodes(
      { outer: instance('outer', 'outer', propValues) } as never,
      { outer: OUTER as never, inner: INNER as never },
    ) as Record<string, any>

  it('keeps a list a list and an icon its path on the way down', () => {
    const icon = compose({ picked: ['b'] })['cmp__outer__o-inner'].props
    expect(icon).toMatchObject({
      iconId: 'mdiStar',
      iconPath: 'M1,1',
      topics: ['b'],
    })
  })

  it("lets the inner component's default apply where the outer page set nothing", () => {
    // `compact` has no value and no default, so the inner Yes / no keeps its
    // own default of yes rather than being handed a no.
    expect(compose()['cmp__outer__o-inner'].props.dense).toBe(true)
    expect(compose({ compact: false })['cmp__outer__o-inner'].props.dense).toBe(false)
  })
})
