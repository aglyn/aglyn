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

import { consoleThemeLight } from './console.theme'

/**
 * The Toolbar override targets the ROOT slot, while `disableGutters` only
 * drops the `gutters` slot — so before AGL-1230 the padding survived the prop
 * app-wide and the prop silently did nothing at >=sm. The marketing nav sat
 * 24px right of the page container at every width below the container clamp
 * because of it.
 */
describe('MuiToolbar gutters (AGL-1230)', () => {
  const root = (consoleThemeLight.components?.MuiToolbar?.styleOverrides as any)?.root
  const call = (ownerState: unknown) =>
    typeof root === 'function'
      ? root({ theme: consoleThemeLight, ownerState })
      : root

  const smUp = consoleThemeLight.breakpoints.up('sm')

  it('pads a normal toolbar from sm up', () => {
    const styles = call({ disableGutters: false })
    expect(styles[smUp]).toEqual({ paddingLeft: '24px', paddingRight: '24px' })
  })

  it('adds nothing when disableGutters is set', () => {
    expect(call({ disableGutters: true })).toEqual({})
  })

  it('negative control: the padded branch is the one being suppressed', () => {
    // Guards against the assertion above passing because the override moved
    // or the slot was renamed — the two branches must actually differ.
    expect(call({ disableGutters: false })).not.toEqual(
      call({ disableGutters: true }),
    )
  })

  it('treats a missing ownerState as a normal toolbar', () => {
    // Never rely on the caller passing ownerState — an absent one must keep
    // the padding, not silently remove it from every toolbar in the app.
    expect(call(undefined)[smUp]).toBeTruthy()
  })
})
