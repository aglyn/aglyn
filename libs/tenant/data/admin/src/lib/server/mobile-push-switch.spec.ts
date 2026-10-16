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
 * The push senders a boot registers are the senders a route's fan-out reads.
 *
 * The console and the tenant register them from `instrumentation.ts`, which
 * Next compiles apart from the routes, so the two hold separate copies of
 * these modules. Each copy is stood up here with `jest.isolateModules`:
 * registered through one, read through the other. A module-scoped set fails
 * the first case, and every push is skipped without a word.
 */

import type * as MobilePushSwitch from './mobile-push-switch'
import type * as NativePush from './native-push'

/** A fresh copy of a module, as a separately compiled graph holds it. */
function freshCopy<T>(path: string): T {
  let copy: T | undefined
  jest.isolateModules(() => {
    copy = jest.requireActual(path) as T
  })
  if (!copy) throw new Error('the module did not load')
  return copy
}

const sender: MobilePushSwitch.MobilePushSender = async () => undefined

describe('the mobile push sender registry', () => {
  it('is read by every copy of the module, not only the one that registered it', () => {
    const boot = freshCopy<typeof MobilePushSwitch>('./mobile-push-switch')
    const route = freshCopy<typeof MobilePushSwitch>('./mobile-push-switch')
    expect(boot).not.toBe(route)
    const unregister = boot.registerMobilePushSender(sender)
    expect(route.mobilePushSenders()).toContain(sender)
    unregister()
    expect(route.mobilePushSenders()).not.toContain(sender)
  })

  it('registers the native senders once, however many copies boot calls', () => {
    const route = freshCopy<typeof MobilePushSwitch>('./mobile-push-switch')
    const before = route.mobilePushSenders().length
    freshCopy<typeof NativePush>('./native-push').registerNativePushSenders()
    freshCopy<typeof NativePush>('./native-push').registerNativePushSenders()
    expect(route.mobilePushSenders()).toHaveLength(before + 1)
  })
})
