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

import { FieldComponentType } from '@aglyn/aglyn'
import { SX_SCHEME_DARK_KEY } from '@aglyn/aglyn-node-renderer'
import { readSxValue, writeSxValue } from './responsive-sx'
import {
  applyStylePartialToSx,
  buildFlexGridGroup,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  HALF_WIDTH_DESCRIPTION_LIMIT,
  isSchemeScopedStyleField,
  pickStyleValues,
  SCHEME_SCOPED_STYLE_FIELDS,
  styleGroupFieldNames,
} from './style-field-groups'

/**
 * Keys the styles panel owns outside the accordion field groups (the
 * flexbox toggle controls, BoxStyler, and the text-align toggle). Group
 * fields must never collide with them — a collision would let two
 * auto-applying controls fight over one sx key (AGL-587).
 */
const BASE_PANEL_KEYS = [
  'flexDirection',
  'flexWrap',
  'alignItems',
  'alignContent',
  'alignSelf',
  'justifyContent',
  'justifyItems',
  'justifySelf',
  'textAlign',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
]

describe('style field groups (AGL-540/587)', () => {
  const groups = buildStyleFieldGroups(['#123456'])
  const flexGridGroup = buildFlexGridGroup()

  it('gives every consolidated field exactly one home', () => {
    const labels = groups.map((group) => group.label)
    // `Grid & Flex Child` is gone (AGL-2486): its fields live in the one
    // Flexbox & Grid section, which the panel renders itself.
    expect(labels).toEqual([
      'Layout',
      'Colors',
      'Sizing',
      'Typography',
      'Borders & Shadows',
      'Position & Overflow',
    ])
    const names = [
      ...groups.flatMap(styleGroupFieldNames),
      ...styleGroupFieldNames(flexGridGroup),
    ]
    for (const expected of [
      // Layout (ex loose base form, AGL-587).
      'display',
      'float',
      // Colors (ex loose base form, AGL-587).
      'color',
      'backgroundColor',
      // Gradient backgrounds (AGL-1331) — the panel had no way to express
      // one, so `backgroundImage` had no home at all.
      'backgroundImage',
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'fontSize',
      'fontWeight',
      'fontFamily',
      'lineHeight',
      'letterSpacing',
      'textTransform',
      'textDecoration',
      'border',
      'borderColor',
      // Per-side borders (AGL-1199): a divider under a bar or a rule
      // between columns cannot be written with the shorthand alone.
      'borderTop',
      'borderRight',
      'borderBottom',
      'borderLeft',
      'borderRadius',
      'outline',
      'boxShadow',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'zIndex',
      'overflow',
      'opacity',
      'cursor',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gridAutoFlow',
      'gridColumn',
      'gridRow',
      // Per-item flex fields live with the rest of the layout properties
      // (out of the loose base form in AGL-587, out of the second layout
      // accordion in AGL-2486).
      'flexGrow',
      'flexShrink',
      'flexBasis',
      'order',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('holds every typed layout field in one section (AGL-2486)', () => {
    // Container spacing, the tracks it defines, then where this element
    // sits in its own parent — one reading order instead of two accordions
    // four sections apart.
    expect(styleGroupFieldNames(flexGridGroup)).toEqual([
      'gap',
      'rowGap',
      'columnGap',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gridAutoFlow',
      'gridColumn',
      'gridRow',
      'flexGrow',
      'flexShrink',
      'flexBasis',
      'order',
    ])
  })

  it('leads Typography with a whole-text-style pick (Zach 2026-08-25)', () => {
    const typography = groups.find((group) => group.$id === 'typography')
    expect(typography).toBeDefined()
    const names = styleGroupFieldNames(typography!)
    // FIRST, because it is the only field in the group that can be right on
    // its own — the rest set one property each and have to agree to match a
    // theme variant by hand.
    expect(names[0]).toBe('typography')
    const field = typography!.fields.find((f: any) => f.name === 'typography')
    expect((field as any).component).toBe(FieldComponentType.PRESET_CHOICE)
    // It must stay a real menu rather than another free-text box.
    expect(Array.isArray((field as any).choices)).toBe(true)
  })

  /**
   * The gap-shaped hole this closes: three properties MUI resolves against
   * the theme were reachable only by hand-writing sx, and nothing failed —
   * `typography`, `gap` and `fontStyle` were simply absent, and absence is
   * invisible. Enumerating MUI's theme-backed keys turns a missing control
   * into a red test rather than something an author discovers by not
   * finding it.
   */
  it('offers every sx property MUI resolves against the theme', () => {
    const names = new Set([
      ...groups.flatMap(styleGroupFieldNames),
      ...styleGroupFieldNames(flexGridGroup),
    ])
    // Every `themeKey` entry in MUI's defaultSxConfig, minus the ones this
    // panel deliberately does not surface as their own field:
    //   bgcolor            — alias of backgroundColor, rewritten by expandSxAliases
    //   font               — a shorthand no author should be writing
    //   border*Color       — carried by the per-side CSS_BORDER editors
    //   outlineColor       — carried by the outline CSS_BORDER editor
    const themeBacked = [
      'backgroundColor',
      'border',
      'borderBottom',
      'borderColor',
      'borderLeft',
      'borderRight',
      'borderTop',
      'boxShadow',
      'color',
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'gap',
      'outline',
      'typography',
      'zIndex',
    ]
    for (const prop of themeBacked) {
      expect(names).toContain(prop)
    }
  })

  it('keeps field names unique across groups and off panel-owned keys', () => {
    const names = [
      ...groups.flatMap(styleGroupFieldNames),
      ...styleGroupFieldNames(flexGridGroup),
    ]
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(BASE_PANEL_KEYS).not.toContain(name)
    }
  })

  // Number box + unit picker for lengths (AGL-1219). Asserted at the
  // DECLARATION end so a field that quietly reverts to free text — or a
  // theme-multiple field that gets swept into the dimension editor — fails
  // here rather than in a screenshot.
  describe('length editors', () => {
    const componentOf = (name: string) =>
      [
        ...groups.flatMap((group) => group.fields),
        ...flexGridGroup.fields,
      ].find((field) => field.name === name)?.['component']

    it.each([
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'fontSize',
      'letterSpacing',
      'top',
      'right',
      'bottom',
      'left',
      'flexBasis',
    ])('gives %s a number box and a unit picker', (name) => {
      expect(componentOf(name)).toBe(FieldComponentType.CSS_DIMENSION)
    })

    it.each([
      // Unitless by convention; a unit picker would push px onto 1.5.
      'lineHeight',
    ])('keeps %s free text — its bare number is not pixels', (name) => {
      expect(componentOf(name)).toBe(FieldComponentType.TEXT_FIELD)
    })

    it.each([
      // A NUMBER in these means a theme multiple, not pixels: `gap: 2` is
      // 16px (× the spacing unit). A px picker would show "2" and turn the
      // next nudge into 3px — a silent 8× shrink, which is why these are
      // still barred from the dimension editor.
      //
      // They used to be free text for want of anything better. They are
      // pickers on the spacing ladder now (Zach 2026-08-25), which is what
      // the "theme multiple" reading always wanted — the same rungs the box
      // styler offers for margin and padding.
      'gap',
      'rowGap',
      'columnGap',
    ])('puts %s on the spacing ladder, never the px editor', (name) => {
      expect(componentOf(name)).toBe(FieldComponentType.PRESET_CHOICE)
      expect(componentOf(name)).not.toBe(FieldComponentType.CSS_DIMENSION)
    })

    it('actually feeds the spacing ladder into the gap pickers', () => {
      // The component type alone would pass with an empty menu, which is the
      // failure this guards: the group is built by a DIFFERENT function than
      // the rest of the panel, so it has to be handed the scales explicitly.
      const withScales = buildFlexGridGroup({
        themeScales: {
          gap: [{ value: 2, label: 'Small', hint: '16px' }],
        },
      } as any)
      const gap = withScales.fields.find((field) => field.name === 'gap')
      expect((gap as any).choices).toEqual([
        { value: 2, label: 'Small', hint: '16px' },
      ])
    })

    it('tells the sizing keys that a fraction is a percentage', () => {
      // MUI's sizingTransform: width: 0.5 renders 50%, not 0.5px.
      const sizing = groups.find((group) => group.$id === 'sizing')!
      for (const field of sizing.fields) {
        expect(field['numberAs']).toBe('mui-sizing')
      }
      // Everything else is plain CSS, where a number IS pixels.
      const fontSize = groups
        .flatMap((group) => group.fields)
        .find((field) => field.name === 'fontSize')
      expect(fontSize?.['numberAs']).toBeUndefined()
    })
  })

  // Per-field help tips (AGL-600, wired in AGL-1220). Asserted at the
  // DECLARATION end: the panel's accordion copy promises a ? on exactly
  // these fields, and for years there was none anywhere because
  // withStyleFieldHelp was never called.
  describe('help tips', () => {
    const allFields = [
      ...groups.flatMap((group) => group.fields),
      ...flexGridGroup.fields,
    ]
    const helpOf = (name: string) =>
      allFields.find((field) => field.name === name)?.['help'] as
        { title: string; excerpt: string; href: string } | undefined

    it.each(['borderRadius', 'gap', 'rowGap', 'columnGap', 'lineHeight'])(
      'warns on %s that its bare number is not pixels',
      (name) => {
        const help = helpOf(name)
        expect(help).toBeDefined()
        expect(help!.excerpt).toMatch(/not pixels/)
        expect(help!.title).toBeTruthy()
        // Clicking the tip must land on the style-groups docs section.
        expect(help!.href).toContain('#style-groups')
      },
    )

    it('leaves every other field to its inline description', () => {
      // The tip's value is saying what the helper line CANNOT. Tipping
      // all ~40 described fields duplicates the visible text and drops a
      // ? onto each field's top border — deliberately not shipped.
      const tipped = allFields
        .filter((field) => field['help'])
        .map((field) => field.name)
        .sort()
      expect(tipped).toEqual([
        'borderRadius',
        'columnGap',
        'gap',
        'lineHeight',
        'rowGap',
      ])
      // …and every untipped field still explains itself inline.
      for (const field of allFields) {
        if (!field['help']) expect(field['description']).toBeTruthy()
      }
    })
  })

  it('feeds the theme palette into every color picker', () => {
    for (const fieldName of [
      'borderColor',
      'color',
      'backgroundColor',
      // The gradient stops open the same picker, so they get the same
      // swatches (AGL-1331).
      'backgroundImage',
    ]) {
      const field = groups
        .flatMap((group) => group.fields)
        .find((candidate) => candidate.name === fieldName) as any
      expect(field?.presetColors).toEqual(['#123456'])
    }
  })

  /**
   * The authoring hole and the silent-accept bug behind it (AGL-1331).
   *
   * Colors offered *Text Color* and *Background Color* and nothing else, so
   * a gradient could not be built by clicking at all; and typing one into
   * Background Color was accepted, stored as
   * `background-color: linear-gradient(…)`, and dropped by the CSS parser —
   * the band went transparent with no error anywhere.
   */
  describe('background fill (AGL-1331)', () => {
    const colors = groups.find((group) => group.$id === 'colors')!
    const field = (name: string) =>
      colors.fields.find((candidate) => candidate.name === name) as any

    it('gives the Colors group a gradient control that writes backgroundImage', () => {
      const fill = field('backgroundImage')
      expect(fill?.component).toBe(FieldComponentType.CSS_GRADIENT)
      expect(fill?.label).toBe('Background Fill')
      // NOT backgroundColor: MUI declares that key with `themeKey: 'palette'`
      // and it only ever renders a `<color>`.
      expect(styleGroupFieldNames(colors)).toEqual([
        'color',
        'backgroundColor',
        'backgroundImage',
      ])
    })

    it('rejects a gradient typed into a colour field instead of storing it', () => {
      for (const name of ['color', 'backgroundColor', 'borderColor']) {
        const validate = (field(name) ??
          groups
            .flatMap((group) => group.fields)
            .find((candidate) => candidate.name === name)) as any
        const [validator] = validate.validate
        const message = validator(
          'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)',
        )
        expect(message).toContain('not a color')
        // The message has to point at the field that CAN hold one.
        expect(message).toContain('Background Fill')
      }
    })

    it('still accepts every solid value these fields have always taken', () => {
      const [validator] = field('backgroundColor').validate
      for (const value of [
        '',
        '#161C21',
        '#fff',
        'rgb(0, 176, 255)',
        'rgba(0, 0, 0, 0.5)',
        'transparent',
        'currentColor',
        // Palette token paths — what the picker's theme stage stores.
        'primary.main',
        'background.paper',
        'grey.300',
        // And whatever CSS adds next: any function form but an image one.
        'color-mix(in srgb, #fff 50%, #000)',
        'oklch(0.7 0.1 200)',
      ]) {
        expect(validator(value)).toBeUndefined()
      }
    })

    it('scopes the gradient to the previewed scheme like the other colours', () => {
      const sx = applyStylePartialToSx(
        {},
        { backgroundImage: 'linear-gradient(180deg, #000 0%, #fff 100%)' },
        null,
        'dark',
      )
      expect(sx['backgroundImage']).toBeUndefined()
      expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
        backgroundImage: 'linear-gradient(180deg, #000 0%, #fff 100%)',
      })
    })

    it('round-trips through the responsive-sx pipeline like any other field', () => {
      const gradient =
        'linear-gradient(242deg, var(--mui-palette-primary-main, #00B0FF) 0%, ' +
        '#7A5CF0 55%, var(--mui-palette-secondary-main, #E040FB) 100%)'
      const sx = applyStylePartialToSx(
        {},
        { backgroundImage: gradient },
        null,
        null,
      )
      expect(sx['backgroundImage']).toBe(gradient)
      expect(
        computeEffectiveStyleValues(sx, null, null)['backgroundImage'],
      ).toBe(gradient)
      // And unsetting it removes the property rather than pinning ''.
      const cleared = applyStylePartialToSx(
        sx,
        { backgroundImage: '' },
        null,
        null,
      )
      expect(cleared['backgroundImage']).toBeUndefined()
    })

    /**
     * Why Solid had to become a VALUE (AGL-1338).
     *
     * `applyStylePartialToSx` skips a write whose value already matches
     * what the target reads — the guard that stops a form round-trip from
     * pinning inherited readings into a breakpoint slice. On a component
     * instance the target is the override SLICE, which starts empty, so
     * the old Solid encoding (`''` → undefined) matched the empty slice
     * and was skipped: no write, no dirty document, no override. The
     * gradient the component painted therefore could not be taken off any
     * one placement (`/developers-home`).
     */
    describe('solid over an inherited gradient (AGL-1338)', () => {
      it('records Solid as an explicit none, even against an empty slice', () => {
        expect(
          applyStylePartialToSx({}, { backgroundImage: 'none' }, null, null),
        ).toEqual({ backgroundImage: 'none' })
      })

      it('writes nothing for the unset choice — that IS "no override"', () => {
        // The same call with the shipped encoding. Identical to never
        // having touched the field, which is correct for unset and was
        // the bug for Solid.
        expect(
          applyStylePartialToSx({}, { backgroundImage: '' }, null, null),
        ).toEqual({})
      })

      it('reads a stored none straight back out for the control', () => {
        const sx = applyStylePartialToSx(
          { backgroundColor: '#161C21' },
          { backgroundImage: 'none' },
          null,
          null,
        )
        expect(computeEffectiveStyleValues(sx, null, null)).toEqual({
          backgroundColor: '#161C21',
          backgroundImage: 'none',
        })
      })

      it('scopes a Solid override to the dark slice while previewing dark', () => {
        // It is colour-bearing like the gradient it replaces, so the
        // scheme routing applies unchanged — dark can go flat while light
        // keeps the component's gradient.
        const sx = applyStylePartialToSx(
          {},
          { backgroundImage: 'none' },
          null,
          'dark',
        )
        expect(sx['backgroundImage']).toBeUndefined()
        expect(sx[SX_SCHEME_DARK_KEY]).toEqual({ backgroundImage: 'none' })
      })

      it('scopes a Solid override to the active breakpoint', () => {
        const sx = applyStylePartialToSx(
          { backgroundImage: 'linear-gradient(180deg, #000 0%, #fff 100%)' },
          { backgroundImage: 'none' },
          'md',
          null,
        )
        expect(sx['backgroundImage']).toEqual({
          xs: 'linear-gradient(180deg, #000 0%, #fff 100%)',
          md: 'none',
        })
      })

      it('names the unset choice for the panel it is rendered in', () => {
        const fill = (opts?: { isInstanceOverride?: boolean }) =>
          buildStyleFieldGroups(['#123456'], opts)
            .find((group) => group.$id === 'colors')!
            .fields.find(
              (candidate) => candidate.name === 'backgroundImage',
            ) as any
        // On a plain node an unset fill paints nothing; on an instance it
        // paints the COMPONENT's fill, and a control that called that
        // state "Default" (or worse, "Solid color") is what made the
        // field look broken when Solid was picked and nothing happened.
        expect(fill().unsetLabel).toBe('Default')
        expect(fill({ isInstanceOverride: true }).unsetLabel).toBe('Inherited')
        expect(fill({ isInstanceOverride: true }).description).toContain(
          'Inherited keeps the fill the component paints',
        )
      })

      it('warns about the off-site url() egress in BOTH panel variants (AGL-1737)', () => {
        // The "warn" half of AGL-1725's warn-and-disclose: the control's
        // Custom CSS mode holds a raw url(), and the description is where
        // the author learns what that url() does. Same voice as the Custom
        // HTML `css` attribute; hosts are deliberately not blocked, so the
        // wording is the control.
        const fill = (opts?: { isInstanceOverride?: boolean }) =>
          buildStyleFieldGroups(['#123456'], opts)
            .find((group) => group.$id === 'colors')!
            .fields.find(
              (candidate) => candidate.name === 'backgroundImage',
            ) as any
        for (const variant of [fill(), fill({ isInstanceOverride: true })]) {
          expect(variant.description).toContain(
            'makes every visitor’s browser contact that host',
          )
          expect(variant.description).toContain('IP address')
          expect(variant.description).toContain(
            'Insecure http:// URLs are not loaded',
          )
        }
      })
    })
  })

  /**
   * Plain-English controls for the fields that were raw CSS shorthand
   * (AGL-2486, Zach 2026-08-22: *"This is not very friendly for someone who
   * does not know code."*).
   *
   * Asserted at the DECLARATION end, like the length editors above, so a
   * field that quietly reverts to a text box fails here rather than in a
   * screenshot nobody takes.
   */
  describe('friendly controls (AGL-2486)', () => {
    const allFields = [
      ...groups.flatMap((group) => group.fields),
      ...flexGridGroup.fields,
    ]
    const fieldOf = (name: string) =>
      allFields.find((field) => field.name === name)
    const componentOf = (name: string) => fieldOf(name)?.['component']

    it.each([
      'border',
      'borderTop',
      'borderRight',
      'borderBottom',
      'borderLeft',
      'outline',
    ])(
      'gives %s a thickness box and a line-style picker, not shorthand grammar',
      (name) => {
        expect(componentOf(name)).toBe(FieldComponentType.CSS_BORDER)
      },
    )

    it.each(['borderRadius', 'boxShadow', 'fontFamily'])(
      'gives %s named presets with a Custom… escape hatch',
      (name) => {
        expect(componentOf(name)).toBe(FieldComponentType.PRESET_CHOICE)
      },
    )

    it('feeds each preset field the SITE theme’s own answers', () => {
      const themed = buildStyleFieldGroups(['#123456'], {
        themeScales: {
          fontSize: [],
          fontWeight: [],
          zIndex: [],
          spacing: [],
          cornerRadius: [{ value: 2, label: 'Rounded', hint: '8px' }],
          shadow: [{ value: 'none', label: 'No shadow' }],
          fontFamily: [{ value: 'Georgia, serif', label: 'Theme body font' }],
          typographyVariant: [{ value: 'h2', label: 'Heading 2', hint: '2.5rem' }],
          gap: [{ value: 2, label: 'Small', hint: '16px' }],
        },
      })
      const field = (name: string) =>
        themed.flatMap((group) => group.fields).find((f) => f.name === name)
      expect(field('borderRadius')?.['choices']).toEqual([
        { value: 2, label: 'Rounded', hint: '8px' },
      ])
      expect(field('boxShadow')?.['choices']).toEqual([
        { value: 'none', label: 'No shadow' },
      ])
      expect(field('fontFamily')?.['choices']).toEqual([
        { value: 'Georgia, serif', label: 'Theme body font' },
      ])
    })

    it('never leaves a preset field without its Custom… way out', () => {
      // A theme still loading offers no choices at all. The control must
      // still be usable — the escape hatch is unconditional — so the only
      // thing a spec can pin here is that the field does not degrade to
      // something ELSE when the list is empty.
      const bare = buildStyleFieldGroups(['#123456'])
      const names = ['borderRadius', 'boxShadow', 'fontFamily']
      for (const name of names) {
        const field = bare
          .flatMap((group) => group.fields)
          .find((entry) => entry.name === name)
        expect(field?.['component']).toBe(FieldComponentType.PRESET_CHOICE)
        expect(field?.['choices']).toEqual([])
      }
    })

    it('stops telling the author to go type CSS in another section', () => {
      // The old Shadow caption was "Pick a preset here, or type any CSS
      // box-shadow under Classes & custom CSS" — a control advertising its
      // own inadequacy and sending them elsewhere.
      const shadow = fieldOf('boxShadow')
      expect(shadow?.['description']).not.toMatch(/custom CSS/i)
      expect(shadow?.['description']).not.toMatch(/box-shadow/i)
      // …and no field's visible caption asks for shorthand grammar. The
      // CSS spelling still lives in the tooltip and the docs, which is
      // where the escape hatch is explained.
      for (const field of allFields) {
        if (field['help']) continue
        expect(String(field['description'])).not.toMatch(/\b\d+px solid\b/)
      }
    })
  })

  /**
   * ROW RHYTHM (AGL-2486, Zach 2026-08-22: *"Lot's of spacing in here…
   * compared to here."*).
   *
   * Both halves of this are invisible in the source — an orphan depends on
   * a field's NEIGHBOURS, and a wrapped caption depends on a width nobody
   * writes down — so they are checked over the built groups. Without this,
   * the next field added restores exactly the layout Zach rejected and
   * nothing says so.
   */
  describe('row rhythm (AGL-2486)', () => {
    const allGroups = [...groups, flexGridGroup]
    const isHalf = (field: Record<string, unknown>) =>
      Boolean(
        (field['FormFieldGridProps'] as { size?: { sm?: number } })?.size?.sm,
      )

    it.each(allGroups.map((group) => [group.label, group] as const))(
      '%s leaves no half-width field alone in its row',
      (_label, group) => {
        const orphans: string[] = []
        let run: string[] = []
        for (const field of group.fields) {
          if (isHalf(field)) {
            run.push(field.name)
            continue
          }
          if (run.length % 2 === 1) orphans.push(run[run.length - 1])
          run = []
        }
        if (run.length % 2 === 1) orphans.push(run[run.length - 1])
        // Z-Index and Opacity were the two Zach pointed at: each sat alone
        // in the left column with the whole right half of the row empty.
        expect(orphans).toEqual([])
      },
    )

    it('keeps every half-width caption short enough not to wrap three deep', () => {
      const tooLong = allGroups
        .flatMap((group) => group.fields)
        .filter(
          (field) =>
            isHalf(field) &&
            typeof field['description'] === 'string' &&
            (field['description'] as string).length >
              HALF_WIDTH_DESCRIPTION_LIMIT,
        )
        .map(
          (field) => `${field.name} (${String(field['description']).length})`,
        )
      expect(tooLong).toEqual([])
    })
  })

  describe('computeStylePartial', () => {
    const sizing = groups.find((group) => group.$id === 'sizing')!
    const names = styleGroupFieldNames(sizing)

    it('only ever produces keys the group owns', () => {
      const partial = computeStylePartial(names, {
        width: '320px',
        // Keys owned by other panels must not leak into the partial —
        // a group save would otherwise clear them.
        color: '#fff',
        boxShadow: 'none',
      })
      expect(Object.keys(partial).sort()).toEqual([...names].sort())
      expect(partial['width']).toBe('320px')
      expect(partial).not.toHaveProperty('color')
      expect(partial).not.toHaveProperty('boxShadow')
    })

    it('clears fields the user emptied', () => {
      const partial = computeStylePartial(names, { height: undefined })
      expect(partial['height']).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(partial, 'height')).toBe(true)
    })
  })

  describe('pickStyleValues', () => {
    it('selects only defined own values', () => {
      const picked = pickStyleValues(['width', 'height'], {
        width: '50%',
        color: 'red',
      })
      expect(picked).toEqual({ width: '50%' })
    })
  })

  it('round-trips group fields through the responsive-sx pipeline', () => {
    // Representative new keys must respect breakpoint scoping (AGL-333).
    let sx: Record<string, any> = { width: '100%' }
    sx = writeSxValue(sx, 'width', '320px', 'md')
    expect(readSxValue(sx, 'width', null)).toBe('100%')
    expect(readSxValue(sx, 'width', 'md')).toBe('320px')
    expect(readSxValue(sx, 'width', 'xl')).toBe('320px')

    sx = writeSxValue(sx, 'boxShadow', 'none', null)
    expect(readSxValue(sx, 'boxShadow', 'sm')).toBe('none')
  })

  // Styles-panel scheme routing (AGL-588): while the artboard previews
  // dark, only COLOR-BEARING fields write into the sx dark slice —
  // everything else stays a scheme-agnostic base write.
  describe('scheme routing (AGL-588)', () => {
    it('declares exactly the color-bearing panel fields as scheme-scoped', () => {
      expect([...SCHEME_SCOPED_STYLE_FIELDS].sort()).toEqual([
        'backgroundColor',
        // A gradient is colour too (AGL-1331).
        'backgroundImage',
        'borderColor',
        'color',
      ])
      expect(isSchemeScopedStyleField('color')).toBe(true)
      expect(isSchemeScopedStyleField('width')).toBe(false)
    })

    it('routes color fields to the dark slice and others to the base while dark', () => {
      const sx = applyStylePartialToSx(
        { color: '#111' },
        { color: '#eee', backgroundColor: '#000', width: '320px' },
        null,
        'dark',
      )
      expect(sx['color']).toBe('#111')
      expect(sx['width']).toBe('320px')
      expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
        color: '#eee',
        backgroundColor: '#000',
      })
    })

    it('edits the base (and never creates a slice) while previewing light', () => {
      const sx = applyStylePartialToSx(
        {},
        { color: '#111', width: '50%' },
        null,
        null,
      )
      expect(sx).toEqual({ color: '#111', width: '50%' })
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    })

    it('composes scheme with the active breakpoint (scheme outer, breakpoints inner)', () => {
      let sx: Record<string, any> = {}
      sx = applyStylePartialToSx(sx, { color: '#ddd' }, null, 'dark')
      sx = applyStylePartialToSx(sx, { color: '#eee' }, 'md', 'dark')
      expect(sx[SX_SCHEME_DARK_KEY]).toEqual({
        color: { xs: '#ddd', md: '#eee' },
      })
    })

    it('never pins inherited base colors into the slice by round-tripping', () => {
      // The form shows '#111' (base fallback) in dark preview; saving it
      // back unchanged must NOT create a dark override.
      const sx = applyStylePartialToSx(
        { color: '#111' },
        { color: '#111' },
        null,
        'dark',
      )
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
    })

    it('resolves effective values through the slice with base fallback', () => {
      const sx = {
        color: '#111',
        backgroundColor: '#fff',
        width: '320px',
        [SX_SCHEME_DARK_KEY]: { color: '#eee' },
      }
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        color: '#eee',
        backgroundColor: '#fff',
        width: '320px',
      })
      expect(computeEffectiveStyleValues(sx, null, null)).toEqual({
        color: '#111',
        backgroundColor: '#fff',
        width: '320px',
      })
    })

    it('surfaces dark-only overrides that have no base value', () => {
      const sx = { [SX_SCHEME_DARK_KEY]: { backgroundColor: '#000' } }
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        backgroundColor: '#000',
      })
      // Light preview shows no value — nothing renders in light.
      expect(computeEffectiveStyleValues(sx, null, null)).toEqual({})
    })

    it('clearing a dark override falls back to the base color', () => {
      let sx: Record<string, any> = {
        color: '#111',
        [SX_SCHEME_DARK_KEY]: { color: '#eee' },
      }
      sx = applyStylePartialToSx(sx, { color: '' }, null, 'dark')
      expect(SX_SCHEME_DARK_KEY in sx).toBe(false)
      expect(computeEffectiveStyleValues(sx, null, 'dark')).toEqual({
        color: '#111',
      })
    })
  })

  it('round-trips relocated fields through the responsive-sx pipeline', () => {
    // Moved fields (AGL-587) must keep breakpoint scoping intact.
    let sx: Record<string, any> = {}
    sx = writeSxValue(sx, 'display', 'grid', null)
    sx = writeSxValue(sx, 'gap', '24px', 'md')
    sx = writeSxValue(sx, 'flexBasis', '30%', 'lg')
    sx = writeSxValue(sx, 'backgroundColor', '#fff', null)
    expect(readSxValue(sx, 'display', 'xs')).toBe('grid')
    expect(readSxValue(sx, 'gap', null)).toBeUndefined()
    expect(readSxValue(sx, 'gap', 'md')).toBe('24px')
    expect(readSxValue(sx, 'gap', 'xl')).toBe('24px')
    expect(readSxValue(sx, 'flexBasis', 'md')).toBeUndefined()
    expect(readSxValue(sx, 'flexBasis', 'lg')).toBe('30%')
    expect(readSxValue(sx, 'backgroundColor', 'sm')).toBe('#fff')
  })
})

describe('per-side borders (AGL-1199)', () => {
  const SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']

  it('sits in Borders & Shadows beside the shorthand it complements', () => {
    const group = buildStyleFieldGroups([]).find((g) => g.$id === 'borders')
    const names = group!.fields.map((f) => f.name)
    for (const side of SIDES) expect(names).toContain(side)
    // Ordered after the shorthand and its colour, before radius, so the
    // panel reads shorthand → sides → shape.
    expect(names.indexOf('borderTop')).toBeGreaterThan(names.indexOf('border'))
    expect(names.indexOf('borderLeft')).toBeLessThan(
      names.indexOf('borderRadius'),
    )
  })

  it('writes one side without touching the others', () => {
    // The bug this fixes: `border` is the only control, so a bottom
    // divider had to be drawn on all four edges.
    const sx = applyStylePartialToSx(
      undefined,
      { borderBottom: '1px solid' },
      null,
      null,
    )
    expect(sx).toEqual({ borderBottom: '1px solid' })
    expect(sx['border']).toBeUndefined()
  })

  it('is scheme-agnostic — only the colour follows dark mode', () => {
    // borderColor is scheme-scoped; the widths are not, so previewing
    // dark must not fork a divider into the dark slice.
    for (const side of SIDES) expect(isSchemeScopedStyleField(side)).toBe(false)
    expect(isSchemeScopedStyleField('borderColor')).toBe(true)
  })
})

/**
 * The panel's alias seam (AGL-2207).
 *
 * A stored `bgcolor`/`py`/`p` renders — MUI resolves its system-prop
 * aliases — but the panel's fields are named for the CSS longhands, so
 * before this the value reached no control at all: the Background Color
 * field and the Padding box read EMPTY on a node that demonstrably has
 * the value, and clearing the field deleted a key that was never the one
 * painting, so the value came straight back.
 *
 * These drive the same two functions the panel drives — the read seam
 * that feeds every control, and the write seam every control applies
 * through — with the exact sx the stock presets ship.
 */
describe('stored alias spellings reach the panel (AGL-2207)', () => {
  /** The Box preset, verbatim (`libs/plugins/mui/.../box.tsx`, pre-fix). */
  const BOX_PRESET_SX = {
    p: 2,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 1,
  }
  /** The Announcement Bar block, verbatim (`.../blocks.tsx`, pre-fix). */
  const ANNOUNCEMENT_SX = {
    py: 1,
    px: 2,
    alignItems: 'center',
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
  }

  describe('read seam — computeEffectiveStyleValues', () => {
    it("shows a preset's p as the four padding sides BoxStyler reads", () => {
      const values = computeEffectiveStyleValues(BOX_PRESET_SX, null, null)
      expect(values['paddingTop']).toBe(2)
      expect(values['paddingRight']).toBe(2)
      expect(values['paddingBottom']).toBe(2)
      expect(values['paddingLeft']).toBe(2)
      // Untouched keys still read as themselves.
      expect(values['borderColor']).toBe('divider')
    })

    it('shows bgcolor in the Background Color field', () => {
      const values = computeEffectiveStyleValues(ANNOUNCEMENT_SX, null, null)
      expect(values['backgroundColor']).toBe('primary.main')
      expect(values['paddingTop']).toBe(1)
      expect(values['paddingLeft']).toBe(2)
    })

    it('resolves an alias stored per breakpoint', () => {
      const sx = { py: { xs: 2, md: 6 } }
      expect(computeEffectiveStyleValues(sx, 'md', null)['paddingTop']).toBe(6)
      expect(computeEffectiveStyleValues(sx, null, null)['paddingBottom']).toBe(
        2,
      )
    })

    it('resolves an alias stored in the dark scheme slice', () => {
      const sx = {
        backgroundColor: '#fff',
        [SX_SCHEME_DARK_KEY]: { bgcolor: '#101828' },
      }
      expect(
        computeEffectiveStyleValues(sx, null, 'dark')['backgroundColor'],
      ).toBe('#101828')
      expect(
        computeEffectiveStyleValues(sx, null, null)['backgroundColor'],
      ).toBe('#fff')
    })
  })

  describe('write seam — applyStylePartialToSx', () => {
    it('CLEARS a colour the document stored as bgcolor', () => {
      // The half that was impossible: deleting `backgroundColor` left
      // `bgcolor` painting, so no click in the product removed a preset's
      // accent band.
      const next = applyStylePartialToSx(
        ANNOUNCEMENT_SX,
        { backgroundColor: '' },
        null,
        null,
      )
      expect(next['bgcolor']).toBeUndefined()
      expect(next['backgroundColor']).toBeUndefined()
      // Everything the author did not touch survives, alias included.
      expect(next['py']).toBe(1)
      expect(next['color']).toBe('primary.contrastText')
    })

    it('CLEARS one padding side stored under py, keeping the other', () => {
      const next = applyStylePartialToSx(
        ANNOUNCEMENT_SX,
        { paddingTop: '' },
        null,
        null,
      )
      expect(next['py']).toBeUndefined()
      expect(next['paddingTop']).toBeUndefined()
      // The bottom edge `py` also painted is pinned, not lost.
      expect(next['paddingBottom']).toBe(1)
      // `px` was not part of this edit and is left exactly as stored.
      expect(next['px']).toBe(2)
    })

    it('does not rewrite an alias the edit never collides with', () => {
      const next = applyStylePartialToSx(
        ANNOUNCEMENT_SX,
        { color: 'text.primary' },
        null,
        null,
      )
      expect(next['py']).toBe(1)
      expect(next['px']).toBe(2)
      expect(next['bgcolor']).toBe('primary.main')
    })

    it('replaces rather than stacks when a value is set', () => {
      const next = applyStylePartialToSx(
        ANNOUNCEMENT_SX,
        { backgroundColor: '#0b4a6f' },
        null,
        null,
      )
      expect(next['bgcolor']).toBeUndefined()
      expect(next['backgroundColor']).toBe('#0b4a6f')
    })

    it('clears an alias stored in the dark slice while previewing dark', () => {
      const sx = { [SX_SCHEME_DARK_KEY]: { bgcolor: '#101828' } }
      const next = applyStylePartialToSx(
        sx,
        { backgroundColor: '' },
        null,
        'dark',
      )
      expect(next[SX_SCHEME_DARK_KEY]).toBeUndefined()
    })

    it('leaves a multi-side shorthand VALUE alone', () => {
      // `p: '10px 20px'` has no per-side longhand. Refusing it keeps a
      // value that renders rather than writing one CSS drops.
      const next = applyStylePartialToSx(
        { p: '10px 20px' },
        { paddingTop: '4px' },
        null,
        null,
      )
      expect(next['p']).toBe('10px 20px')
      expect(next['paddingTop']).toBe('4px')
    })
  })
})
