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
 * WHAT A KEYSTROKE ACTUALLY RE-RENDERED, read off React's own commits
 * (AGL-3423).
 *
 * A keystroke that re-renders a whole dialog is cheap to write and expensive
 * to run, and it is the cost that matters: when each keystroke takes long
 * enough, typed input queues up and is processed back to back, and a chip
 * Autocomplete re-rendered by every one of them leaves React's nested-update
 * count climbing until it throws #185. A spec can only hold that line if it
 * can SEE it, so this counts it, the way React DevTools' "why did this
 * render" does: a stand-in devtools hook receives every committed tree, and
 * a walk that skips each subtree React bailed out of counts the components
 * whose functions ran.
 *
 * The hook is read when `react-dom` is first evaluated, so install it, then
 * `jest.resetModules()`, then require React, `react-dom/client` and the
 * component under test from the fresh registry.
 */

interface Fiber {
  type: unknown
  flags: number
  child: Fiber | null
  sibling: Fiber | null
  alternate: Fiber | null
}

/** `PerformedWork` in React's fiber flags: this fiber's function ran. */
const PERFORMED_WORK = 0b1

function componentName(type: unknown): string | undefined {
  if (!type || typeof type === 'string') return undefined
  const named = type as {
    displayName?: string
    name?: string
    render?: { displayName?: string; name?: string }
    type?: { displayName?: string; name?: string }
  }
  return (
    named.displayName ||
    named.name ||
    named.render?.displayName ||
    named.render?.name ||
    named.type?.displayName ||
    named.type?.name ||
    undefined
  )
}

function countCommit(current: Fiber, into: Map<string, number>): void {
  const visit = (fiber: Fiber) => {
    if (fiber.flags & PERFORMED_WORK) {
      const name = componentName(fiber.type)
      if (name) into.set(name, (into.get(name) ?? 0) + 1)
    }
    // A subtree React bailed out of keeps its old children: nothing in it ran.
    if (fiber.alternate && fiber.alternate.child === fiber.child) return
    for (let child = fiber.child; child; child = child.sibling) visit(child)
  }
  visit(current)
}

export interface FiberRenderCounter {
  /** How many times each named component rendered since the last reset. */
  rendered(name: string): number
  /** Every name counted since the last reset, for a failure message. */
  snapshot(): Record<string, number>
  reset(): void
  uninstall(): void
}

/** Installs the counting hook; `react-dom` must be required after this. */
export function installFiberRenderCounter(): FiberRenderCounter {
  const scope = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previous = scope.__REACT_DEVTOOLS_GLOBAL_HOOK__
  const counts = new Map<string, number>()
  const noop = () => undefined
  scope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: (_renderer: number, root: { current: Fiber }) =>
      countCommit(root.current, counts),
    onCommitFiberUnmount: noop,
    onPostCommitFiberRoot: noop,
    onScheduleFiberRoot: noop,
    setStrictMode: noop,
    checkDCE: noop,
  }
  return {
    rendered: (name) => counts.get(name) ?? 0,
    snapshot: () => Object.fromEntries(counts),
    reset: () => counts.clear(),
    uninstall: () => {
      scope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous
    },
  }
}
