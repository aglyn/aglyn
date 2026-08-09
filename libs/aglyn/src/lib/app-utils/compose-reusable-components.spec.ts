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
  getInstanceEffectivePropText,
  getInstanceRootStyleOverride,
  matchComponentPropToken,
  nodesReferenceComponent,
  replaceSubtreeWithInstance,
  resolveInstanceIconPath,
  resolveInstanceLeafBinding,
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from './compose-reusable-components'

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
