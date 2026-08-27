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

import { PLUGIN_SETTINGS_FIELD_COMPONENT } from './plugin-settings-field.component'
import { MARKDOWN_ATTRIBUTE_FIELD_COMPONENT } from './markdown-attribute-field.component'
import { TOKEN_TEXT_FIELD_COMPONENT } from './token-text-field.component'
import { SCREEN_LINK_FIELD_COMPONENT } from './screen-link-field.component'
import { act, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as Aglyn from '@aglyn/aglyn'
import {
  ATTRIBUTE_COMMIT_DEBOUNCE_MS,
  buildAnimationFields,
  buildInstancePropFields,
  buildVisibilityFields,
  elementPropsComponentMapper,
  inheritedAltPatch,
  isFormattedText,
  useDebouncedCommit,
  withoutFormatting,
} from './element-props-form.component'

// Regression guard for AGL-567: committing an attribute edit runs
// canvas.updateNodeProps -> saveHistory (a full-tree deep clone) and re-renders
// the observed canvas. Doing that per keystroke crashed the renderer on long
// values (a 30+ char External URL). The commit must be debounced: many
// schedule() calls collapse to ONE commit, while flush()/unmount never drop the
// last edit.
describe('useDebouncedCommit (AGL-567)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('coalesces a burst of schedules into a single commit', () => {
    const commit = jest.fn()
    const { result } = renderHook(() => useDebouncedCommit(commit))

    // Simulate typing "https://example.com" one character at a time.
    act(() => {
      for (let i = 0; i < 19; i += 1) result.current.schedule()
    })
    // Nothing committed while the burst is in flight.
    expect(commit).not.toHaveBeenCalled()

    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
    // The whole burst produced exactly one model commit.
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not commit before the debounce delay elapses', () => {
    const commit = jest.fn()
    const { result } = renderHook(() => useDebouncedCommit(commit))

    act(() => result.current.schedule())
    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS - 1))
    expect(commit).not.toHaveBeenCalled()

    act(() => jest.advanceTimersByTime(1))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('flush() commits a pending edit immediately (blur / node switch)', () => {
    const commit = jest.fn()
    const { result } = renderHook(() => useDebouncedCommit(commit))

    act(() => result.current.schedule())
    act(() => result.current.flush())
    expect(commit).toHaveBeenCalledTimes(1)

    // The pending timer was cancelled by the flush — no double commit later.
    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('flush() is a no-op when nothing is pending', () => {
    const commit = jest.fn()
    const { result } = renderHook(() => useDebouncedCommit(commit))

    act(() => result.current.flush())
    expect(commit).not.toHaveBeenCalled()
  })

  it('flushes a pending edit on unmount so the last keystrokes survive', () => {
    const commit = jest.fn()
    const { result, unmount } = renderHook(() => useDebouncedCommit(commit))

    act(() => result.current.schedule())
    expect(commit).not.toHaveBeenCalled()

    unmount()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('always commits the latest callback, not the one captured first', () => {
    const first = jest.fn()
    const second = jest.fn()
    const { result, rerender } = renderHook(
      ({ commit }) => useDebouncedCommit(commit),
      { initialProps: { commit: first } },
    )

    act(() => result.current.schedule())
    // handleSubmit changes identity between renders — the debounce must use the
    // freshest one when it finally fires.
    rerender({ commit: second })
    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

// Regression guard for AGL-584: the email designer's blocks declare
// COLOR_PICKER attributes, and any editor type missing from the mapper makes
// the form renderer throw — blanking the entire attributes panel. Every
// editor type a plugin schema may declare directly (the entity/screen/node
// selects convert to SELECT before rendering) must stay registered.
describe('elementPropsComponentMapper coverage (AGL-584)', () => {
  it.each([
    Aglyn.FieldComponentType.TEXT_FIELD,
    Aglyn.FieldComponentType.TEXTAREA,
    Aglyn.FieldComponentType.SELECT,
    Aglyn.FieldComponentType.SWITCH,
    Aglyn.FieldComponentType.CHECKBOX,
    Aglyn.FieldComponentType.ICON_PICKER,
    Aglyn.FieldComponentType.COLOR_PICKER,
    Aglyn.FieldComponentType.CSS_DIMENSION,
    Aglyn.FieldComponentType.MARKDOWN,
  ])('registers an editor for %s', (type) => {
    expect(elementPropsComponentMapper[type]).toBeDefined()
  })

  // The list above is hand-maintained, so it only covers types a schema
  // declares DIRECTLY. Two attribute types are rewritten to internal editor
  // keys before render instead, and those keys are the ones that actually
  // reach the mapper — a rewrite pointing at an unregistered key throws and
  // blanks the panel exactly the same way AGL-584 did, while every test above
  // stays green.
  it.each([
    TOKEN_TEXT_FIELD_COMPONENT,
    PLUGIN_SETTINGS_FIELD_COMPONENT,
    MARKDOWN_ATTRIBUTE_FIELD_COMPONENT,
  ])(
    'registers the internal editor %s that an attribute rewrites to',
    (key) => {
      expect(elementPropsComponentMapper[key]).toBeDefined()
    },
  )
})

// A reusable component's declared props become Attributes fields (AGL-1247).
// The contract that matters is that the field NAME addresses the same place
// `composeReusableComponentNodes` reads its overrides from — a field that
// saved somewhere else would look like it worked and change nothing.
describe('buildInstancePropFields (AGL-1247)', () => {
  const declared = [
    { name: 'headline', type: 'text' as const, defaultValue: 'Headline here' },
    { name: 'image', type: 'image' as const, label: 'Hero image' },
    { name: 'body', type: 'richText' as const },
    { name: 'count', type: 'number' as const },
    { name: 'boxed', type: 'boolean' as const },
  ]

  it('names each field for the path the graft reads overrides from', () => {
    const fields = buildInstancePropFields(declared)
    expect(fields.map((field) => field.name)).toEqual([
      'propValues.headline',
      'propValues.image',
      'propValues.body',
      'propValues.count',
      'propValues.boxed',
    ])
    // Not a hardcoded string on either side: the panel and the graft must
    // agree through the same constant, or overrides save into a key the
    // renderer never looks at.
    for (const field of fields) {
      expect(String(field.name).split('.')[0]).toBe(
        Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY,
      )
    }
  })

  it('picks a registered editor for every declared type', () => {
    const fields = buildInstancePropFields(declared)
    // AGL-584: an unregistered editor throws and blanks the whole panel.
    for (const field of fields) {
      expect(String(field.component) in elementPropsComponentMapper).toBe(true)
    }
    expect(fields[0].component).toBe(TOKEN_TEXT_FIELD_COMPONENT)
    expect(fields[2]).toMatchObject({ multiline: true })
    expect(fields[3]).toMatchObject({ type: 'number' })
    expect(fields[4].component).toBe(Aglyn.FieldComponentType.CHECKBOX)
  })

  it('shows the definition default as the placeholder, and labels', () => {
    const fields = buildInstancePropFields(declared)
    // Literally true: leave it empty and the default is what renders.
    expect(fields[0]).toMatchObject({
      placeholder: 'Headline here',
      label: 'headline',
    })
    expect(fields[1].label).toBe('Hero image')
    // No default declared → no misleading "Defaults to" helper text.
    expect(fields[1].description).toBeUndefined()
  })

  it('passes token options through so an override can carry a binding', () => {
    const options = [{ value: '{{var:abc}}', label: 'Brand' }]
    const fields = buildInstancePropFields(declared, options, { a: 1 })
    expect(fields[0]).toMatchObject({
      tokenOptions: options,
      tokenLabelContext: { a: 1 },
    })
  })

  it('skips a name that is not an identifier rather than rendering a dead field', () => {
    // `hero.title` would address a nested level that does not exist, so the
    // value would silently never reach the node.
    const fields = buildInstancePropFields([
      { name: 'hero.title', type: 'text' as const },
      { name: '2cols', type: 'text' as const },
      { name: '', type: 'text' as const },
      { name: 'ok_name', type: 'text' as const },
    ])
    expect(fields.map((field) => field.name)).toEqual(['propValues.ok_name'])
  })

  it('gives a Link prop the screen picker, not a text box (AGL-1335)', () => {
    // The defect: `Link` behaved identically to `Text` at both ends, so an
    // author who reasonably assumed rename-safety got a hardcoded path.
    const fields = buildInstancePropFields([
      { name: 'secondaryLink', type: 'href' as const },
    ])
    expect(fields[0].component).toBe(SCREEN_LINK_FIELD_COMPONENT)
    expect(fields[0].component).not.toBe(TOKEN_TEXT_FIELD_COMPONENT)
    // AGL-584 again: an unregistered editor blanks the whole panel.
    expect(String(fields[0].component) in elementPropsComponentMapper).toBe(
      true,
    )
  })

  it('negative control: an unparameterised definition adds no fields', () => {
    expect(buildInstancePropFields(undefined)).toEqual([])
    expect(buildInstancePropFields([])).toEqual([])
  })
})

// Making part of a component optional (AGL-1314). The contract that matters
// is the same one AGL-1247 has: the field NAME must be the prop key the
// graft evaluates, or the toggle saves somewhere nothing reads.
describe('buildVisibilityFields (AGL-1314)', () => {
  it('names each field for the directive the graft evaluates', () => {
    const fields = buildVisibilityFields()
    expect(fields.map((field) => field.name)).toEqual([
      Aglyn.NODE_HIDE_IF_PROP,
      Aglyn.NODE_HIDE_UNLESS_PROP,
    ])
    // Both polarities, not just one: "hide the mockup" needs the first and
    // "no link, no button" (AGL-1348) needs the second.
    expect(fields).toHaveLength(2)
  })

  it('uses a registered, token-capable editor for both', () => {
    const fields = buildVisibilityFields()
    for (const field of fields) {
      // AGL-584: an unregistered editor throws and blanks the whole panel.
      expect(String(field.component) in elementPropsComponentMapper).toBe(true)
      expect(field.component).toBe(TOKEN_TEXT_FIELD_COMPONENT)
    }
  })

  it('passes token options through, since the value is almost always a prop', () => {
    const options = [{ value: '{{prop.hideMedia}}', label: 'Hide the mockup' }]
    const fields = buildVisibilityFields(options, { a: 1 })
    for (const field of fields) {
      expect(field).toMatchObject({
        tokenOptions: options,
        tokenLabelContext: { a: 1 },
      })
    }
  })

  it('describes both directions rather than leaving the author to guess', () => {
    const [hideIf, hideUnless] = buildVisibilityFields()
    expect(hideIf.label).toBe('Hide when')
    expect(hideUnless.label).toBe('Hide unless')
    // AGL-600 gives every described attribute a tooltip; these fields are
    // appended after that map runs, so they carry their own.
    for (const field of buildVisibilityFields()) {
      expect(field.help).toMatchObject({ title: field.label })
      expect(String(field.description).length).toBeGreaterThan(0)
    }
  })
})

/**
 * AGL-1896. "Browse media" wrote the picked value and nothing else, so the
 * author retyped the asset's alt at every placement — the same logo on eight
 * pages, eight times — and a field retyped per placement ships blank, on the
 * customer's published site.
 *
 * The patch is spread into a props object that `updateNodeProps` REPLACES
 * wholesale, so every assertion about "writes nothing" is made on
 * `Object.keys`. `toEqual({})` treats an `alt: undefined` property as absent
 * and would pass against a patch that silently CLEARS an authored alt.
 */
describe('inheritedAltPatch (AGL-1896)', () => {
  const IMAGE = { propName: 'src', declaresAlt: true }

  it('defaults a blank alt from the picked asset', () => {
    expect(
      inheritedAltPatch({ ...IMAGE, props: {}, assetAlt: 'A blue kettle' }),
    ).toEqual({ alt: 'A blue kettle' })
  })

  /**
   * The commonest authoring path in the product, and the one a stricter
   * "only when the key is absent" rule would have skipped entirely: our own
   * presets ship `alt: ''` (see `card.tsx`), so a preset dropped on the
   * canvas and pointed at a library asset is exactly the case this issue was
   * filed about.
   */
  it('treats a preset\'s empty alt as blank, not as an authored value', () => {
    expect(
      inheritedAltPatch({
        ...IMAGE,
        props: { alt: '', src: 'media:host-1/old' },
        assetAlt: 'A blue kettle',
      }),
    ).toEqual({ alt: 'A blue kettle' })
  })

  it('never overwrites an alt the author wrote for this placement', () => {
    const patch = inheritedAltPatch({
      ...IMAGE,
      props: { alt: 'Our founder holding the first kettle' },
      assetAlt: 'A blue kettle',
    })
    expect(Object.keys(patch)).toEqual([])
  })

  /**
   * `decorative` is AGL-1305's explicit "screen readers should skip this",
   * and `image.tsx` forces `alt=""` over any alt text while it is on.
   * Inheriting here would write a sentence the renderer discards — invisible
   * in the output and misleading in the panel.
   */
  it('respects the Decorative switch', () => {
    const patch = inheritedAltPatch({
      ...IMAGE,
      props: { alt: '', decorative: true },
      assetAlt: 'A blue kettle',
    })
    expect(Object.keys(patch)).toEqual([])
  })

  /**
   * The Browse button is offered on every media-ish attribute. A poster
   * frame's or a background's description is not the ELEMENT's alt text, and
   * no pairing anywhere says otherwise — so only `src` inherits.
   */
  it.each(['poster', 'backgroundImage', 'logoUrl', 'thumbnail'])(
    'does not write an alt when the pick was for %s',
    (propName) => {
      const patch = inheritedAltPatch({
        propName,
        declaresAlt: true,
        props: {},
        assetAlt: 'A blue kettle',
      })
      expect(Object.keys(patch)).toEqual([])
    },
  )

  it('writes nothing onto an element whose schema declares no alt', () => {
    const patch = inheritedAltPatch({
      propName: 'src',
      declaresAlt: false,
      props: {},
      assetAlt: 'A blue kettle',
    })
    expect(Object.keys(patch)).toEqual([])
  })

  /**
   * Never a fabricated default. Nothing in this path has seen the image, and
   * the file name — the tempting non-empty stand-in — is not a description.
   */
  it('writes nothing for an asset nobody has described', () => {
    for (const assetAlt of [undefined, '', '   ']) {
      const patch = inheritedAltPatch({ ...IMAGE, props: {}, assetAlt })
      expect(Object.keys(patch)).toEqual([])
    }
  })

  /**
   * The spread the handler actually performs. An `alt` key that arrives
   * undefined is indistinguishable downstream from an authored empty alt,
   * so the no-op case must leave the existing props byte-identical.
   */
  it('leaves the committed props untouched when it declines', () => {
    const props = { src: 'media:host-1/old', alt: 'Written by hand' }
    const next = {
      ...props,
      src: 'media:host-1/new',
      ...inheritedAltPatch({ ...IMAGE, props, assetAlt: 'A blue kettle' }),
    }
    expect(Object.keys(next).sort()).toEqual(['alt', 'src'])
    expect(next.alt).toBe('Written by hand')
  })
})

/**
 * The plain Screen picker names a target the host has lost (AGL-1893).
 *
 * The `Link`-typed prop picker (`ScreenLinkValuePicker`) has kept and shown
 * an unresolvable value since AGL-1335. The `SCREEN_SELECT` attribute path —
 * which is what `Screen Link`'s "Screen" field and every `tabLink{n}` use —
 * did not: its options are built from the routing map, so a stored id the
 * map has lost matched nothing and the field rendered EMPTY. Which reads as
 * "no link set", while the element goes on behaving as linked.
 *
 * The decision itself is `unresolvedScreenOption`, pinned in
 * `screen-link-context.spec.ts` against every input that matters. What this
 * can only check is that the branch CALLS it — the "written but never read"
 * failure, where a helper is perfect and nothing consults it. The option
 * list is built inside a `useMemo` in an unexported component behind the
 * besigner's context stack, so it is read from the source rather than
 * rendered; that limit is the reason the logic lives in a pure function
 * somewhere it can be exercised for real.
 */
describe('the Screen picker and a target the host has lost (AGL-1893)', () => {
  const source = readFileSync(
    join(__dirname, 'element-props-form.component.tsx'),
    'utf8',
  )
  const screenSelectBranch = source.slice(
    source.indexOf('FieldComponentType.SCREEN_SELECT'),
    source.indexOf('FieldComponentType.PLUGIN_SETTINGS'),
  )

  it('is looking at the right branch', () => {
    // Guard on the guard: if this slice ever comes back empty the checks
    // below would pass on nothing at all.
    expect(screenSelectBranch).toContain("label: 'None (use external URL)'")
    expect(screenSelectBranch.length).toBeGreaterThan(200)
  })

  it('consults the shared rule instead of dropping the value', () => {
    expect(screenSelectBranch).toContain('Aglyn.unresolvedScreenOption')
    // Fed the field's own stored value — a call passing anything else could
    // not tell a dead reference from a healthy one.
    expect(screenSelectBranch).toMatch(/nodeProps\?\.\[field\.name\]/)
  })

  it('re-runs when the node whose value it reads changes', () => {
    // Without `nodeProps` in the memo's dependencies the option would be
    // computed once and then describe whichever node happened to be
    // selected first.
    const deps = source.slice(
      source.indexOf('knownPluginInstallsVersion,', source.indexOf('}, [')),
    )
    const depsList = source.slice(
      source.lastIndexOf('}, [', source.indexOf('knownPluginInstallsVersion,')),
      source.indexOf('])', source.indexOf('knownPluginInstallsVersion,')),
    )
    expect(deps.length).toBeGreaterThan(0)
    expect(depsList).toContain('nodeProps,')
  })
})

/**
 * AGL-2486 — the two fields that disagreed about which one is the content.
 *
 * The renderer draws `props.html` in preference to `children`, while this
 * panel's Text field edits `children`. On a formatted node, typing in that
 * field therefore changed a prop nothing renders: the field appeared to do
 * nothing at all.
 *
 * The resolution: the canvas owns formatted text, the panel shows it
 * read-only and says why, and dropping the formatting is explicit and
 * undoable. The alternative — letting a plain edit silently clear `html` —
 * was rejected because its failure mode is typing one character and losing
 * every link in the paragraph, invisible until the damage is done. Merging
 * plain text back into markup was rejected too: mapping arbitrary text onto
 * a marked-up tree has no correct answer once the edit is structural.
 */
describe('formatted text is owned by the canvas (AGL-2486)', () => {
  const node = (props: Record<string, unknown>, componentId = 'muiTypography') =>
    ({ $id: 'n1', componentId, props, nodes: [] }) as any

  describe('isFormattedText', () => {
    it('is true when the node carries markup the renderer prefers', () => {
      expect(
        isFormattedText(
          node({ children: 'Your entire web presence. ', html: 'a <div>b</div>' }),
        ),
      ).toBe(true)
    })

    it('is false with no html at all', () => {
      expect(isFormattedText(node({ children: 'plain' }))).toBe(false)
    })

    /**
     * `''` and absent are the same document — the renderer gates on
     * `Boolean(html)` — so an empty string must not put the field into a
     * read-only state nothing can explain (d7ba450b5).
     */
    it('is false for an empty html string', () => {
      expect(isFormattedText(node({ children: 'plain', html: '' }))).toBe(false)
    })

    it('is false for a component instance, whose text rides propValues', () => {
      expect(
        isFormattedText(
          node({ html: '<b>x</b>' }, Aglyn.REUSABLE_INSTANCE_COMPONENT_ID),
        ),
      ).toBe(false)
    })

    it('is false with no node', () => {
      expect(isFormattedText(undefined)).toBe(false)
    })
  })

  describe('withoutFormatting', () => {
    it('drops the markup', () => {
      expect(
        withoutFormatting({ children: 'a b', html: 'a <div>b</div>' }),
      ).not.toHaveProperty('html')
    })

    /**
     * `children` is deliberately untouched: it already holds the plain
     * reading of the markup, and since `richTextToPlain` keeps line breaks
     * that reading has the author's breaks in it. The element goes on saying
     * the same thing in the same shape.
     */
    it('keeps the words, and every other prop', () => {
      expect(
        withoutFormatting({
          children: 'Your entire web \npresence. ',
          html: 'Your entire web <div>presence. </div>',
          component: 'span',
          variant: 'h3',
        }),
      ).toEqual({
        children: 'Your entire web \npresence. ',
        component: 'span',
        variant: 'h3',
      })
    })

    it('does not mutate the props it was given', () => {
      const props = { children: 'a', html: '<b>a</b>' }
      withoutFormatting(props)
      expect(props.html).toBe('<b>a</b>')
    })

    it('copes with a node that has no props yet', () => {
      expect(withoutFormatting(undefined)).toEqual({})
    })
  })
})

/**
 * AGL-2486 — the affordances beside the read-only Text field.
 *
 * `isFormattedText` and `withoutFormatting` above prove the DECISION and the
 * transform. They cannot prove that the panel explains either one, and that
 * is the half a user actually meets: a warning-coloured button named
 * "Remove formatting" beside text they cannot type into. Told nothing more,
 * the only way to learn whether the words survive is to press it and find
 * out — on the paragraph, not on a copy.
 *
 * So the tooltip has to lead with what is KEPT. It is asserted here rather
 * than rendered for the reason recorded on the Screen-picker block below:
 * this branch sits in an unexported render tree behind the besigner's
 * context stack. Read from source, with a guard on the guard.
 */
describe('the read-only Text field explains itself (AGL-2486)', () => {
  const source = readFileSync(
    join(__dirname, 'element-props-form.component.tsx'),
    'utf8',
  )
  const formattedBranch = source.slice(
    source.indexOf('{hasFormattedText ? ('),
    source.indexOf('<ElementPropsFormTemplate'),
  )

  it('is looking at the right branch', () => {
    // Without this, every check below would pass on an empty string.
    expect(formattedBranch).toContain("'Remove formatting'")
    expect(formattedBranch.length).toBeGreaterThan(400)
  })

  it('says what survives before the button is pressed, not after', () => {
    // The words and the breaks are the reassurance; a tooltip that only
    // named the losses would read as a warning and stop people using a
    // button that is safe and undoable.
    expect(formattedBranch).toContain('Tooltip')
    expect(formattedBranch).toMatch(/Keeps every word and line break/)
    expect(formattedBranch).toMatch(/One undo brings/)
  })

  it('names the formatting it does remove', () => {
    expect(formattedBranch).toMatch(/bold, .*italic, underline, links and lists/s)
  })

  /**
   * A help link is only help if it lands on the paragraph answering the
   * question the reader has RIGHT NOW. With formatted text that question is
   * "why can I not type in this box", which is its own section — not the
   * general "the two fields edit the same value" opener.
   */
  it('deep-links to the section for the state the author is in', () => {
    expect(formattedBranch).toContain("'#text-field-read-only'")
    expect(formattedBranch).toContain("'#the-text-attribute'")
  })
})

/**
 * The easing formerly labelled "Slight overshoot" is now "Settles into
 * place" (AGL-2486).
 *
 * The curve is deliberately untouched: it is still
 * `cubic-bezier(.34,1.56,.64,1)`, still the only one of the six that leaves
 * the 0–1 range. Only the promise the name makes is different. The docs page
 * says every preset only fades, slides or resizes and that nothing bounces,
 * so a control labeled "overshoot" advertises the one thing the platform says
 * it does not do — an author reading that label picks it expecting a bounce,
 * or avoids it expecting one.
 *
 * THE ID IS THE PART THAT MUST NOT MOVE, and it is why this spec exists at
 * all rather than the rename being a one-word diff. `overshoot` is persisted:
 * it is written into `aglynAnimationEase` on every node that uses it, keyed
 * in `EASE_CURVES`, and published as the `aglyn-anim-ease--overshoot` class.
 * `ANIMATION_EASINGS` says "Persisted; never rename one" for that reason.
 * Renaming the VALUE alongside the label would leave every screen already
 * using it carrying an id nothing maps, and the failure mode is silent — the
 * element still renders, it just stops easing. So the select's option values
 * are asserted to be exactly the shared id list, which is a check the next
 * person renaming a label will trip if they touch the wrong string.
 */
describe('the overshoot easing is labelled by what it does (AGL-2486)', () => {
  const easing = buildAnimationFields().find(
    (field) => field['name'] === Aglyn.NODE_ANIMATION_EASE_PROP,
  ) as { options?: Array<{ value: string; label: string }> } | undefined

  it('is looking at the easing field at all', () => {
    // Without this every assertion below would pass vacuously on `undefined`
    // — the field is found by a shared constant, and a rename of THAT would
    // otherwise turn this whole block green while testing nothing.
    expect(easing).toBeDefined()
    expect(easing?.options?.length).toBe(Aglyn.ANIMATION_EASINGS.length)
  })

  it('offers "Settles into place" and no longer offers "Slight overshoot"', () => {
    const labels = (easing?.options ?? []).map((option) => option.label)
    expect(labels).toContain('Settles into place')
    expect(labels).not.toContain('Slight overshoot')
  })

  it('keeps the STORED id, which is what documents already hold', () => {
    const option = (easing?.options ?? []).find(
      (candidate) => candidate.label === 'Settles into place',
    )
    expect(option?.value).toBe('overshoot')
    // And nothing else in the list drifted from the persisted vocabulary.
    expect((easing?.options ?? []).map((candidate) => candidate.value)).toEqual([
      ...Aglyn.ANIMATION_EASINGS,
    ])
  })

  /**
   * The field's own help text described the curve as "overshoots slightly",
   * which was the sentence carrying the old name's promise. Renaming the
   * option and leaving that behind would have moved the word rather than
   * retired it.
   */
  it('no longer describes the curve as an overshoot in the help text', () => {
    // The PROSE only — deliberately not the whole field. The serialized
    // field still contains the string "overshoot" and always must, because
    // that is the stored option value the test above pins.
    const prose = [
      String((easing as any)?.description ?? ''),
      String((easing as any)?.help?.excerpt ?? ''),
    ].join(' ')
    expect(prose.length).toBeGreaterThan(40)
    expect(prose).not.toMatch(/overshoot/i)
    expect(prose).toMatch(/past its mark/)
  })

  /**
   * Label/docs parity. The docs page covers easing in full and named the old
   * label twice — once in the table, once in the accessibility section that
   * calls it the most emphatic curve on offer. A console that says one thing
   * and a docs page that says another is the failure this catches.
   */
  describe('the docs page uses the same name', () => {
    const page = readFileSync(
      join(
        __dirname,
        '../../../../../../../apps/docs/docs/building-sites/besigner/animations.md',
      ),
      'utf8',
    )

    it('is reading the animations page', () => {
      expect(page).toContain('# Element animations')
      expect(page).toContain('### Easing')
    })

    it('names the easing "Settles into place" everywhere it names it', () => {
      expect(page).toContain('**Settles into place**')
      expect(page).not.toContain('Slight overshoot')
    })

    it('still explains what the curve does, having lost the word for it', () => {
      // The name no longer carries the behaviour, so the prose has to. Both
      // mentions describe the travel-past-and-return, in the table and in
      // the accessibility section.
      expect(page).toMatch(
        /\*\*Settles into place\*\* \| Travels a little past its resting place/,
      )
      expect(page).toMatch(
        /most emphatic thing on offer is the \*\*Settles into place\*\*[\s\S]{0,120}travels a little past its resting place/,
      )
    })
  })
})
