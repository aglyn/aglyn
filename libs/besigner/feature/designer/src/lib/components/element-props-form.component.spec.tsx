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

import { act, renderHook } from '@testing-library/react'

import * as Aglyn from '@aglyn/aglyn'
import {
  ATTRIBUTE_COMMIT_DEBOUNCE_MS,
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
  ])('registers an editor for %s', (type) => {
    expect(elementPropsComponentMapper[type]).toBeDefined()
  })
})
