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

import {
  composeReusableComponentNodes,
  detachInstanceSubtree,
  getInstanceEffectivePropText,
  getInstanceRootStyleOverride,
  getInstanceStyleOverrides,
  listInstanceStyleTargets,
  matchComponentPropToken,
  nodesReferenceComponent,
  replaceSubtreeWithInstance,
  resolveInstanceIconPath,
  resolveInstanceLeafBinding,
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from './compose-reusable-components'
import { mergeNodeSx } from './merge-node-sx'

const instance = (id: string, refId: string) => ({
  $id: id,
  componentId: REUSABLE_INSTANCE_COMPONENT_ID,
  props: { refId },
  nodes: [] as string[],
})

describe('composeReusableComponentNodes', () => {
  const definition = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['label'] },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: 'Hello' },
      },
    },
  } as any

  it('grafts the definition under the instance with namespaced ids', () => {
    const nodes = {
      _root_: { $id: '_root_', componentId: 'div', nodes: ['a'] },
      a: instance('a', 'card'),
    } as any
    const composed = composeReusableComponentNodes(nodes, { card: definition })

    expect(composed['a'].nodes).toEqual(['cmp__a__root'])
    expect(composed['cmp__a__root']).toMatchObject({
      componentId: 'muiStack',
      parentId: 'a',
      nodes: ['cmp__a__label'],
    })
    expect(composed['cmp__a__label']).toMatchObject({
      componentId: 'muiTypography',
      parentId: 'cmp__a__root',
    })
    // input untouched
    expect(nodes['a'].nodes).toEqual([])
  })

  it('expands multiple instances of the same definition without collisions', () => {
    const nodes = {
      a: instance('a', 'card'),
      b: instance('b', 'card'),
    } as any
    const composed = composeReusableComponentNodes(nodes, { card: definition })
    expect(composed['cmp__a__label']).toBeDefined()
    expect(composed['cmp__b__label']).toBeDefined()
  })

  it('leaves unresolvable instances untouched', () => {
    const nodes = { a: instance('a', 'missing') } as any
    const composed = composeReusableComponentNodes(nodes, {})
    expect(composed['a'].nodes).toEqual([])
  })

  it('expands instances nested inside definitions, bounded on self-reference', () => {
    const nesting = {
      rootId: 'r',
      nodes: {
        r: { $id: 'r', componentId: 'muiStack', nodes: ['inner'] },
        inner: instance('inner', 'card'),
      },
    } as any
    const composed = composeReusableComponentNodes(
      { a: instance('a', 'nesting') } as any,
      { nesting, card: definition },
    )
    expect(composed['cmp__a__inner'].nodes).toEqual([
      'cmp__cmp__a__inner__root',
    ])

    const selfRef = {
      rootId: 'r',
      nodes: { r: instance('r', 'selfRef') },
    } as any
    // Must terminate.
    const bounded = composeReusableComponentNodes(
      { a: instance('a', 'selfRef') } as any,
      { selfRef },
    )
    expect(Object.keys(bounded).length).toBeGreaterThan(1)
  })
})

describe('replaceSubtreeWithInstance', () => {
  /** `App Bar` → brand + a link, sitting in a layout beside a footer. */
  const layout = () =>
    ({
      _root_: { $id: '_root_', componentId: 'div', nodes: ['nav', 'footer'] },
      nav: {
        $id: 'nav',
        parentId: '_root_',
        componentId: 'muiAppBar',
        nodes: ['brand', 'link'],
      },
      brand: {
        $id: 'brand',
        parentId: 'nav',
        componentId: 'muiTypography',
        props: { children: 'Aglyn' },
      },
      link: {
        $id: 'link',
        parentId: 'nav',
        componentId: 'screenLink',
        props: { children: 'Pricing' },
      },
      footer: { $id: 'footer', parentId: '_root_', componentId: 'muiBox' },
    }) as any

  it('swaps the promoted subtree for an instance the renderer will graft', () => {
    const next = replaceSubtreeWithInstance(layout(), 'nav', 'cmp1', 'Site nav')

    // The promoting document must now FOLLOW the component, not hold a copy.
    expect(nodesReferenceComponent(next, 'cmp1')).toBe(true)
    expect(next['nav']).toMatchObject({
      $id: 'nav',
      parentId: '_root_',
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'cmp1', name: 'Site nav' },
      nodes: [],
    })
    // No frozen copy left behind.
    expect(next['brand']).toBeUndefined()
    expect(next['link']).toBeUndefined()
    // Siblings and the parent's child list are untouched, so the tree still
    // resolves and the selection still points at something.
    expect(next['_root_'].nodes).toEqual(['nav', 'footer'])
    expect(next['footer']).toBeDefined()
  })

  it('is the inverse of the graft: the instance re-expands to the definition', () => {
    const before = layout()
    const definition = {
      rootId: 'nav',
      nodes: {
        nav: { $id: 'nav', componentId: 'muiAppBar', nodes: ['brand'] },
        brand: {
          $id: 'brand',
          parentId: 'nav',
          componentId: 'muiTypography',
          props: { children: 'Aglyn' },
        },
      },
    } as any
    const swapped = replaceSubtreeWithInstance(before, 'nav', 'cmp1')
    const composed = composeReusableComponentNodes(swapped, { cmp1: definition })
    expect(composed['nav'].nodes).toEqual(['cmp__nav__nav'])
    expect(composed['cmp__nav__brand']).toMatchObject({
      props: { children: 'Aglyn' },
    })
  })

  it('drops the whole subtree, not just direct children', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a'] },
      a: { $id: 'a', parentId: 'root', componentId: 'muiStack', nodes: ['b'] },
      b: { $id: 'b', parentId: 'a', componentId: 'muiStack', nodes: ['c'] },
      c: { $id: 'c', parentId: 'b', componentId: 'muiTypography' },
    } as any
    const next = replaceSubtreeWithInstance(nodes, 'a', 'cmp1')
    expect(Object.keys(next).sort()).toEqual(['a', 'root'])
  })

  it('never mutates the input and no-ops on an unknown root or definition', () => {
    const before = layout()
    const next = replaceSubtreeWithInstance(before, 'nav', 'cmp1', 'Site nav')
    expect(before['nav'].nodes).toEqual(['brand', 'link'])
    expect(before['brand']).toBeDefined()
    expect(next).not.toBe(before)

    expect(replaceSubtreeWithInstance(before, 'nope', 'cmp1')).toBe(before)
    expect(replaceSubtreeWithInstance(before, 'nav', '')).toBe(before)
  })
})

describe('nodesReferenceComponent', () => {
  it('finds a direct instance and ignores other definitions', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a', 'b'] },
      a: instance('a', 'card'),
      b: instance('b', 'banner'),
    } as any
    expect(nodesReferenceComponent(nodes, 'card')).toBe(true)
    expect(nodesReferenceComponent(nodes, 'banner')).toBe(true)
    expect(nodesReferenceComponent(nodes, 'hero')).toBe(false)
  })

  it('does not mistake a same-named prop on an ordinary node', () => {
    // A plain component carrying `refId` is not an instance — only the
    // reusableInstance componentId makes the renderer graft.
    const nodes = {
      a: { $id: 'a', componentId: 'muiButton', props: { refId: 'card' } },
    } as any
    expect(nodesReferenceComponent(nodes, 'card')).toBe(false)
  })

  it('agrees with the graft about what counts as a reference', () => {
    const definition = {
      rootId: 'root',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
    } as any
    const nodes = { a: instance('a', 'card') } as any
    // If the scan says referenced, the composer must actually expand it.
    expect(nodesReferenceComponent(nodes, 'card')).toBe(true)
    const composed = composeReusableComponentNodes(nodes, { card: definition })
    expect(composed['a'].nodes).toEqual(['cmp__a__root'])
  })

  it('is safe on empty, missing and id-less input', () => {
    expect(nodesReferenceComponent(undefined, 'card')).toBe(false)
    expect(nodesReferenceComponent(null, 'card')).toBe(false)
    expect(nodesReferenceComponent({}, 'card')).toBe(false)
    // An empty needle must never match everything.
    expect(nodesReferenceComponent({ a: instance('a', 'card') } as any, '')).toBe(
      false,
    )
  })
})

describe('resolveInstanceIconPath (AGL-1193)', () => {
  const definitions = {
    card: {
      rootId: 'root',
      nodes: {},
      icon: { iconId: 'mdi-card', iconPath: 'M1 1h2' },
    },
    banner: { rootId: 'root', nodes: {} },
  } as any

  it('draws an instance with the icon its definition chose', () => {
    expect(resolveInstanceIconPath(instance('a', 'card'), definitions)).toBe(
      'M1 1h2',
    )
  })

  it('falls back for a definition that chose none', () => {
    // Undefined, never a substitute path: the caller owns the fallback, and
    // a confident wrong glyph is exactly what AGL-1212 was.
    expect(
      resolveInstanceIconPath(instance('a', 'banner'), definitions),
    ).toBeUndefined()
  })

  it('never resolves an id alone', () => {
    // A definition whose `iconPath` never got denormalized must degrade to
    // the fallback — resolving the id would need the 2.9 MB catalog, which
    // render surfaces do not load.
    const idOnly = { card: { rootId: 'root', nodes: {}, icon: { iconId: 'mdi-card' } } } as any
    expect(resolveInstanceIconPath(instance('a', 'card'), idOnly)).toBeUndefined()
  })

  it('ignores nodes that are not instances', () => {
    // Same rule the graft applies: a plain component carrying `refId` is
    // not an instance, so it must not borrow a definition's icon.
    const impostor = {
      $id: 'a',
      componentId: 'muiButton',
      props: { refId: 'card' },
    }
    expect(resolveInstanceIconPath(impostor, definitions)).toBeUndefined()
  })

  it('is safe on empty, missing and unknown input', () => {
    expect(resolveInstanceIconPath(undefined, definitions)).toBeUndefined()
    expect(resolveInstanceIconPath(instance('a', 'card'), undefined)).toBeUndefined()
    expect(resolveInstanceIconPath(instance('a', 'gone'), definitions)).toBeUndefined()
    expect(resolveInstanceIconPath(instance('a', ''), definitions)).toBeUndefined()
  })
})

describe('declared props (AGL-1247)', () => {
  /** A hero whose headline and image are parameterised. */
  const hero = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['h', 'img'] },
      h: {
        $id: 'h',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.headline}}' },
      },
      img: {
        $id: 'img',
        componentId: 'muiImage',
        parentId: 'root',
        props: { src: '{{prop.image}}', alt: 'Hero — {{prop.headline}}' },
      },
    },
    props: [
      { name: 'headline', type: 'text', defaultValue: 'Headline goes here' },
      { name: 'image', type: 'image', defaultValue: '/placeholder.png' },
    ],
  } as any

  const heroInstance = (id: string, propValues?: Record<string, unknown>) => ({
    $id: id,
    componentId: REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId: 'hero', ...(propValues && { propValues }) },
    nodes: [] as string[],
  })

  it('substitutes each instance\'s own values into its grafted copy', () => {
    const nodes = {
      a: heroInstance('a', { headline: 'Ship faster', image: '/a.png' }),
      b: heroInstance('b', { headline: 'Design once', image: '/b.png' }),
    } as any
    const composed = composeReusableComponentNodes(nodes, { hero })

    expect(composed['cmp__a__h'].props.children).toBe('Ship faster')
    expect(composed['cmp__a__img'].props.src).toBe('/a.png')
    expect(composed['cmp__a__img'].props.alt).toBe('Hero — Ship faster')
    // The same definition, a different instance, different values — the
    // whole point of the feature.
    expect(composed['cmp__b__h'].props.children).toBe('Design once')
    expect(composed['cmp__b__img'].props.src).toBe('/b.png')
    // Inputs untouched.
    expect(hero.nodes.h.props.children).toBe('{{prop.headline}}')
  })

  it('falls back to the declared default where an instance sets nothing', () => {
    const composed = composeReusableComponentNodes(
      { a: heroInstance('a') } as any,
      { hero },
    )
    expect(composed['cmp__a__h'].props.children).toBe('Headline goes here')
    expect(composed['cmp__a__img'].props.src).toBe('/placeholder.png')
  })

  it('treats an empty override as unset, but keeps false and 0', () => {
    const withFlags = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiStack',
          props: { a: '{{prop.headline}}', b: '{{prop.count}}', c: '{{prop.on}}' },
        },
      },
      props: [
        { name: 'headline', defaultValue: 'Default copy' },
        { name: 'count', defaultValue: '9' },
        { name: 'on', defaultValue: 'true' },
      ],
    } as any
    const composed = composeReusableComponentNodes(
      {
        a: {
          $id: 'a',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'x', propValues: { headline: '', count: 0, on: false } },
          nodes: [],
        },
      } as any,
      { x: withFlags },
    )
    // Cleared field → the component's own copy, never an empty section.
    expect(composed['cmp__a__root'].props.a).toBe('Default copy')
    // Real values, not "unset".
    expect(composed['cmp__a__root'].props.b).toBe('0')
    expect(composed['cmp__a__root'].props.c).toBe('false')
  })

  it('leaves other token namespaces for the resolvers downstream', () => {
    const definition = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiTypography',
          props: { children: '{{prop.headline}} — {{var:abc}} {{host.name}}' },
        },
      },
      props: [{ name: 'headline', defaultValue: 'Hi' }],
    } as any
    const composed = composeReusableComponentNodes(
      { a: heroInstance('a') } as any,
      { hero: definition },
    )
    // Only `prop.*` is consumed here; compose runs graft → repeatables →
    // resolveNodesBindings, so these must still be intact.
    expect(composed['cmp__a__root'].props.children).toBe(
      'Hi — {{var:abc}} {{host.name}}',
    )
  })

  it('negative control: an undeclared prop is not substituted', () => {
    const definition = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiTypography',
          props: { children: '{{prop.headline}}' },
        },
      },
      // No `props` — an unparameterised definition, as every component
      // built before AGL-1247 is.
    } as any
    const composed = composeReusableComponentNodes(
      { a: heroInstance('a', { headline: 'ignored' }) } as any,
      { hero: definition },
    )
    // Untouched: substitution is driven by the DECLARATION, not by whatever
    // an instance happens to carry.
    expect(composed['cmp__a__root'].props.children).toBe('{{prop.headline}}')
  })
})

describe('root style overrides (AGL-1306)', () => {
  const definition = {
    rootId: 'root',
    nodes: {
      root: {
        $id: 'root',
        componentId: 'muiStack',
        sx: { backgroundColor: '#101828', py: 8 },
        nodes: ['label'],
      },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        sx: { color: '#fff' },
      },
    },
  } as any

  const overriddenInstance = (
    id: string,
    root: Record<string, unknown>,
  ) => ({
    $id: id,
    componentId: REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId: 'cta' },
    styleOverrides: { [STYLE_OVERRIDES_ROOT_KEY]: root },
    nodes: [] as string[],
  })

  it('merges the instance override over the grafted ROOT sx, leaf-wise', () => {
    const composed = composeReusableComponentNodes(
      { a: overriddenInstance('a', { backgroundColor: '#0b4a6f' }) } as any,
      { cta: definition },
    )
    // The named leaf is replaced; the root's other properties and the
    // subtree's own styles are untouched.
    expect(composed['cmp__a__root'].sx).toEqual({
      backgroundColor: '#0b4a6f',
      py: 8,
    })
    expect(composed['cmp__a__label'].sx).toEqual({ color: '#fff' })
    // The definition itself is never mutated — the next instance grafts
    // the original.
    expect(definition.nodes.root.sx).toEqual({
      backgroundColor: '#101828',
      py: 8,
    })
  })

  it('each instance renders its own override; unoverridden instances keep the component look', () => {
    const composed = composeReusableComponentNodes(
      {
        a: overriddenInstance('a', { backgroundColor: '#0b4a6f' }),
        b: {
          $id: 'b',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'cta' },
          nodes: [] as string[],
        },
      } as any,
      { cta: definition },
    )
    // Read through `toHaveProperty`: `sx` is the full MUI union (array,
    // callback, pseudo-selector map), so no dotted key is reachable on it.
    expect(composed['cmp__a__root'].sx).toHaveProperty(
      'backgroundColor',
      '#0b4a6f',
    )
    expect(composed['cmp__b__root'].sx).toHaveProperty(
      'backgroundColor',
      '#101828',
    )
  })

  it('survives a republished definition: the override rides the CURRENT root', () => {
    // Same instance node, new definition content — what the screen document
    // sees after the component republishes. The override merges over the
    // new root rather than pinning any old copy.
    const republished = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiStack',
          sx: { backgroundColor: '#14532d', px: 4 },
          nodes: [],
        },
      },
    } as any
    const composed = composeReusableComponentNodes(
      { a: overriddenInstance('a', { backgroundColor: '#0b4a6f' }) } as any,
      { cta: republished },
    )
    expect(composed['cmp__a__root'].sx).toEqual({
      backgroundColor: '#0b4a6f',
      px: 4,
    })
  })

  it('keeps the instance node itself carrying its overrides after the graft', () => {
    const composed = composeReusableComponentNodes(
      { a: overriddenInstance('a', { backgroundColor: '#0b4a6f' }) } as any,
      { cta: definition },
    )
    // The override is document state, not render output: a save of the
    // composed-for-canvas map must still find it on the instance.
    expect((composed['a'] as any).styleOverrides).toEqual({
      [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#0b4a6f' },
    })
  })

  it('an empty or absent override leaves the grafted root sx alone', () => {
    const composed = composeReusableComponentNodes(
      {
        a: overriddenInstance('a', {}),
        b: {
          $id: 'b',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'cta' },
          styleOverrides: {},
          nodes: [] as string[],
        },
      } as any,
      { cta: definition },
    )
    expect(composed['cmp__a__root'].sx).toEqual(definition.nodes.root.sx)
    expect(composed['cmp__b__root'].sx).toEqual(definition.nodes.root.sx)
  })

  it('getInstanceRootStyleOverride answers only for instances with a real record', () => {
    expect(
      getInstanceRootStyleOverride(
        overriddenInstance('a', { py: 2 }) as any,
      ),
    ).toEqual({ py: 2 })
    // Not an instance: styleOverrides on an ordinary node is inert here.
    expect(
      getInstanceRootStyleOverride({
        componentId: 'muiStack',
        styleOverrides: { [STYLE_OVERRIDES_ROOT_KEY]: { py: 2 } },
      } as any),
    ).toBeUndefined()
    expect(getInstanceRootStyleOverride(undefined)).toBeUndefined()
    expect(
      getInstanceRootStyleOverride({
        componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      } as any),
    ).toBeUndefined()
  })
})

/**
 * Per-leaf overrides (AGL-1332). Root-only overrides could change an
 * instance's background but never a leaf that sets its OWN colour — which
 * is every text leaf in the real Marketing CTA. Setting one instance to a
 * white band therefore rendered a white headline on white (AGL-1318), one
 * page at a time. So the shape under test is that component: a dark root
 * with two Typography leaves hard-set to `common.white`.
 */
describe('per-leaf style overrides (AGL-1332)', () => {
  const cta = {
    rootId: 'root',
    nodes: {
      root: {
        $id: 'root',
        componentId: 'muiStack',
        sx: { backgroundColor: '#101828', py: 8 },
        nodes: ['headline', 'lede'],
      },
      headline: {
        $id: 'headline',
        componentId: 'muiTypography',
        parentId: 'root',
        sx: { fontSize: 32, fontWeight: 900, color: 'common.white' },
      },
      lede: {
        $id: 'lede',
        componentId: 'muiTypography',
        parentId: 'root',
        sx: { fontSize: 18, opacity: 0.94, color: 'common.white' },
      },
    },
  } as any

  const instanceWith = (id: string, styleOverrides: Record<string, any>) => ({
    $id: id,
    componentId: REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId: 'cta' },
    styleOverrides,
    nodes: [] as string[],
  })

  it('THE BUG: a white band can bring black text with it', () => {
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith('a', {
          [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#fff' },
          headline: { color: '#0B1220' },
          lede: { color: '#5A6675' },
        }),
      } as any,
      { cta },
    )
    expect(composed['cmp__a__root'].sx).toEqual({
      backgroundColor: '#fff',
      py: 8,
    })
    // The half root overrides could never reach: the leaf's own colour is
    // replaced, and everything else it declares survives.
    expect(composed['cmp__a__headline'].sx).toEqual({
      fontSize: 32,
      fontWeight: 900,
      color: '#0B1220',
    })
    expect(composed['cmp__a__lede'].sx).toEqual({
      fontSize: 18,
      opacity: 0.94,
      color: '#5A6675',
    })
    // The definition is never mutated — the next instance grafts the
    // component's own colours.
    expect(cta.nodes.headline.sx.color).toBe('common.white')
  })

  it('is keyed on the DEFINITION id, not the derived graft id', () => {
    // `cmp__a__headline` is what the graft PRODUCES; keying storage on it
    // would break the moment the instance were duplicated or re-keyed.
    const composed = composeReusableComponentNodes(
      { a: instanceWith('a', { cmp__a__headline: { color: '#f00' } }) } as any,
      { cta },
    )
    expect(composed['cmp__a__headline'].sx).toEqual(cta.nodes.headline.sx)
  })

  it('two instances of one component keep disjoint overrides', () => {
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith('a', { headline: { color: '#0B1220' } }),
        b: instanceWith('b', { headline: { color: '#B7BEC8' } }),
        c: {
          $id: 'c',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'cta' },
          nodes: [] as string[],
        },
      } as any,
      { cta },
    )
    expect(composed['cmp__a__headline'].sx).toHaveProperty('color', '#0B1220')
    expect(composed['cmp__b__headline'].sx).toHaveProperty('color', '#B7BEC8')
    // The un-overridden instance keeps the component look, and neither
    // sibling's lede was touched by the other's headline override.
    expect(composed['cmp__c__headline'].sx).toHaveProperty(
      'color',
      'common.white',
    )
    expect(composed['cmp__a__lede'].sx).toHaveProperty('color', 'common.white')
    expect(composed['cmp__b__lede'].sx).toHaveProperty('color', 'common.white')
  })

  it('a leaf slice cascade-merges @scheme dark and responsive slices, like root', () => {
    const themed = {
      rootId: 'root',
      nodes: {
        root: { $id: 'root', componentId: 'muiStack', nodes: ['headline'] },
        headline: {
          $id: 'headline',
          componentId: 'muiTypography',
          parentId: 'root',
          sx: {
            color: 'common.white',
            fontSize: { xs: 24, md: 32, lg: 40 },
            '@scheme dark': { color: '#E6EAF2', letterSpacing: '-0.5px' },
          },
        },
      },
    } as any
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith('a', {
          headline: {
            color: '#0B1220',
            // Partial breakpoint slice: xs below it survives, md and every
            // width ABOVE it take the override — MUI's mobile-first
            // cascade, which is why `lg` goes rather than shadowing it.
            fontSize: { md: 28 },
            // Partial scheme slice: letterSpacing must survive.
            '@scheme dark': { color: '#94A3B8' },
          },
        }),
      } as any,
      { cta: themed },
    )
    expect(composed['cmp__a__headline'].sx).toEqual({
      color: '#0B1220',
      fontSize: { xs: 24, md: 28 },
      '@scheme dark': { color: '#94A3B8', letterSpacing: '-0.5px' },
    })
    // Exactly what the ROOT slice does with the same input — one merge
    // primitive, so a leaf can never grow its own cascade rules.
    expect(composed['cmp__a__headline'].sx).toEqual(
      mergeNodeSx(themed.nodes.headline.sx, {
        color: '#0B1220',
        fontSize: { md: 28 },
        '@scheme dark': { color: '#94A3B8' },
      }),
    )
  })

  it('a stale leaf key is ignored, never thrown on', () => {
    // The component was edited after the override was written: `subhead`
    // no longer exists. The page must render, minus that override.
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith('a', {
          subhead: { color: '#f00' },
          headline: { color: '#0B1220' },
        }),
      } as any,
      { cta },
    )
    expect(Object.keys(composed).sort()).toEqual(
      ['a', 'cmp__a__headline', 'cmp__a__lede', 'cmp__a__root'].sort(),
    )
    expect(composed['cmp__a__headline'].sx).toHaveProperty('color', '#0B1220')
    // Kept on the instance, not silently dropped: re-adding the leaf to the
    // component restores the author's intent.
    expect((composed['a'] as any).styleOverrides.subhead).toEqual({
      color: '#f00',
    })
  })

  it('a leaf id that merely reads `root` is not styled by the root slice', () => {
    // The root is addressed by the CONSTANT, so a definition whose root is
    // called something else cannot have an unrelated leaf hijack it.
    const oddly = {
      rootId: 'shell',
      nodes: {
        shell: { $id: 'shell', componentId: 'muiStack', nodes: ['root'] },
        root: {
          $id: 'root',
          componentId: 'muiTypography',
          parentId: 'shell',
          sx: { color: 'common.white' },
        },
      },
    } as any
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith('a', {
          [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#fff' },
        }),
      } as any,
      { cta: oddly },
    )
    expect(composed['cmp__a__shell'].sx).toEqual({ backgroundColor: '#fff' })
    expect(composed['cmp__a__root'].sx).toEqual({ color: 'common.white' })
  })

  it('leaves every un-overridden node untouched, sx key and all', () => {
    const composed = composeReusableComponentNodes(
      { a: instanceWith('a', { headline: { color: '#0B1220' } }) } as any,
      { cta },
    )
    // Not `sx: undefined` on nodes that never had one — a materialized key
    // would ride into every save of a composed map.
    const bare = composeReusableComponentNodes(
      {
        b: {
          $id: 'b',
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
          props: { refId: 'plain' },
          styleOverrides: { nope: { color: '#f00' } },
          nodes: [] as string[],
        },
      } as any,
      {
        plain: {
          rootId: 'root',
          nodes: { root: { $id: 'root', componentId: 'muiStack', nodes: [] } },
        } as any,
      },
    )
    expect('sx' in (bare['cmp__b__root'] as any)).toBe(false)
    expect(composed['cmp__a__lede'].sx).toBe(cta.nodes.lede.sx)
  })

  it('getInstanceStyleOverrides answers only for instances, dropping junk slices', () => {
    expect(
      getInstanceStyleOverrides(
        instanceWith('a', {
          [STYLE_OVERRIDES_ROOT_KEY]: { py: 2 },
          headline: { color: '#000' },
          cleared: {},
          bogus: 'nope',
          nulled: null,
          listy: [1, 2],
        }) as any,
      ),
    ).toEqual({
      [STYLE_OVERRIDES_ROOT_KEY]: { py: 2 },
      headline: { color: '#000' },
    })
    expect(
      getInstanceStyleOverrides({
        componentId: 'muiStack',
        styleOverrides: { headline: { color: '#000' } },
      } as any),
    ).toEqual({})
    expect(getInstanceStyleOverrides(undefined)).toEqual({})
    expect(
      getInstanceStyleOverrides({
        componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      } as any),
    ).toEqual({})
  })

  it('listInstanceStyleTargets walks the definition in tree order, root first', () => {
    expect(listInstanceStyleTargets(cta)).toEqual([
      {
        key: STYLE_OVERRIDES_ROOT_KEY,
        componentInternalId: 'root',
        depth: 0,
        componentId: 'muiStack',
        name: undefined,
        isRoot: true,
      },
      {
        key: 'headline',
        componentInternalId: 'headline',
        depth: 1,
        componentId: 'muiTypography',
        name: undefined,
        isRoot: false,
      },
      {
        key: 'lede',
        componentInternalId: 'lede',
        depth: 1,
        componentId: 'muiTypography',
        name: undefined,
        isRoot: false,
      },
    ])
    // Every key it offers is a key the graft consults — the panel and the
    // renderer cannot drift about what a target means.
    const composed = composeReusableComponentNodes(
      {
        a: instanceWith(
          'a',
          Object.fromEntries(
            listInstanceStyleTargets(cta).map((entry) => [
              entry.key,
              { outlineColor: entry.key },
            ]),
          ),
        ),
      } as any,
      { cta },
    )
    for (const entry of listInstanceStyleTargets(cta)) {
      expect(composed[`cmp__a__${entry.componentInternalId}`].sx).toHaveProperty(
        'outlineColor',
        entry.key,
      )
    }
  })

  it('listInstanceStyleTargets is safe on cycles, orphans and missing input', () => {
    const looped = {
      rootId: 'root',
      nodes: {
        root: { $id: 'root', componentId: 'muiStack', nodes: ['a'] },
        a: { $id: 'a', componentId: 'muiBox', parentId: 'root', nodes: ['root'] },
        orphan: { $id: 'orphan', componentId: 'muiBox' },
      },
    } as any
    expect(
      listInstanceStyleTargets(looped).map((entry) => entry.key),
    ).toEqual([STYLE_OVERRIDES_ROOT_KEY, 'a'])
    expect(listInstanceStyleTargets(undefined)).toEqual([])
    expect(listInstanceStyleTargets({ rootId: 'gone', nodes: {} } as any)).toEqual(
      [],
    )
  })

  it('survives save → reload → re-graft, and stays per instance', () => {
    // The storage hop the field has to clear: a composed map is what a
    // canvas saves, and the overrides ride the INSTANCE node, not the
    // graft — so re-composing the reloaded map must rebuild the same look.
    const nodes = {
      a: instanceWith('a', {
        [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#fff' },
        headline: { color: '#0B1220' },
      }),
      b: instanceWith('b', { headline: { color: '#B7BEC8' } }),
    } as any
    const first = composeReusableComponentNodes(nodes, { cta })
    const saved = JSON.parse(JSON.stringify(first))
    // A save keeps only the document's own nodes; the graft is regenerated.
    for (const id of Object.keys(saved)) {
      if (id.startsWith('cmp__')) delete saved[id]
    }
    for (const id of ['a', 'b']) saved[id].nodes = []

    const again = composeReusableComponentNodes(saved, { cta })
    expect(again['cmp__a__headline'].sx).toEqual(
      first['cmp__a__headline'].sx,
    )
    expect(again['cmp__a__root'].sx).toEqual(first['cmp__a__root'].sx)
    expect(again['cmp__b__headline'].sx).toHaveProperty('color', '#B7BEC8')
    expect(again['cmp__b__root'].sx).toEqual(cta.nodes.root.sx)
  })
})

describe('instance leaf hit-test (AGL-1304)', () => {
  /** Prop-fed headline + image, a mixed-content caption, a static label. */
  const hero = {
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: 'muiStack', nodes: ['h', 'img', 'cap', 'label'] },
      h: {
        $id: 'h',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.headline}}' },
      },
      img: {
        $id: 'img',
        componentId: 'muiImage',
        parentId: 'root',
        props: { src: '{{prop.image}}', alt: 'Hero' },
      },
      cap: {
        $id: 'cap',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: 'By {{prop.headline}} — read on' },
      },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: 'NEW' },
      },
    },
    props: [
      { name: 'headline', type: 'text', defaultValue: 'Headline goes here' },
      { name: 'image', type: 'image', defaultValue: '/placeholder.png' },
    ],
  } as any

  describe('matchComponentPropToken', () => {
    it('matches exactly one prop token, tolerating brace whitespace', () => {
      expect(matchComponentPropToken('{{prop.headline}}')).toBe('headline')
      expect(matchComponentPropToken('  {{ prop.headline }}  ')).toBe(
        'headline',
      )
    })

    it('rejects partial feeds, other namespaces and non-strings', () => {
      // Mixed content cannot be decomposed back into a prop value.
      expect(matchComponentPropToken('Hi {{prop.headline}}!')).toBeNull()
      expect(
        matchComponentPropToken('{{prop.headline}}{{prop.image}}'),
      ).toBeNull()
      expect(matchComponentPropToken('{{entry.title}}')).toBeNull()
      expect(matchComponentPropToken('{{prop.bad-name}}')).toBeNull()
      expect(matchComponentPropToken(42)).toBeNull()
      expect(matchComponentPropToken(undefined)).toBeNull()
    })
  })

  describe('resolveInstanceLeafBinding', () => {
    it('maps a grafted text leaf to its internal id and the prop feeding it', () => {
      expect(resolveInstanceLeafBinding('cmp__a__h', 'a', hero)).toEqual({
        componentInternalId: 'h',
        boundProp: 'headline',
      })
    })

    it('agrees with the graft about which id names which leaf', () => {
      // The inverse mapping must track the graft's own id scheme — resolve
      // the id the REAL graft produced, not a hand-written lookalike.
      const composed = composeReusableComponentNodes(
        {
          a: {
            $id: 'a',
            componentId: REUSABLE_INSTANCE_COMPONENT_ID,
            props: { refId: 'hero', propValues: { headline: 'Ship faster' } },
            nodes: [],
          },
        } as any,
        { hero },
      )
      const graftedId = Object.keys(composed).find(
        (id) => composed[id].props?.['children'] === 'Ship faster',
      ) as string
      expect(resolveInstanceLeafBinding(graftedId, 'a', hero)).toEqual({
        componentInternalId: 'h',
        boundProp: 'headline',
      })
    })

    it('inspects src for image leaves', () => {
      expect(
        resolveInstanceLeafBinding('cmp__a__img', 'a', hero, 'src'),
      ).toEqual({ componentInternalId: 'img', boundProp: 'image' })
      // The image's TEXT channel is not prop-fed.
      expect(resolveInstanceLeafBinding('cmp__a__img', 'a', hero)).toEqual({
        componentInternalId: 'img',
        boundProp: null,
      })
    })

    it('component-owned leaves resolve with boundProp null', () => {
      // Static text and mixed content both stay locked (AGL-1303's
      // edit-the-component flow, not an inline prop edit).
      expect(resolveInstanceLeafBinding('cmp__a__label', 'a', hero)).toEqual({
        componentInternalId: 'label',
        boundProp: null,
      })
      expect(resolveInstanceLeafBinding('cmp__a__cap', 'a', hero)).toEqual({
        componentInternalId: 'cap',
        boundProp: null,
      })
    })

    it('an undeclared prop token never binds', () => {
      const rogue = {
        rootId: 'root',
        nodes: {
          root: {
            $id: 'root',
            componentId: 'muiTypography',
            props: { children: '{{prop.ghost}}' },
          },
        },
        props: [{ name: 'headline' }],
      } as any
      // The graft would never substitute it, so an override written for it
      // would silently do nothing.
      expect(resolveInstanceLeafBinding('cmp__a__root', 'a', rogue)).toEqual({
        componentInternalId: 'root',
        boundProp: null,
      })
    })

    it('rejects ids grafted from another instance, nested grafts and junk', () => {
      // Another instance's graft.
      expect(resolveInstanceLeafBinding('cmp__b__h', 'a', hero)).toBeNull()
      // A NESTED instance's leaf (prefixes stack per pass): its props are
      // fed by the outer definition, not by this instance.
      expect(
        resolveInstanceLeafBinding('cmp__cmp__a__x__h', 'a', hero),
      ).toBeNull()
      // Not grafted at all / unknown internal id / missing input.
      expect(resolveInstanceLeafBinding('h', 'a', hero)).toBeNull()
      expect(resolveInstanceLeafBinding('cmp__a__nope', 'a', hero)).toBeNull()
      expect(resolveInstanceLeafBinding('cmp__a__', 'a', hero)).toBeNull()
      expect(resolveInstanceLeafBinding('cmp__a__h', 'a', undefined)).toBeNull()
      expect(resolveInstanceLeafBinding(undefined, 'a', hero)).toBeNull()
      expect(resolveInstanceLeafBinding('cmp__a__h', undefined, hero)).toBeNull()
    })
  })

  describe('getInstanceEffectivePropText', () => {
    it('prefers the override, falls back to the declared default', () => {
      expect(
        getInstanceEffectivePropText(
          { refId: 'hero', propValues: { headline: 'Ship faster' } },
          hero.props,
          'headline',
        ),
      ).toBe('Ship faster')
      expect(
        getInstanceEffectivePropText({ refId: 'hero' }, hero.props, 'headline'),
      ).toBe('Headline goes here')
    })

    it('treats an empty override as unset, like the graft does', () => {
      expect(
        getInstanceEffectivePropText(
          { refId: 'hero', propValues: { headline: '' } },
          hero.props,
          'headline',
        ),
      ).toBe('Headline goes here')
    })

    it('is empty for an unknown prop or missing declarations', () => {
      expect(
        getInstanceEffectivePropText({ refId: 'hero' }, hero.props, 'ghost'),
      ).toBe('')
      expect(getInstanceEffectivePropText(undefined, undefined, 'headline')).toBe('')
    })
  })
})

describe('detachInstanceSubtree (AGL-1314)', () => {
  /** A hero shaped like the real one: prop-fed copy, prop-fed media. */
  const hero = {
    rootId: 'root',
    nodes: {
      root: {
        $id: 'root',
        componentId: 'muiStack',
        sx: { backgroundColor: '#101828', py: 8 },
        nodes: ['eyebrow', 'h', 'img'],
      },
      eyebrow: {
        $id: 'eyebrow',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.eyebrow}}' },
      },
      h: {
        $id: 'h',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: '{{prop.headline}}', title: 'About {{prop.headline}}' },
      },
      img: {
        $id: 'img',
        componentId: 'muiImage',
        parentId: 'root',
        props: { src: '{{prop.image}}', alt: 'Hero — {{prop.headline}}' },
      },
    },
    props: [
      { name: 'eyebrow', defaultValue: 'PRESS' },
      { name: 'headline', defaultValue: 'Headline goes here' },
      { name: 'image', type: 'image', defaultValue: '/placeholder.png' },
    ],
  } as any

  /** A page holding one instance under an ordinary section. */
  const page = (propValues?: Record<string, unknown>, extra?: any) =>
    ({
      _root_: { $id: '_root_', componentId: 'div', nodes: ['sec'] },
      sec: {
        $id: 'sec',
        componentId: 'muiBox',
        parentId: '_root_',
        nodes: ['a'],
      },
      a: {
        $id: 'a',
        componentId: REUSABLE_INSTANCE_COMPONENT_ID,
        parentId: 'sec',
        props: { refId: 'hero', ...(propValues && { propValues }) },
        nodes: [] as string[],
        ...extra,
      },
    }) as any

  /** Deterministic fresh ids, so a spec can name what it asserts on. */
  const ids = () => {
    let n = 0
    return () => `new${++n}`
  }

  /** Every string a node map holds, for "no token survived" assertions. */
  const allStrings = (nodes: Record<string, any>) => JSON.stringify(nodes)

  it('bakes the instance\'s resolved prop values into the copy', () => {
    const nodes = page({ eyebrow: 'NEWSROOM', headline: 'Ship faster' })
    const detached = detachInstanceSubtree(nodes, 'a', hero, ids())

    // The bug: the copy used to carry the definition's raw markers.
    expect(allStrings(detached)).not.toContain('{{prop.')
    const byContent = Object.values<any>(detached).map(
      (node) => node?.props?.children,
    )
    expect(byContent).toContain('NEWSROOM')
    expect(byContent).toContain('Ship faster')
    // Partial feeds resolve too, exactly as the renderer does it.
    expect(
      Object.values<any>(detached).some(
        (node) => node?.props?.title === 'About Ship faster',
      ),
    ).toBe(true)
  })

  it('renders what the INSTANCE rendered: leaf-for-leaf parity with the graft', () => {
    const nodes = page({ eyebrow: 'PRESS & BRAND', headline: 'Ship faster' })
    const composed = composeReusableComponentNodes(nodes, { hero })
    const detached = detachInstanceSubtree(nodes, 'a', hero, ids())

    // Same definition leaves, different ids — compare by what they render.
    for (const defId of ['eyebrow', 'h', 'img']) {
      const grafted = composed[`cmp__a__${defId}`] as any
      const copy = Object.values<any>(detached).find(
        (node) =>
          node?.componentId === (hero.nodes as any)[defId].componentId &&
          node?.$id !== 'a' &&
          JSON.stringify(node?.props) === JSON.stringify(grafted.props),
      )
      expect(copy).toBeDefined()
    }
  })

  it('a prop-fed image resolves to the bound media, not a token', () => {
    const detached = detachInstanceSubtree(
      page({ image: '/media/press-kit.png' }),
      'a',
      hero,
      ids(),
    )
    const img = Object.values<any>(detached).find(
      (node) => node?.componentId === 'muiImage',
    )
    expect(img.props.src).toBe('/media/press-kit.png')
    // The alt text is prop-fed too — nothing on the node keeps a marker.
    expect(img.props.alt).toBe('Hero — Headline goes here')
  })

  it('unset props detach to the declared defaults, never to a marker', () => {
    const detached = detachInstanceSubtree(page(), 'a', hero, ids())
    expect(allStrings(detached)).not.toContain('{{prop.')
    const byContent = Object.values<any>(detached).map(
      (node) => node?.props?.children,
    )
    expect(byContent).toContain('PRESS')
    expect(byContent).toContain('Headline goes here')
    expect(
      Object.values<any>(detached).find(
        (node) => node?.componentId === 'muiImage',
      ).props.src,
    ).toBe('/placeholder.png')
  })

  it('keeps the root styleOverride the instance was displaying (AGL-1306)', () => {
    const nodes = page(undefined, {
      styleOverrides: { [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#0b4a6f' } },
    })
    const composed = composeReusableComponentNodes(nodes, { hero })
    const detached = detachInstanceSubtree(nodes, 'a', hero, ids())

    // The copy forks the look the page was showing, leaf-wise merged —
    // and it is the SAME sx the graft was rendering.
    expect(detached['a'].sx).toEqual({ backgroundColor: '#0b4a6f', py: 8 })
    expect(detached['a'].sx).toEqual((composed['cmp__a__root'] as any).sx)
    // The instance's own instance-ness is gone with it.
    expect(detached['a'].componentId).toBe('muiStack')
    expect((detached['a'] as any).styleOverrides).toBeUndefined()
    expect((detached['a'].props as any)?.refId).toBeUndefined()
  })

  it('bakes PER-LEAF overrides too: the copy is what the graft rendered (AGL-1332)', () => {
    // The guard rail on the whole feature: detach forks what the page was
    // showing. A copy that baked only the root would repaint every
    // overridden headline the moment an author detached — the AGL-1318
    // white-on-white symptom, arriving through the escape hatch instead.
    const styled = {
      ...hero,
      nodes: {
        ...hero.nodes,
        h: { ...hero.nodes.h, sx: { color: 'common.white', fontSize: 32 } },
        eyebrow: { ...hero.nodes.eyebrow, sx: { color: 'common.white' } },
      },
    }
    const nodes = page(
      { headline: 'Ship faster' },
      {
        styleOverrides: {
          [STYLE_OVERRIDES_ROOT_KEY]: { backgroundColor: '#fff' },
          h: { color: '#0B1220' },
          eyebrow: { color: '#5A6675', letterSpacing: '1px' },
        },
      },
    )
    const composed = composeReusableComponentNodes(nodes, { hero: styled })
    const detached = detachInstanceSubtree(nodes, 'a', styled, ids())

    // Leaf for leaf, the detached copy renders the grafted instance's sx.
    const byGraftId: Record<string, string> = {
      root: 'a',
      eyebrow: 'new1',
      h: 'new2',
      img: 'new3',
    }
    for (const [defId, copyId] of Object.entries(byGraftId)) {
      expect(detached[copyId].sx).toEqual(
        (composed[`cmp__a__${defId}`] as any).sx,
      )
    }
    expect(detached['new2'].sx).toEqual({ color: '#0B1220', fontSize: 32 })
    expect(detached['new1'].sx).toEqual({
      color: '#5A6675',
      letterSpacing: '1px',
    })
    // And nothing carries the override layer forward — a plain subtree now.
    expect((detached['a'] as any).styleOverrides).toBeUndefined()
  })

  it('a stale leaf key detaches without throwing, exactly as it renders', () => {
    const nodes = page(undefined, {
      styleOverrides: { gone: { color: '#f00' }, h: { color: '#0B1220' } },
    })
    const composed = composeReusableComponentNodes(nodes, { hero })
    const detached = detachInstanceSubtree(nodes, 'a', hero, ids())
    expect(detached['new2'].sx).toEqual((composed['cmp__a__h'] as any).sx)
    expect(detached['new2'].sx).toEqual({ color: '#0B1220' })
  })

  it('mints fresh ids and leaves no cmp__ graft prefix behind', () => {
    const detached = detachInstanceSubtree(
      page({ headline: 'Ship faster' }),
      'a',
      hero,
      ids(),
    )
    // Nothing may carry the graft namespace: those ids collide the next
    // time an instance of this definition expands on the same screen.
    expect(Object.keys(detached).some((id) => id.startsWith('cmp__'))).toBe(false)
    expect(allStrings(detached)).not.toContain('cmp__')
    // The root keeps the instance id, so the parent still points at it.
    expect(detached['sec'].nodes).toEqual(['a'])
    expect(detached['a'].parentId).toBe('sec')
    expect(detached['a'].nodes).toEqual(['new1', 'new2', 'new3'])
    expect(detached['new1'].parentId).toBe('a')
    // Ids the definition used are NOT reused as-is.
    expect(detached['h']).toBeUndefined()
    expect(detached['img']).toBeUndefined()
  })

  it('drops whatever hung under the instance, including a previous graft', () => {
    // Layout chrome arrives pre-grafted (AGL-1218): the instance already
    // has children in the map. They must not survive as orphans.
    const nodes = page({ headline: 'Ship faster' })
    nodes['a'].nodes = ['cmp__a__root']
    nodes['cmp__a__root'] = {
      $id: 'cmp__a__root',
      componentId: 'muiStack',
      parentId: 'a',
      nodes: ['cmp__a__h'],
    }
    nodes['cmp__a__h'] = {
      $id: 'cmp__a__h',
      componentId: 'muiTypography',
      parentId: 'cmp__a__root',
      props: { children: 'Ship faster' },
    }
    const detached = detachInstanceSubtree(nodes, 'a', hero, ids())
    expect(detached['cmp__a__root']).toBeUndefined()
    expect(detached['cmp__a__h']).toBeUndefined()
    expect(detached['a'].nodes).toEqual(['new1', 'new2', 'new3'])
  })

  it('detaching twice is safe: the second is a no-op on a plain subtree', () => {
    const nodes = page({ headline: 'Ship faster' })
    const once = detachInstanceSubtree(nodes, 'a', hero, ids())
    // No instance left to detach — the same map comes back untouched
    // rather than a second copy overwriting the author's edits.
    expect(detachInstanceSubtree(once, 'a', hero, ids())).toBe(once)
  })

  it('two instances of one definition detach into disjoint ids', () => {
    const nodes = page({ headline: 'One' })
    nodes['sec'].nodes = ['a', 'b']
    nodes['b'] = {
      $id: 'b',
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      parentId: 'sec',
      props: { refId: 'hero', propValues: { headline: 'Two' } },
      nodes: [],
    }
    const first = detachInstanceSubtree(nodes, 'a', hero, ids())
    // A fresh id source that would happily hand out the same ids again;
    // the second detach must still not overwrite the first copy.
    const second = detachInstanceSubtree(first, 'b', hero, ids())

    expect(second['a'].nodes).not.toEqual(second['b'].nodes)
    const texts = Object.values<any>(second).map((node) => node?.props?.children)
    expect(texts).toContain('One')
    expect(texts).toContain('Two')
    // Every node still has exactly one home.
    for (const [id, node] of Object.entries<any>(second)) {
      if (!node.parentId) continue
      expect(second[node.parentId].nodes).toContain(id)
    }
  })

  it('an undeclared prop token is left alone, exactly as the graft renders it', () => {
    const withGhost = {
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiTypography',
          props: { children: '{{prop.ghost}} {{var:abc}}' },
        },
      },
      props: [{ name: 'headline', defaultValue: 'Hi' }],
    } as any
    const nodes = page()
    const detached = detachInstanceSubtree(nodes, 'a', withGhost, ids())
    const composed = composeReusableComponentNodes(nodes, { hero: withGhost })
    // Detach bakes what the page SHOWS; an undeclared token substitutes
    // nowhere, and `{{var:*}}` belongs to the resolver downstream.
    expect(detached['a'].props.children).toBe(
      (composed['cmp__a__root'] as any).props.children,
    )
    expect(detached['a'].props.children).toBe('{{prop.ghost}} {{var:abc}}')
  })

  it('no-ops on a non-instance, an unknown id or a rootless definition', () => {
    const nodes = page({ headline: 'Ship faster' })
    expect(detachInstanceSubtree(nodes, 'sec', hero, ids())).toBe(nodes)
    expect(detachInstanceSubtree(nodes, 'nope', hero, ids())).toBe(nodes)
    expect(detachInstanceSubtree(nodes, 'a', undefined, ids())).toBe(nodes)
    expect(
      detachInstanceSubtree(nodes, 'a', { rootId: 'gone', nodes: {} } as any, ids()),
    ).toBe(nodes)
  })

  it('never mutates the page or the definition', () => {
    const nodes = page({ headline: 'Ship faster' })
    const before = JSON.stringify(nodes)
    const definitionBefore = JSON.stringify(hero)
    detachInstanceSubtree(nodes, 'a', hero, ids())
    expect(JSON.stringify(nodes)).toBe(before)
    expect(JSON.stringify(hero)).toBe(definitionBefore)
  })
})
