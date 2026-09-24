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

import { HostViewType } from '@aglyn/aglyn'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useComponentEditorSurface } from './use-component-editor-surface'

const mockEnsure = jest.fn()
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: (...args: unknown[]) => mockEnsure(...args) },
}))

/**
 * A reusable component's own editor (AGL-3287): an email block opens in the
 * EMAIL view with the email plugin's elements registered, and a page
 * component opens exactly as it always has.
 */
describe('useComponentEditorSurface (AGL-3287)', () => {
  beforeEach(() => {
    mockEnsure.mockReset()
  })

  it('opens an email block in the email view, once the email blocks are registered', async () => {
    let finish: () => void = () => undefined
    mockEnsure.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { result } = renderHook(() =>
      useComponentEditorSurface({ kind: 'email' }, true),
    )
    expect(result.current.kind).toBe('email')
    expect(result.current.viewType).toBe(HostViewType.EMAIL)
    // The canvas waits: drawn now, it would be a tree of unregistered blocks.
    expect(result.current.ready).toBe(false)
    expect(mockEnsure).toHaveBeenCalledWith(['email'], ['site'])

    await act(async () => finish())
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('opens a page component in the view the editor has always used, loading nothing', () => {
    const { result } = renderHook(() => useComponentEditorSurface({}, true))
    expect(result.current.kind).toBe('site')
    // No view set at all — not SCREEN, and never LAYOUT, whose slot outlet
    // has nowhere to graft inside a component (AGL-680).
    expect(result.current.viewType).toBeUndefined()
    expect(result.current.ready).toBe(true)
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('draws nothing until the component has been read, so the drawer never flips', () => {
    const { result, rerender } = renderHook(
      ({ component, loaded }) => useComponentEditorSurface(component, loaded),
      {
        initialProps: {
          component: undefined as { kind?: unknown } | undefined,
          loaded: false,
        },
      },
    )
    expect(result.current.ready).toBe(false)
    expect(mockEnsure).not.toHaveBeenCalled()

    mockEnsure.mockReturnValue(new Promise<void>(() => undefined))
    rerender({ component: { kind: 'email' }, loaded: true })
    expect(result.current.ready).toBe(false)
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })
})
