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
 * The dropper a boot registers is the dropper a route reads (AGL-3456).
 *
 * The tenant registers it from `instrumentation.ts`, which Next compiles apart
 * from the routes, so the two hold separate copies of this module. Each copy
 * is stood up here with `jest.isolateModules`: registered through one, read
 * through the other. A slot held in a module `let` fails the first case.
 */

import type * as LivePageDrops from './live-page-drops'

/** A fresh copy of the module, as a separately compiled graph holds it. */
function freshCopy(): typeof LivePageDrops {
  let copy: typeof LivePageDrops | undefined
  jest.isolateModules(() => {
    copy = jest.requireActual('./live-page-drops') as typeof LivePageDrops
  })
  if (!copy) throw new Error('the module did not load')
  return copy
}

const drop: LivePageDrops.LivePageDropper = async () => true
const other: LivePageDrops.LivePageDropper = async () => false

describe('the live-page dropper slot', () => {
  it('is read by every copy of the module, not only the one that registered it', () => {
    const boot = freshCopy()
    const route = freshCopy()
    expect(boot).not.toBe(route)
    const unregister = boot.registerLivePageDropper(drop)
    expect(route.registeredLivePageDropper()).toBe(drop)
    unregister()
    expect(route.registeredLivePageDropper()).toBeUndefined()
  })

  it('replaces the previous dropper, and an old unregister leaves the new one', () => {
    const copy = freshCopy()
    const first = copy.registerLivePageDropper(drop)
    const second = copy.registerLivePageDropper(other)
    first()
    expect(copy.registeredLivePageDropper()).toBe(other)
    second()
    expect(copy.registeredLivePageDropper()).toBeUndefined()
  })
})
