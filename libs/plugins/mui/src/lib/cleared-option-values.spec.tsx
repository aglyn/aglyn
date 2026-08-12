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
