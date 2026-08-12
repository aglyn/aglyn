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

import { render } from '@testing-library/react'
import { dropClearedProps } from './utils/drop-cleared-props'
import { MUI_BUNDLE } from './plugin'

/**
 * The structural half of AGL-1451.
 *
 * An option whose `value` is `''` satisfies NEITHER branch of the code that
 * consumes it: it is not `undefined`, so a destructuring default (MUI's own,
 * or ours) never fires; and it is falsy, so any explicit branch is skipped.
 * It also cannot survive a save — the attributes form strips `''` on change
 * (AGL-1191) — so the option is a choice that silently reverts. When such a
 * value DOES land (paste, import, or the field's ✕, which persists `null` —
 * AGL-1226) the result ranges from a dead control to a full-bleed section
 * (AGL-1435) to a 500 on a public page (AGL-1226).
 *
 * `dropClearedProps` is the boundary that resolves it: `''`/`null` are
 * stripped so the consumer sees `undefined` and its own default applies.
 *
 * This shape has now been found BY HAND three times — AGL-1191, AGL-1226,
 * AGL-1435 — and each hand sweep undercounted. So the rule is asserted over
 * the REGISTERED BUNDLE, the same corpus `cleared-props-bundle.spec.tsx`
 * uses, rather than over a list someone remembered to keep up to date:
 *
 *   a component that offers a `''` option value MUST drop cleared props.
 *
 * ## Why a corpus spec rather than an ESLint rule
 *
 * `tools/lint-rules/` would see one file at a time, and neither half of the
 * invariant is a per-file fact:
 *
 *  - The options are COMPOSED. `FIELD_COLOR`, `FIELD_SIZE` and
 *    `FIELD_POSITION` in `constants/field-presets.ts` each carry a `''`
 *    option and are spread into `button.tsx`, `screen-link.tsx` and
 *    `pagination.tsx`. A rule reading `button.tsx` sees `...FIELD_COLOR` and
 *    nothing else — the next component to import one of those constants
 *    without a guard is a false negative by construction. The registered
 *    schema has the options already resolved.
 *  - The wrapper is per EXPORT, not per file. `markdown.tsx` exports two
 *    registered components; a wrapper on one of them satisfies any grep for
 *    `dropClearedProps` in that file while the other stays exposed.
 *
 * The guard is detected by BEHAVIOUR rather than by a marker or a source
 * grep, so it cannot be satisfied by importing the helper and not using it:
 * a prop set to `''` is passed in, and the component is asked whether it
 * reached the other side. The probe carries its own positive control, and
 * the detector itself is unit-tested below against a known-guarded and a
 * known-unguarded component so this file cannot quietly stop detecting
 * anything.
 */

/** A prop no component reads, but every one of them spreads to the DOM. */
const PROBE = 'data-cleared-probe'

type GuardVerdict = 'drops' | 'passes-through' | 'inconclusive'

const renderWithProbe = (Component: any, value: string): boolean | null => {
  try {
    const { baseElement, unmount } = render(
      <Component {...{ [PROBE]: value }}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Component>,
    )
    // `baseElement`, not `container`: Drawer and friends render through a
    // portal onto document.body, and a container-scoped query would read
    // them as "prop never arrived" — i.e. as guarded — which is the one
    // wrong answer this detector must not give.
    const arrived = !!baseElement.querySelector(`[${PROBE}]`)
    unmount()
    return arrived
  } catch {
    return null
  }
}

/**
 * Does this component drop a cleared prop before spreading?
 *
 * The `'x'` render is the positive control. Without it a component that
 * simply never spreads unknown props to the DOM would look guarded, and the
 * check would pass by failing to observe anything at all.
 */
export const detectClearedPropsGuard = (Component: any): GuardVerdict => {
  const withValue = renderWithProbe(Component, 'x')
  if (withValue !== true) return 'inconclusive'
  const withCleared = renderWithProbe(Component, '')
  if (withCleared === null) return 'inconclusive'
  return withCleared ? 'passes-through' : 'drops'
}

const clearedOptions = (attribute: any): boolean =>
  Array.isArray(attribute?.options) &&
  attribute.options.some(
    (option: any) =>
      option?.value === '' || option?.value === null || option?.value === undefined,
  )

describe('the detector itself (AGL-1451)', () => {
  const Raw = (props: any) => <div {...props} />
  const Guarded = (props: any) => <div {...dropClearedProps(props)} />
  const Deaf = () => <div />

  it('reports a component that spreads `""` through', () => {
    expect(detectClearedPropsGuard(Raw)).toBe('passes-through')
  })

  it('reports a component that drops it', () => {
    expect(detectClearedPropsGuard(Guarded)).toBe('drops')
  })

  it('refuses to call a component that spreads NOTHING guarded', () => {
    // The failure mode that would make this whole file a no-op.
    expect(detectClearedPropsGuard(Deaf)).toBe('inconclusive')
  })
})

/**
 * The stronger invariant — AGL-1453.
 *
 * AGL-1451's rule above asks only that a `''` option be GUARDED. That closes
 * the render half of the defect and nothing else: the guard strips the value
 * so MUI's own default fires, but the pick still cannot be SAVED, because the
 * attributes form maps an emptied field to its cleared value and final-form's
 * default parse turns `''` into `undefined` before the write (AGL-1191). So a
 * guarded `''` option is a control that silently reverts — invisible when it
 * is labelled "Default" and reverting renders the same thing, and a one-way
 * door when it is not: every Screen Link switched to "Text link" (213 of them
 * in the corpus) had no route in the dropdown back to "Button".
 *
 * An option value must therefore be PERSISTABLE. `''` never is.
 *
 * Two shapes resolve it, and which one is right is a per-prop question that
 * this check deliberately does not answer:
 *
 *  - DELETE, when the option list already names MUI's own default (`primary`,
 *    `medium`, `fixed`, `text`, `body1`, `inherit`, `column`, `flex-start`),
 *    so "Default" was a second name for a choice already on the list. Real
 *    "unset" stays expressible through the field's ✕, and that matters: a
 *    host theme may set `components.MuiButton.defaultProps.color`, which
 *    `useDefaultProps` applies to `undefined` ONLY. A sentinel would pin the
 *    value and bypass the host's own default — the opposite of what the
 *    author asked for by choosing "Default".
 *  - A REAL SENTINEL, when the list does NOT name the default, so `''` was
 *    the only route back to it (Pagination's four) or spells a genuine choice
 *    rather than "unset" (`renderAs`'s "Button").
 *
 * Note what this does to the AGL-1451 loop below: once no component offers a
 * `''` option, that loop has nothing to iterate and is vacuous BY DESIGN.
 * That is the goal, not a gap — this check is what keeps it vacuous, and the
 * moment someone reintroduces a `''` option it reds here first. If they also
 * drop the guard, AGL-1451 reds alongside it. The detector itself stays
 * exercised by the unit tests above regardless.
 */
describe('every option value is persistable (AGL-1453)', () => {
  /**
   * A bundle that failed to load, or a schema shape that drifted, would make
   * every assertion here pass by having nothing to look at. Measured over the
   * bundle so the number tracks reality rather than a hand-written list.
   */
  const optionBearing = MUI_BUNDLE.flatMap((entry) =>
    (((entry.schema as any)?.attributes ?? []) as any[]).filter((attribute) =>
      Array.isArray(attribute?.options),
    ),
  )

  it('is measured over a bundle that actually carries option lists', () => {
    expect(MUI_BUNDLE.length).toBeGreaterThan(20)
    expect(optionBearing.length).toBeGreaterThan(20)
  })

  it('no option value is `""` — an option that cannot survive a save', () => {
    const violations: string[] = []

    for (const entry of MUI_BUNDLE) {
      const id = entry.schema?.$id ?? '(no id)'
      const attributes: any[] = (entry.schema as any)?.attributes ?? []
      for (const attribute of attributes) {
        if (!Array.isArray(attribute?.options)) continue
        const unpersistable = attribute.options
          .filter((option: any) => option?.value === '' || option?.value == null)
          .map((option: any) => JSON.stringify(option?.label ?? option))
        if (unpersistable.length)
          violations.push(
            `${id} [${attribute.name}] offers ${unpersistable.join(', ')} ` +
              'with an unpersistable value',
          )
      }
    }

    expect(violations).toEqual([])
  })

  /**
   * The other end of the same pipe. Closing the option lists is not enough if
   * our own PRESETS keep minting the value — `card.tsx` shipped a Screen Link
   * with `renderAs: ''`, so every card dropped on a canvas planted a value
   * that matched no option and could not be saved. A preset is the one
   * authoring path that writes props without anyone picking them.
   *
   * Scoped to props the target component gives an option list for. An empty
   * string is a perfectly good value elsewhere — `card.tsx` also ships
   * `alt: ''`, which is the correct, deliberate markup for a decorative
   * image, and a blanket rule would have to be weakened until it caught
   * nothing.
   */
  it('no shipped preset plants a value that no option offers', () => {
    const optionsFor = new Map<string, Map<string, Set<unknown>>>()
    for (const entry of MUI_BUNDLE) {
      const byProp = new Map<string, Set<unknown>>()
      for (const attribute of ((entry.schema as any)?.attributes ??
        []) as any[]) {
        if (!Array.isArray(attribute?.options)) continue
        byProp.set(
          attribute.name,
          new Set(attribute.options.map((option: any) => option?.value)),
        )
      }
      if (byProp.size) optionsFor.set(entry.schema?.$id as string, byProp)
    }

    const violations: string[] = []
    const walk = (node: any, presetId: string) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) walk(child, presetId)
        return
      }
      const byProp = optionsFor.get(node.componentId)
      for (const [prop, value] of Object.entries(node.props ?? {})) {
        const allowed = byProp?.get(prop)
        if (!allowed || allowed.has(value)) continue
        violations.push(
          `${presetId} plants ${node.componentId}.${prop} = ` +
            `${JSON.stringify(value)}, which is not an offered option`,
        )
      }
      for (const child of Object.values(node)) walk(child, presetId)
    }

    for (const entry of MUI_BUNDLE)
      for (const preset of entry.presets ?? [])
        walk(preset.data, preset.$id as string)

    expect(violations).toEqual([])
  })
})

describe('no registered component offers an unguarded `""` option (AGL-1451)', () => {
  it('every `""` option value sits behind a dropClearedProps boundary', () => {
    const violations: string[] = []
    // A component the probe cannot reach would silently count as guarded,
    // so the differential is tracked and asserted too.
    const inconclusive: string[] = []

    for (const entry of MUI_BUNDLE) {
      const id = entry.schema?.$id ?? '(no id)'
      const attributes: any[] = (entry.schema as any)?.attributes ?? []
      const offering = attributes.filter(clearedOptions).map((a) => a.name)
      if (!offering.length) continue

      const verdict = detectClearedPropsGuard(entry.component)
      if (verdict === 'inconclusive') {
        inconclusive.push(`${id} [${offering.join(', ')}]`)
      } else if (verdict === 'passes-through') {
        violations.push(
          `${id} offers a "" option on [${offering.join(', ')}] and does ` +
            'not drop cleared props',
        )
      }
    }

    expect(violations).toEqual([])
    expect(inconclusive).toEqual([])
  })
})
