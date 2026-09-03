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

import * as Aglyn from '@aglyn/aglyn'
import {
  ATTR_OVERRIDE_REFUSED_WRITE_PROPS,
  getNodeAttrTarget,
  isAttrOverrideValue,
  listInstanceAttrFields,
} from './attr-target'

const instance = (extra: Record<string, unknown> = {}) =>
  ({
    $id: 'inst-1',
    componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
    props: { refId: 'cta' },
    ...extra,
  }) as any

describe('getNodeAttrTarget (AGL-1899)', () => {
  it('refuses to write anything for a plain node', () => {
    // A plain node's attributes are `node.props`, and the Attributes form
    // owns that record through `updateNodeProps`. A second writer here would
    // be two controls fighting over one value.
    const node = { $id: 'a', componentId: 'muiButton', props: { size: 'sm' } } as any
    const target = getNodeAttrTarget(node)
    expect(target.isInstanceOverride).toBe(false)
    expect(target.overrideKey).toBe('')
    expect(target.attrs).toBeUndefined()
    target.setAttrs({ size: 'lg' })
    target.clearAttr('size')
    expect(node.props).toEqual({ size: 'sm' })
    expect(node.attrOverrides).toBeUndefined()
  })

  it('reads and writes the root slice for an instance', () => {
    const node = instance()
    const target = getNodeAttrTarget(node)
    expect(target.isInstanceOverride).toBe(true)
    expect(target.overrideKey).toBe(Aglyn.STYLE_OVERRIDES_ROOT_KEY)
    expect(target.isLeafOverride).toBe(false)
    expect(target.attrs).toBeUndefined()

    target.setAttrs({ variant: 'outlined' })
    expect(node.attrOverrides).toEqual({
      [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { variant: 'outlined' },
    })
    // The instance's OWN props (its wrapper, which carries `refId`) are
    // untouched — the override layer targets the component's nodes.
    expect(node.props).toEqual({ refId: 'cta' })
    // The getter reads live state, not a snapshot from build time.
    expect(target.attrs).toEqual({ variant: 'outlined' })
  })

  it('writes a LEAF slice keyed by the definition-internal node id', () => {
    const node = instance()
    const target = getNodeAttrTarget(node, 'headline')
    expect(target.isLeafOverride).toBe(true)
    expect(target.overrideKey).toBe('headline')
    target.setAttrs({ variant: 'h3' })
    expect(node.attrOverrides).toEqual({ headline: { variant: 'h3' } })
    // The root slice is a DIFFERENT target and stays empty.
    expect(getNodeAttrTarget(node).attrs).toBeUndefined()
  })

  it('a falsy override key still edits the root, never an undefined-keyed slice', () => {
    const node = instance()
    getNodeAttrTarget(node, '').setAttrs({ variant: 'text' })
    expect(Object.keys(node.attrOverrides)).toEqual([
      Aglyn.STYLE_OVERRIDES_ROOT_KEY,
    ])
  })

  it('an override applies to ITS instance and not to a sibling instance', () => {
    // The two instances place the same component. Overrides live on the
    // placing node, so one cannot reach the other.
    const a = instance({ $id: 'inst-a' })
    const b = instance({ $id: 'inst-b' })
    getNodeAttrTarget(a, 'cta').setAttrs({ variant: 'outlined' })
    expect(a.attrOverrides).toEqual({ cta: { variant: 'outlined' } })
    expect(b.attrOverrides).toBeUndefined()
    expect(getNodeAttrTarget(b, 'cta').attrs).toBeUndefined()
  })

  it('clearing the last prop removes the slice, and the last slice removes the field', () => {
    const node = instance({ attrOverrides: { cta: { variant: 'outlined' } } })
    getNodeAttrTarget(node, 'cta').clearAttr('variant')
    expect(node.attrOverrides).toBeUndefined()

    const viaSet = instance({ attrOverrides: { cta: { variant: 'outlined' } } })
    getNodeAttrTarget(viaSet, 'cta').setAttrs({})
    expect(viaSet.attrOverrides).toBeUndefined()

    const viaUndefined = instance({
      attrOverrides: { cta: { variant: 'outlined' } },
    })
    getNodeAttrTarget(viaUndefined, 'cta').setAttrs(undefined)
    expect(viaUndefined.attrOverrides).toBeUndefined()
  })

  it('preserves SIBLING slices when one target is cleared', () => {
    // The bug this guards: an author clearing the headline override loses the
    // button override they set five minutes ago, on the same instance.
    const node = instance({
      attrOverrides: {
        [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { elevation: 0 },
        headline: { variant: 'h3' },
        cta: { variant: 'outlined', size: 'large' },
      },
    })
    getNodeAttrTarget(node, 'headline').setAttrs({})
    expect(node.attrOverrides).toEqual({
      [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { elevation: 0 },
      cta: { variant: 'outlined', size: 'large' },
    })
    // And clearing ONE prop of a multi-prop slice keeps the rest of it.
    getNodeAttrTarget(node, 'cta').clearAttr('size')
    expect(node.attrOverrides).toEqual({
      [Aglyn.STYLE_OVERRIDES_ROOT_KEY]: { elevation: 0 },
      cta: { variant: 'outlined' },
    })
  })

  it('clearing a prop that is not overridden changes nothing', () => {
    const node = instance({ attrOverrides: { cta: { variant: 'outlined' } } })
    const before = node.attrOverrides
    getNodeAttrTarget(node, 'cta').clearAttr('size')
    expect(node.attrOverrides).toBe(before)
    getNodeAttrTarget(node, 'nothing-here').clearAttr('size')
    expect(node.attrOverrides).toEqual({ cta: { variant: 'outlined' } })
  })

  it('never stores an undefined value — a cleared prop is a DELETED key', () => {
    // `stripUndefinedDeep` in `CanvasManager.toJSON` drops an
    // undefined-valued key on the way to storage, while the graft spreads a
    // slice over the definition's props — so a stored `{ variant: undefined }`
    // would blank `variant` on the canvas and inherit it after a reload.
    const node = instance({ attrOverrides: { cta: { variant: 'outlined' } } })
    getNodeAttrTarget(node, 'cta').setAttrs({ variant: undefined, size: 'large' })
    expect(node.attrOverrides).toEqual({ cta: { size: 'large' } })
    expect('variant' in node.attrOverrides.cta).toBe(false)
  })

  it('keeps `false` and `0` as real overrides, and drops `undefined`/`""`', () => {
    // strictNullChecks is OFF repo-wide: this is the distinction that folds
    // if anything tests an override value for truthiness. An instance turning
    // a component's switch OFF, or setting an elevation of 0, has chosen.
    expect(isAttrOverrideValue(false)).toBe(true)
    expect(isAttrOverrideValue(0)).toBe(true)
    expect(isAttrOverrideValue(undefined)).toBe(false)
    expect(isAttrOverrideValue('')).toBe(false)

    const node = instance()
    getNodeAttrTarget(node, 'cta').setAttrs({
      disableGutters: false,
      elevation: 0,
      href: '',
      title: undefined,
    })
    expect(node.attrOverrides).toEqual({
      cta: { disableGutters: false, elevation: 0 },
    })
  })

  it('refuses to write sx, children or html', () => {
    // `sx` has its own override layer one field up and is refused by the
    // graft too. `children`/`html` are CONTENT: a component's text rides its
    // declared props and AGL-1304's canvas editor, and this panel does not
    // become a third writer on it.
    expect([...ATTR_OVERRIDE_REFUSED_WRITE_PROPS].sort()).toEqual([
      'children',
      'html',
      'sx',
    ])
    const node = instance()
    getNodeAttrTarget(node, 'cta').setAttrs({
      sx: { color: 'red' },
      children: 'Hijacked',
      html: '<b>no</b>',
      variant: 'text',
    })
    expect(node.attrOverrides).toEqual({ cta: { variant: 'text' } })
  })

  it('a refused-only write clears rather than storing an empty slice', () => {
    const node = instance({ attrOverrides: { cta: { variant: 'text' } } })
    getNodeAttrTarget(node, 'cta').setAttrs({ children: 'Hijacked' })
    expect(node.attrOverrides).toBeUndefined()
  })
})

describe('listInstanceAttrFields (AGL-1899)', () => {
  // Registered into the REAL component registry rather than stubbed: the
  // thing under test is which of a component's declared attributes reach the
  // override panel, and a double that answered `getSchema` directly would
  // pass just as happily if the lookup key were wrong.
  const COMPONENT_ID = 'specAttrOverrideButton'
  const schemaFor = (attributes: unknown[]) => {
    ;(Aglyn.components.schemas as Record<string, any>)[COMPONENT_ID] = {
      $id: COMPONENT_ID,
      attributes,
    }
  }

  afterEach(() => {
    delete (Aglyn.components.schemas as Record<string, any>)[COMPONENT_ID]
  })

  it('offers only editors that resolve from the schema alone', () => {
    schemaFor([
      { name: 'variant', component: Aglyn.FieldComponentType.SELECT },
      { name: 'href', component: Aglyn.FieldComponentType.TEXT_FIELD },
      { name: 'disabled', component: Aglyn.FieldComponentType.SWITCH },
      { name: 'tint', component: Aglyn.FieldComponentType.COLOR_PICKER },
      { name: 'width', component: Aglyn.FieldComponentType.CSS_DIMENSION },
      // Refused: writes a second prop beside itself (AGL-1212).
      { name: 'icon', component: Aglyn.FieldComponentType.ICON_PICKER },
      // Refused: options come from editor context the graft never sees.
      { name: 'screen', component: Aglyn.FieldComponentType.NODE_SELECT },
      // Refused: content.
      { name: 'children', component: Aglyn.FieldComponentType.TEXT_FIELD },
      // Refused: final-form would read the dot as a nested path.
      { name: 'slotProps.root', component: Aglyn.FieldComponentType.TEXT_FIELD },
    ])
    expect(
      listInstanceAttrFields({ componentId: COMPONENT_ID }).map((f) => f.name),
    ).toEqual(['variant', 'href', 'disabled', 'tint', 'width'])
  })

  it("shows the definition's own value as the placeholder", () => {
    schemaFor([
      { name: 'variant', component: Aglyn.FieldComponentType.SELECT },
      { name: 'elevation', component: Aglyn.FieldComponentType.TEXT_FIELD },
      { name: 'flag', component: Aglyn.FieldComponentType.SWITCH },
    ])
    const fields = listInstanceAttrFields({
      componentId: COMPONENT_ID,
      props: { variant: 'contained', elevation: 3, flag: true },
    })
    expect(fields.map((f) => f.field['placeholder'])).toEqual([
      'contained',
      '3',
      undefined,
    ])
  })

  it('never marks an override field required', () => {
    // Leaving an override empty is the supported state; a `required` copied
    // from the component's schema would make the panel invalid on open.
    schemaFor([
      {
        name: 'href',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        isRequired: true,
        validate: [{ type: 'required' }],
      },
    ])
    const [field] = listInstanceAttrFields({ componentId: COMPONENT_ID })
    expect(field.field['isRequired']).toBe(false)
    expect(field.field['validate']).toBeUndefined()
  })

  it('answers empty for a node with no component id or no schema', () => {
    expect(listInstanceAttrFields(undefined)).toEqual([])
    expect(listInstanceAttrFields({})).toEqual([])
    // An id nothing registered — a definition node placed by a plugin that is
    // no longer installed reaches this exact state.
    expect(listInstanceAttrFields({ componentId: 'never-registered' })).toEqual(
      [],
    )
    schemaFor([])
    expect(listInstanceAttrFields({ componentId: COMPONENT_ID })).toEqual([])
  })
})

/**
 * The seam this issue is defined by: AGL-1899 owns the WRITE side, AGL-1898
 * owns the read/propagation side, and they meet at
 * `composeReusableComponentNodes` from opposite directions. These run the
 * real writer into the real graft, because everything that can go wrong here
 * goes wrong BETWEEN them — a slice written under a key the graft addresses
 * differently is green on both sides and broken on the canvas.
 */
describe('an attribute override, written and then grafted (AGL-1899)', () => {
  const CTA = 'specOverrideCta'
  const STACK = 'specOverrideStack'

  const definition = (ctaProps: Record<string, unknown>) => ({
    rootId: 'root',
    nodes: {
      root: { $id: 'root', componentId: STACK, nodes: ['cta'] },
      cta: {
        $id: 'cta',
        parentId: 'root',
        componentId: CTA,
        props: ctaProps,
      },
    },
  })

  /** The component as first authored. */
  const v1 = () => definition({ variant: 'contained', size: 'medium' })
  /** The same component after its author edits it: a new default AND a new prop. */
  const v2 = () =>
    definition({ variant: 'text', size: 'large', color: 'secondary' })

  const placements = () => ({
    a: {
      $id: 'a',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'widget' },
    },
    b: {
      $id: 'b',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'widget' },
    },
  })

  const graftedCta = (nodes: Record<string, any>, instanceId: string) =>
    nodes[`cmp__${instanceId}__cta`]?.props

  it('applies to ITS instance and not to a sibling placement', () => {
    const nodes = placements() as any
    getNodeAttrTarget(nodes.a, 'cta').setAttrs({ variant: 'outlined' })

    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: v1(),
    } as any)
    expect(graftedCta(composed, 'a')).toEqual({
      variant: 'outlined',
      size: 'medium',
    })
    // The sibling renders the component, untouched. This is the assertion
    // that fails if the override is ever keyed by anything derived from the
    // DEFINITION rather than held on the placing node.
    expect(graftedCta(composed, 'b')).toEqual({
      variant: 'contained',
      size: 'medium',
    })
  })

  it('clearing the override returns that instance to the definition', () => {
    const nodes = placements() as any
    const target = getNodeAttrTarget(nodes.a, 'cta')
    target.setAttrs({ variant: 'outlined' })
    target.clearAttr('variant')

    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: v1(),
    } as any)
    expect(graftedCta(composed, 'a')).toEqual({
      variant: 'contained',
      size: 'medium',
    })
    // Cleared means CLEAN, not "overridden with the same value": the node
    // carries no override field at all, so nothing shows in the panel and
    // nothing is written to the document.
    expect(nodes.a.attrOverrides).toBeUndefined()
  })

  it('a definition change still reaches an instance with NO override', () => {
    const nodes = placements() as any
    getNodeAttrTarget(nodes.a, 'cta').setAttrs({ variant: 'outlined' })

    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: v2(),
    } as any)
    expect(graftedCta(composed, 'b')).toEqual({
      variant: 'text',
      size: 'large',
      color: 'secondary',
    })
  })

  it('a definition change does NOT clobber an instance that HAS one', () => {
    const nodes = placements() as any
    getNodeAttrTarget(nodes.a, 'cta').setAttrs({ variant: 'outlined' })

    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: v2(),
    } as any)
    // The overridden prop holds…
    expect(graftedCta(composed, 'a')?.variant).toBe('outlined')
    // …and every prop it does NOT name takes the component's new value,
    // including one the component did not have when the override was
    // written. An override that replaced the whole props record would give
    // this instance `{ variant: 'outlined' }` and nothing else.
    expect(graftedCta(composed, 'a')).toEqual({
      variant: 'outlined',
      size: 'large',
      color: 'secondary',
    })
  })

  it('a root-slice override lands on the component ROOT, not on its leaves', () => {
    const nodes = placements() as any
    getNodeAttrTarget(nodes.a).setAttrs({ spacing: 4 })

    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: v1(),
    } as any)
    // The root took the placement's id (AGL-2521).
    expect(composed['a']?.props).toEqual({ spacing: 4 })
    expect(graftedCta(composed, 'a')).toEqual({
      variant: 'contained',
      size: 'medium',
    })
  })

  it('an override on a leaf the component no longer has is simply ignored', () => {
    const nodes = placements() as any
    getNodeAttrTarget(nodes.a, 'cta').setAttrs({ variant: 'outlined' })
    // The component author deletes that button after the override was
    // written. The page must degrade to the component, not throw.
    const trimmed = {
      rootId: 'root',
      nodes: { root: { $id: 'root', componentId: STACK, nodes: [] } },
    }
    const composed = Aglyn.composeReusableComponentNodes(nodes, {
      widget: trimmed,
    } as any)
    expect(composed['cmp__a__cta']).toBeUndefined()
    expect(composed['a']).toBeDefined()
  })
})
