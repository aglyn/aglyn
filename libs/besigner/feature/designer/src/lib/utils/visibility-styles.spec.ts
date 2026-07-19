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

import {
  readHiddenBands,
  VISIBILITY_BAND_MEDIA,
  writeHiddenBand,
} from './visibility-styles'

describe('visibility styles (AGL-562)', () => {
  it('reads no hidden bands from an empty sx', () => {
    expect(readHiddenBands(undefined)).toEqual([])
    expect(readHiddenBands({ color: 'red' })).toEqual([])
  })

  it('round-trips hiding and showing a band', () => {
    let sx = writeHiddenBand({ color: 'red' }, 'mobile', true)
    expect(sx[VISIBILITY_BAND_MEDIA.mobile]).toEqual({ display: 'none' })
    expect(readHiddenBands(sx)).toEqual(['mobile'])

    sx = writeHiddenBand(sx, 'desktop', true)
    expect(readHiddenBands(sx)).toEqual(['mobile', 'desktop'])

    sx = writeHiddenBand(sx, 'mobile', false)
    expect(readHiddenBands(sx)).toEqual(['desktop'])
    // The emptied media key is dropped entirely.
    expect(VISIBILITY_BAND_MEDIA.mobile in sx).toBe(false)
    // Unrelated declarations survive throughout.
    expect(sx['color']).toBe('red')
  })

  it('preserves foreign declarations under the same media key', () => {
    const sx = writeHiddenBand(
      { [VISIBILITY_BAND_MEDIA.tablet]: { padding: 4 } },
      'tablet',
      true,
    )
    expect(sx[VISIBILITY_BAND_MEDIA.tablet]).toEqual({
      padding: 4,
      display: 'none',
    })
    const shown = writeHiddenBand(sx, 'tablet', false)
    expect(shown[VISIBILITY_BAND_MEDIA.tablet]).toEqual({ padding: 4 })
  })

  it('never mutates the input sx', () => {
    const input = { [VISIBILITY_BAND_MEDIA.mobile]: { display: 'none' } }
    const snapshot = JSON.parse(JSON.stringify(input))
    writeHiddenBand(input, 'mobile', false)
    expect(input).toEqual(snapshot)
  })
})
