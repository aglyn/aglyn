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
  filterPluginProps,
  parseGuestMessage,
  parseHostMessage,
  PLUGIN_BRIDGE_VERSION,
  PLUGIN_MAX_HEIGHT_PX,
} from './plugin-bridge'

describe('filterPluginProps', () => {
  it('keeps only declared, serializable props', () => {
    const filtered = filterPluginProps(
      { city: 'NYC', secret: 'token', fn: () => 1 },
      ['city', 'fn', 'missing'],
    )
    expect(filtered).toEqual({ city: 'NYC' })
  })

  it('returns empty without an allowlist', () => {
    expect(filterPluginProps({ a: 1 }, undefined)).toEqual({})
    expect(filterPluginProps(undefined, ['a'])).toEqual({})
  })
})

describe('parseGuestMessage', () => {
  const v = PLUGIN_BRIDGE_VERSION

  it('accepts ready/resize/error and clamps height', () => {
    expect(parseGuestMessage({ type: 'ready', v }, [])).toEqual({
      type: 'ready',
      v,
    })
    expect(parseGuestMessage({ type: 'resize', v, height: 1e9 }, [])).toEqual({
      type: 'resize',
      v,
      height: PLUGIN_MAX_HEIGHT_PX,
    })
    expect(
      parseGuestMessage({ type: 'error', v, message: 'boom' }, []),
    ).toEqual({ type: 'error', v, message: 'boom' })
  })

  it('accepts declared events only', () => {
    expect(
      parseGuestMessage({ type: 'event', v, name: 'refresh' }, ['refresh']),
    ).toEqual({ type: 'event', v, name: 'refresh', payload: undefined })
    expect(
      parseGuestMessage({ type: 'event', v, name: 'exfiltrate' }, ['refresh']),
    ).toBeNull()
  })

  it('rejects wrong version, junk, and negative height', () => {
    expect(parseGuestMessage({ type: 'ready', v: 999 }, [])).toBeNull()
    expect(parseGuestMessage('nope', [])).toBeNull()
    expect(parseGuestMessage({ type: 'resize', v, height: -5 }, [])).toBeNull()
  })

  it('shapes fetch-request and normalizes the method (AGL-191)', () => {
    expect(
      parseGuestMessage(
        { type: 'fetch-request', v, id: 'r1', url: 'https://a.com/x' },
        [],
      ),
    ).toEqual({
      type: 'fetch-request',
      v,
      id: 'r1',
      url: 'https://a.com/x',
      method: 'GET',
    })
    expect(
      parseGuestMessage(
        {
          type: 'fetch-request',
          v,
          id: 'r2',
          url: 'https://a.com',
          method: 'delete',
          body: 'x',
        },
        [],
      ),
    ).toMatchObject({ method: 'GET', body: 'x' })
    expect(
      parseGuestMessage({ type: 'fetch-request', v, id: '', url: '' }, []),
    ).toBeNull()
  })

  it('sanitizes event payloads to JSON-round-trippable data', () => {
    const result = parseGuestMessage(
      { type: 'event', v, name: 'x', payload: { a: 1, b: [2, 3] } },
      ['x'],
    )
    expect(result).toEqual({
      type: 'event',
      v,
      name: 'x',
      payload: { a: 1, b: [2, 3] },
    })
  })
})

describe('parseHostMessage', () => {
  const v = PLUGIN_BRIDGE_VERSION

  it('accepts init with scheme and props', () => {
    expect(
      parseHostMessage({ type: 'init', v, props: { city: 'NYC' }, scheme: 'dark' }),
    ).toEqual({ type: 'init', v, props: { city: 'NYC' }, scheme: 'dark' })
  })

  it('accepts props updates and drops invalid scheme', () => {
    expect(parseHostMessage({ type: 'props', v, props: { a: 1 } })).toEqual({
      type: 'props',
      v,
      props: { a: 1 },
    })
    expect(
      parseHostMessage({ type: 'init', v, props: {}, scheme: 'neon' }),
    ).toEqual({ type: 'init', v, props: {} })
  })

  it('rejects unknown types and versions', () => {
    expect(parseHostMessage({ type: 'exec', v })).toBeNull()
    expect(parseHostMessage({ type: 'init', v: 2, props: {} })).toBeNull()
  })
})
