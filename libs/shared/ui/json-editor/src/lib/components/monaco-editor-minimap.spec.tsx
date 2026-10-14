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
 * AGL-3770 — Monaco's minimap is off below `md`.
 *
 * On a narrow viewport the minimap strip took width the editor cannot spare.
 * Monaco cannot run under jsdom, so `<ReactMonacoEditor>` is replaced by a
 * double that records the `options` it was given, and `matchMedia` is driven
 * directly to stand in for the viewport width.
 */

import { render } from '@testing-library/react'
import MonacoEditor from './monaco-editor'

// eslint-disable-next-line no-var
var mockOptions: any[] | undefined

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  loader: { config: (): void => undefined },
  default: (props: any): null => {
    if (!mockOptions) mockOptions = []
    mockOptions.push(props.options)
    return null
  },
}))

/** Make every `matchMedia` query answer `matches`. */
const viewport = (matches: boolean) => {
  const noop = (): void => undefined
  window.matchMedia = (query: string): MediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: (): boolean => false,
  })
}

const lastOptions = () => (mockOptions ?? [])[(mockOptions ?? []).length - 1]

describe('MonacoEditor minimap', () => {
  beforeEach(() => {
    mockOptions = []
  })

  it('turns the minimap off on a narrow viewport', () => {
    viewport(true)
    render(<MonacoEditor />)
    expect(lastOptions()?.minimap?.enabled).toBe(false)
  })

  it('keeps the minimap on a wide viewport', () => {
    viewport(false)
    render(<MonacoEditor />)
    expect(lastOptions()?.minimap?.enabled).toBe(true)
  })

  it("lets a caller's own options win", () => {
    viewport(true)
    render(
      <MonacoEditor options={{ minimap: { enabled: true }, readOnly: true }} />,
    )
    expect(lastOptions()).toEqual({
      minimap: { enabled: true },
      readOnly: true,
    })
  })
})
