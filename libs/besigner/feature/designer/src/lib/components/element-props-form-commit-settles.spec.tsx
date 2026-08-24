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
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import ElementPropsForm from './element-props-form.component'
import { BindingPickerContext } from '../contexts/binding-picker-context'

/**
 * ONE attribute edit is ONE commit — the panel's commit cycle has to SETTLE
 * (AGL-2486).
 *
 * The Attributes panel is a feedback loop by construction: a field change
 * schedules a debounced commit, the commit REPLACES `node.props`, the
 * `observer` panel re-renders, and the new props go straight back in as
 * `initialValues`. Nothing in that circle is guarded by a comparison — so
 * what stops it is worth pinning, because two plausible edits to this file
 * would remove it and the symptom is not a wrong value, it is React
 * throwing `Maximum update depth exceeded` and the editor dying.
 *
 * Two things stop it, and both are exercised here:
 *
 * 1. **Re-initialization resets `values` to `initialValues`.** The written
 *    value does not have to equal the submitted one — `handleElementSave`
 *    normalizes hand-typed `{{name}}` tokens to `{{var:id}}` (AGL-186) and
 *    `updateNodeProps` drops `undefined` keys (AGL-1334), so the round trip
 *    routinely returns a DIFFERENT object than the form submitted. That
 *    still settles, because react-final-form re-initializes from the new
 *    `initialValues` and `pristine` goes back to `true`, which is the
 *    condition `AutoSaveOnChange` schedules on.
 * 2. **Every write-back transform is idempotent.** `f(f(x)) === f(x)` for
 *    both of them, so even a form that stayed dirty would converge instead
 *    of oscillating between two values forever.
 *
 * The last test is the negative control: `keepDirtyOnReinitialize` (which
 * the Styles panel legitimately uses, and which reaches this form through
 * its `...rest` spread) defeats (1), and the same single edit then commits
 * twice. That is the mutation proof for the FIRST test — adding the prop to
 * it reddens it, 2 commits against 1 — and a guard if anyone ever adds it
 * here. The second test is proved live differently: dropping the debounce
 * window between its two edits collapses them into one commit and reddens
 * it. `keepDirtyOnReinitialize` does NOT disturb the second test, because
 * the cleared field's value and the absent key agree once the form
 * re-initializes either way.
 */
describe('the attributes commit cycle settles (AGL-2486)', () => {
  let commits: Array<Record<string, unknown>> = []
  let setPropsRef: ((next: Record<string, unknown>) => void) | null = null
  let spy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    commits = []
    setPropsRef = null
    spy = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation(((node: unknown, props: Record<string, unknown>) => {
        commits.push(props)
        // A runaway must fail as a runaway, not as a jest timeout.
        if (commits.length > 20) throw new Error('commit cycle did not settle')
        // What the canvas does with the submitted props: strip `undefined`,
        // replace the object wholesale, and notify the observers that feed
        // this panel's `initialValues`.
        setPropsRef?.(Aglyn.stripUndefinedDeep({ ...props }))
      }) as never)
  })
  afterEach(() => {
    spy.mockRestore()
    jest.useRealTimers()
  })

  /** One host variable, so `{{Message}}` has an id form to normalize to. */
  const variables = { Message: { $id: 'aB3xK9m2Qw', name: 'Message' } } as never

  const mount = (
    initialProps: Record<string, unknown>,
    attributes: Array<Record<string, unknown>>,
    formProps: Record<string, unknown> = {},
  ) => {
    function Host() {
      const [props, setProps] = useState(initialProps)
      setPropsRef = setProps
      return (
        <BindingPickerContext.Provider value={{ variables, functions: {} }}>
          <ElementPropsForm
            node={
              {
                $id: 'agl2486node',
                type: 'node',
                componentId: 'unregistered-link',
                props,
                componentSchema: { attributes },
                nodes: [],
              } as never
            }
            {...formProps}
          />
        </BindingPickerContext.Provider>
      )
    }
    return render(<Host />)
  }

  const linkAttribute = {
    name: 'href',
    label: 'Link',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
  }

  /** Type into the pill editor exactly as `handleInput` sees it. */
  const typeInto = (surface: HTMLElement, text: string) =>
    act(() => {
      surface.textContent = text
      fireEvent.input(surface)
    })

  /**
   * Let ten debounce windows elapse and report the commits each one
   * produced. A settled panel commits in the first and never again; a
   * cycling one keeps re-arming, so the tail is non-zero.
   */
  const commitsPerWindow = (windows = 10) => {
    const perWindow: number[] = []
    for (let index = 0; index < windows; index += 1) {
      const before = commits.length
      act(() => {
        jest.advanceTimersByTime(ATTRIBUTE_COMMIT_WINDOW_MS)
      })
      perWindow.push(commits.length - before)
    }
    return perWindow
  }
  /** Comfortably past the AGL-567 debounce, so a due commit always runs. */
  const ATTRIBUTE_COMMIT_WINDOW_MS = 500

  const firstSurface = async () =>
    (await screen.findAllByTestId('token-text-field'))[0] as HTMLElement

  it('settles when the value written back is NOT the value submitted', async () => {
    mount({ href: '' }, [linkAttribute])
    typeInto(await firstSurface(), 'go {{Message}} now')

    const perWindow = commitsPerWindow()

    // The commit rewrote the token, so `initialValues` came back changed —
    // and it STILL committed once.
    expect(commits).toHaveLength(1)
    expect(commits[0]['href']).toBe('go {{var:aB3xK9m2Qw}} now')
    expect(perWindow.slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('settles when the commit DROPS the key the form submitted', async () => {
    // CLEARING an attribute is the sharpest version of this: final-form's
    // default parse turns the emptied box into `undefined`, and
    // `stripUndefinedDeep` then removes the key entirely (AGL-1334). So the
    // form holds a field whose value the stored props no longer have at
    // all — the "initialValues never equals values" shape.
    mount({ href: 'https://example.com' }, [linkAttribute])
    const surface = await firstSurface()
    typeInto(surface, 'https://example.org')
    commitsPerWindow(1)
    typeInto(await firstSurface(), '')

    const perWindow = commitsPerWindow()

    expect(commits).toHaveLength(2)
    expect(commits[1]).not.toHaveProperty('href')
    expect(perWindow.slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('the write-back transforms are idempotent, so a cycle would converge', () => {
    const once = Aglyn.normalizeBindingTokens('go {{Message}} now', {
      Message: { $id: 'aB3xK9m2Qw', name: 'Message' },
    })
    expect(once).toBe('go {{var:aB3xK9m2Qw}} now')
    // Normalizing the id form again must be a no-op: this is what keeps the
    // cycle from oscillating between two values if it ever stayed dirty.
    expect(
      Aglyn.normalizeBindingTokens(once, {
        Message: { $id: 'aB3xK9m2Qw', name: 'Message' },
      }),
    ).toBe(once)
    const stripped = Aglyn.stripUndefinedDeep({ a: 1, b: undefined })
    expect(Aglyn.stripUndefinedDeep(stripped)).toBe(stripped)
  })

  it('NEGATIVE CONTROL: keepDirtyOnReinitialize re-arms the cycle', async () => {
    // The mutation proof for the first test above. With the form keeping its
    // dirty value across the re-initialize, `pristine` never returns and the
    // changed `initialValues` schedule a SECOND commit for one edit.
    mount({ href: '' }, [linkAttribute], { keepDirtyOnReinitialize: true })
    typeInto(await firstSurface(), 'go {{Message}} now')

    commitsPerWindow()

    expect(commits.length).toBeGreaterThan(1)
  })
})
