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
  clearRecordedRenderedWidths,
  mergeRenderedWidths,
  parseRenderedWidths,
  recordedRenderedWidthNodeIds,
  recordedRenderedWidths,
  recordRenderedWidth,
  renderedWidthBand,
  renderedWidthPercent,
  sizesFromBandWidths,
} from './rendered-widths'

afterEach(() => clearRecordedRenderedWidths())

describe('rendered widths (AGL-3485)', () => {
  it('names the band a width falls in, on MUI breakpoints', () => {
    expect(renderedWidthBand(390)).toBe('xs')
    expect(renderedWidthBand(600)).toBe('sm')
    expect(renderedWidthBand(899)).toBe('sm')
    expect(renderedWidthBand(900)).toBe('md')
    expect(renderedWidthBand(1440)).toBe('lg')
    expect(renderedWidthBand(1920)).toBe('xl')
  })

  it('takes a share of the page, refusing what is not a measurement', () => {
    expect(renderedWidthPercent(320, 1280)).toBe(25)
    expect(renderedWidthPercent(400, 1200)).toBe(33.3)
    expect(renderedWidthPercent(1400, 1200)).toBe(100)
    expect(renderedWidthPercent(0, 1200)).toBeUndefined()
    expect(renderedWidthPercent(100, 0)).toBeUndefined()
  })

  it('keeps only usable bands from a stored value', () => {
    expect(
      parseRenderedWidths({ xs: 100, md: '33', lg: -1, xxl: 20, xl: 25.04 }),
    ).toEqual({ xs: 100, xl: 25 })
    expect(parseRenderedWidths('100vw')).toEqual({})
    expect(parseRenderedWidths(null)).toEqual({})
  })

  it('records per node and band, the latest measurement winning', () => {
    recordRenderedWidth('a', 'lg', 30)
    recordRenderedWidth('a', 'lg', 33.33)
    recordRenderedWidth('a', 'xs', 100)
    recordRenderedWidth('', 'xs', 50)
    expect(recordedRenderedWidths('a')).toEqual({ lg: 33.3, xs: 100 })
    expect(recordedRenderedWidthNodeIds()).toEqual(['a'])
    clearRecordedRenderedWidths()
    expect(recordedRenderedWidthNodeIds()).toEqual([])
  })

  it('merges a recording over what was stored, past the tolerance only', () => {
    expect(mergeRenderedWidths({ lg: 33.3 }, { lg: 33.6 })).toBeUndefined()
    expect(mergeRenderedWidths({ lg: 33.3, xs: 100 }, { lg: 50 })).toEqual({
      lg: 50,
      xs: 100,
    })
    expect(mergeRenderedWidths(undefined, { md: 40 })).toEqual({ md: 40 })
    expect(mergeRenderedWidths({ md: 40 }, {})).toBeUndefined()
  })

  it('writes sizes widest first, merging bands that agree', () => {
    expect(sizesFromBandWidths({})).toBe('100vw')
    expect(sizesFromBandWidths({ md: 33.3 })).toBe(
      '(min-width: 900px) 33.3vw, 100vw',
    )
    expect(sizesFromBandWidths({ xs: 90, sm: 50, lg: 25 })).toBe(
      '(min-width: 1200px) 25vw, (min-width: 600px) 50vw, 90vw',
    )
    expect(sizesFromBandWidths({ xs: 5 })).toBe('5vw')
  })
})
