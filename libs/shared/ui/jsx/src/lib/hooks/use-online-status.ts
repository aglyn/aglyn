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
'use client'

import { useSyncExternalStore } from 'react'

/**
 * Subscribe to every event that can change the answer.
 *
 * Module scope, not a closure built per render: `useSyncExternalStore`
 * resubscribes whenever this identity changes, so an inline function would
 * tear down and re-add the listeners on every render of every consumer.
 *
 * Symmetric by construction — the same three names with the same handler
 * reference are removed as were added. That matters under StrictMode, which
 * deliberately mounts, unmounts and remounts each effect: an asymmetric
 * cleanup leaks a listener per mount and, worse, leaves a listener bound to a
 * callback from a torn-down render.
 *
 * `visibilitychange` is in here because `online`/`offline` are not guaranteed
 * to be delivered to a backgrounded or discarded tab — a laptop that slept on
 * hotel wifi and woke on another network can miss the pair entirely. The
 * snapshot below is a pure read, so an extra notification costs one
 * `Object.is` comparison and React bails out; a missed one leaves the chrome
 * asserting a connection state that stopped being true hours ago.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  document.addEventListener('visibilitychange', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
    document.removeEventListener('visibilitychange', onStoreChange)
  }
}

/**
 * The live client answer, read fresh on every mount rather than seeded from a
 * default. A boolean is its own snapshot identity, so this never trips the
 * "getSnapshot should be cached" loop that catches object-returning stores.
 *
 * Anything other than an explicit `false` counts as online. `navigator.onLine`
 * is a positive assertion of disconnection only: a browser that does not
 * implement it leaves it `undefined`, and reading that as "offline" would have
 * the console announce a network failure it has no evidence for.
 */
function getSnapshot(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * There is no `navigator` on the server, and no way to know a client's
 * connection before one exists — so the server renders the online branch, and
 * React uses this same value for the hydration render. That is what keeps the
 * markup identical on both sides: the offline state can only appear AFTER
 * hydration, from a real reading, never as a flash of a state nobody measured.
 */
function getServerSnapshot(): boolean {
  return true
}

/**
 * Whether the browser currently believes it has a network connection
 * (AGL-1056).
 *
 * The console is an authoring tool, and the failure it has to avoid is the
 * silent one: edits that appear to apply, a save that never lands, and no
 * indication that the network — rather than the app — is the reason. This is
 * the signal the chrome renders from.
 *
 * `navigator.onLine` is a floor, not a guarantee. It answers "is there a
 * network interface up", which is why it can read `true` on a captive portal
 * or a dead uplink. It cannot produce a false OFFLINE, though, and that is the
 * direction this is used in: when it says offline, the console is offline.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export default useOnlineStatus
