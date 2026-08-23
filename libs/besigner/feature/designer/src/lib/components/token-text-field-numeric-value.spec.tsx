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
 * A numeric model value does not spin the editor (AGL-2486).
 *
 * Reported live: "Maximum update depth exceeded ... at TokenEditableInput
 * useCallback[emit]". The element animation fields declare `TEXT_FIELD` with
 * `ANIMATION_DEFAULT_DURATION_MS = 600` and `ANIMATION_DEFAULT_DELAY_MS = 0`,
 * and the attributes memo rewrites TEXT_FIELD to this editor — so a NUMBER
 * reached a prop typed `string`, which `strictNullChecks` being off allows.
 *
 * `emit` stores a serialized STRING in `lastEmittedRef`, and the sync effect
 * skips on `tokenValue === lastEmittedRef.current`. `600 === '600'` is false,
 * so the guard never held: every render re-parsed and bumped `version` until
 * React gave up. The bug is the identity check spanning two types, not the
 * parse.
 *
 * `0` is covered deliberately — it is both the real delay default and falsy,
 * and the repo has a standing hazard about `if (!x)` not narrowing here.
 */
import { render } from '@testing-library/react'
import { createRef } from 'react'

import { TokenEditableInput } from './token-text-field.component'

describe('a numeric value in the token editor (AGL-2486)', () => {
  const renderWith = (value: unknown) => {
    const onChange = jest.fn()
    const view = render(
      <TokenEditableInput
        tokenValue={value as never}
        onTokenValueChange={onChange}
        multiline={false}
        labelContextRef={{ current: {} } as never}
        // Required by the component's props, and irrelevant to this bug: the
        // loop was in the value coercion, which runs before either is read.
        handleRef={createRef() as never}
        onPillClick={jest.fn()}
      />,
    )
    return { view, onChange }
  }

  it.each([
    ['a number', 600, '600'],
    ['zero, which is falsy and a real default', 0, '0'],
  ])('renders %s as text without looping', (_label, value, expected) => {
    // The loop threw during render, so reaching this line at all is the
    // assertion; the text check pins that it round-trips rather than blanking.
    const { view } = renderWith(value)
    expect(view.container.textContent).toContain(expected)
  })

  it('renders null as empty, not the word "null"', () => {
    // `String(null)` is "null" — a coercion that silently prints a word into
    // the box is the wrong fix for the loop.
    const { view } = renderWith(null)
    expect(view.container.textContent).not.toContain('null')
  })

  it('still renders an ordinary string unchanged', () => {
    const { view } = renderWith('slide up')
    expect(view.container.textContent).toContain('slide up')
  })
})
