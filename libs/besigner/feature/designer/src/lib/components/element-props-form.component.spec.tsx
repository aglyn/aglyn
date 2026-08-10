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
import { TOKEN_TEXT_FIELD_COMPONENT } from './token-text-field.component'
import { SCREEN_LINK_FIELD_COMPONENT } from './screen-link-field.component'
import { act, renderHook } from '@testing-library/react'

import * as Aglyn from '@aglyn/aglyn'
import {
  ATTRIBUTE_COMMIT_DEBOUNCE_MS,
  buildInstancePropFields,
  buildVisibilityFields,
  elementPropsComponentMapper,
  useDebouncedCommit,
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
  ])('registers an editor for %s', (type) => {
    expect(elementPropsComponentMapper[type]).toBeDefined()
  })

  // The list above is hand-maintained, so it only covers types a schema
  // declares DIRECTLY. Two attribute types are rewritten to internal editor
  // keys before render instead, and those keys are the ones that actually
  // reach the mapper — a rewrite pointing at an unregistered key throws and
  // blanks the panel exactly the same way AGL-584 did, while every test above
  // stays green.
  it.each([TOKEN_TEXT_FIELD_COMPONENT, PLUGIN_SETTINGS_FIELD_COMPONENT])(
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
