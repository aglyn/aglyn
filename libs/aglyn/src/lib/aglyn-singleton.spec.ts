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
 * AGL-53 regression: evaluating the runtime module twice (what a client/
 * server graph split or the ESM/CJS dual-package hazard does in Next.js)
 * must yield the SAME instance — a second copy filling its own canvas is
 * exactly the empty-hydration bug this pins.
 */
describe('aglyn runtime singleton (AGL-53)', () => {
  it('returns the same instance across duplicate module evaluations', () => {
    let first: any
    let second: any
    jest.isolateModules(() => {
      first = require('./aglyn')
    })
    jest.isolateModules(() => {
      second = require('./aglyn')
    })
    expect(first.aglyn).toBe(second.aglyn)
    expect(first.canvas).toBe(second.canvas)
    expect(first.emitter).toBe(second.emitter)
    expect(first.components).toBe(second.components)
  })

  it('does not re-wire event handlers on duplicate evaluation', () => {
    let first: any
    let second: any
    jest.isolateModules(() => {
      first = require('./aglyn')
    })
    const before = first.emitter.listenerCount(
      first.AglynEvent?.NODE_SET ?? 'node:set',
    )
    jest.isolateModules(() => {
      second = require('./aglyn')
    })
    const after = second.emitter.listenerCount(
      second.AglynEvent?.NODE_SET ?? 'node:set',
    )
    expect(after).toBe(before)
    expect(before).toBeGreaterThan(0)
  })

  it('canvas state written through one copy is visible through the other', () => {
    let first: any
    let second: any
    jest.isolateModules(() => {
      first = require('./aglyn')
    })
    jest.isolateModules(() => {
      second = require('./aglyn')
    })
    const nodes = first.canvas.toJSON().nodes
    expect(second.canvas.toJSON().nodes).toEqual(nodes)
  })
})
