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
import { MUI_BUNDLE } from './plugin'

/**
 * Bundle-wide guard for the AGL-1226 shape: an author CLEARS an attribute,
 * the besigner persists `null`, React substitutes a default only for
 * `undefined`, so the null travels into MUI and throws DURING SSR — a 500 on
 * a public page, triggered by an ordinary authoring action.
 *
 * This asserts over the REGISTERED BUNDLE rather than over a list of
 * components someone remembered to add, because that is the failure mode this
 * class keeps having. `button.tsx` was fixed in AGL-1226 and the follow-up
 * diagnosis recorded that Screen Link was the only other exposed component —
 * a sweep found FIVE (app bar, typography, screen link, stack, pagination).
 * A hand-maintained list would have inherited the same undercount. Register a
 * sixth component that spreads a cleared prop into MUI and this fails.
 */
const attempt = (Component: any, props: Record<string, any>) => {
  try {
    const { unmount } = render(
      <Component {...props}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Component>,
    )
    unmount()
    return null
  } catch (error: any) {
    return String(error?.message ?? error)
  }
}

describe('no registered component breaks on a cleared prop (AGL-1226)', () => {
  it('renders every schema attribute cleared to null without throwing', () => {
    const exposed: string[] = []
    // Components that cannot render at all in this harness would silently
    // count as "safe", so the differential is tracked and asserted too.
    const unrenderable: string[] = []

    for (const entry of MUI_BUNDLE) {
      const id = entry.schema?.$id ?? '(no id)'
      const attributes: any[] = (entry.schema as any)?.attributes ?? []
      for (const attribute of attributes) {
        const name = attribute?.name
        if (!name || name === 'children') continue

        // The control: the same render with the prop absent. Only a
        // component that survives `undefined` and dies on `null` is
        // demonstrating THIS bug rather than an unrelated failure.
        const baseline = attempt(entry.component, { [name]: undefined })
        const cleared = attempt(entry.component, { [name]: null })

        if (baseline) {
          unrenderable.push(`${id}.${name}`)
        } else if (cleared) {
          exposed.push(`${id}.${name} -> ${cleared}`)
        }
      }
    }

    expect(exposed).toEqual([])
    // If this ever becomes non-empty, the sweep above stopped covering
    // something — the list shrinking is a loss of coverage, not a pass.
    expect(unrenderable).toEqual([])
  })
})
