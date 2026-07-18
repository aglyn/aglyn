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

import { safeJsonLd } from './safe-json-ld'

describe('safeJsonLd', () => {
  it('escapes a </script> breakout so the element cannot be closed', () => {
    const out = safeJsonLd({
      name: '</script><img src=x onerror=alert(1)>',
    })
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('\\u003c') // <
    expect(out).toContain('\\u003e') // >
  })

  it('escapes ampersands', () => {
    expect(safeJsonLd({ a: 'x & y' })).toContain('\\u0026')
  })

  it('escapes the U+2028/U+2029 line separators', () => {
    const lineSep = String.fromCharCode(0x2028)
    const paraSep = String.fromCharCode(0x2029)
    const out = safeJsonLd({ a: `line${lineSep}sep${paraSep}para` })
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(out).not.toContain(lineSep)
    expect(out).not.toContain(paraSep)
  })

  it('still round-trips to the original value as valid JSON', () => {
    const value = { '@type': 'Article', headline: 'A </script> & B' }
    expect(JSON.parse(safeJsonLd(value))).toEqual(value)
  })

  it('returns "null" for undefined instead of throwing', () => {
    expect(safeJsonLd(undefined)).toBe('null')
  })
})
