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
 * `computedFn`, and only `computedFn` (AGL-2706), vendored (AGL-3410).
 *
 * ## Why this is a copy and not an import
 *
 * It used to re-export `mobx-utils/lib/computedFn.js`. `mobx-utils` 6.1.1 is
 * that package's latest release and peers on `mobx ^6`; it has not shipped
 * since June 2025 and has no line for MobX 7. This library is published, so
 * declaring `mobx-utils` beside the `mobx ^7` the rest of the workspace needs
 * hands every consumer an unsatisfiable peer range — an `ERESOLVE` on any
 * install that enforces peers, which ours (`legacy-peer-deps`) would never
 * show. The helper is ~100 lines over five MobX exports that all survive in
 * 7, so it lives here instead.
 *
 * The body below is `src/computedFn.ts` and `src/deepMap.ts` from mobx-utils
 * v6.1.1, unchanged except for formatting and `DeepMap` becoming module
 * private. Copyright (c) 2016 MobX, MIT License:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 *   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * ## Why only this one
 *
 * The package entry was a single 68 KB rollup bundle of forty-odd helpers, and
 * 14.0 KB raw of it reached every published customer page for this one
 * memoizer (AGL-2706). Four modules import it: `canvas-manager`,
 * `components-manager`, the besigner's `focus-manager`, and the loading
 * context.
 *
 * NOT re-exported from this library's index, per the note there.
 */

import {
  type IComputedValue,
  type IComputedValueOptions,
  _getGlobalState,
  _isComputingDerivation,
  computed,
  isAction,
  onBecomeUnobserved,
} from 'mobx'

export type IComputedFnOptions<F extends (...args: any[]) => any> = {
  onCleanup?: (
    result: ReturnType<F> | undefined,
    ...args: Parameters<F>
  ) => void
} & IComputedValueOptions<ReturnType<F>>

/**
 * Memoizes `fn` per argument list for as long as each result is observed.
 *
 * Returns a function with the same signature. The argument count must be
 * constant and default arguments are not supported. Outside a reactive
 * context a call is not memoized and is cleaned up immediately, unless
 * `keepAlive` is set — which caches forever and can leak.
 *
 * `fn` must be pure, must not be an action, and should read only observables.
 */
export function computedFn<T extends (...args: any[]) => any>(
  fn: T,
  keepAliveOrOptions: IComputedFnOptions<T> | boolean = false,
): T {
  if (isAction(fn)) throw new Error("computedFn shouldn't be used on actions")

  let memoWarned = false
  let i = 0
  const opts =
    typeof keepAliveOrOptions === 'boolean'
      ? { keepAlive: keepAliveOrOptions }
      : keepAliveOrOptions
  const d = new DeepMap<IComputedValue<any>>()

  return function (this: any, ...args: Parameters<T>): ReturnType<T> {
    const entry = d.entry(args)
    // cache hit, return
    if (entry.exists()) return entry.get().get()
    // a cache miss outside a reactive context has nothing to keep it alive
    if (!opts.keepAlive && !_isComputingDerivation()) {
      if (
        !memoWarned &&
        (opts.requiresReaction ?? _getGlobalState().computedRequiresReaction)
      ) {
        console.warn(
          "Invoking a computedFn from outside a reactive context won't be memoized " +
            'and is cleaned up immediately, unless keepAlive is set.',
        )
        memoWarned = true
      }
      const value = fn.apply(this, args)
      if (opts.onCleanup) opts.onCleanup(value, ...args)
      return value
    }
    // create new entry
    let latestValue: ReturnType<T> | undefined
    const c = computed(
      () => {
        return (latestValue = fn.apply(this, args))
      },
      {
        ...opts,
        name: `computedFn(${opts.name || fn.name}#${++i})`,
      },
    )
    entry.set(c)
    // clean up if no longer observed
    if (!opts.keepAlive)
      onBecomeUnobserved(c, () => {
        d.entry(args).delete()
        if (opts.onCleanup) opts.onCleanup(latestValue, ...args)
        latestValue = undefined
      })
    // return current val
    return c.get()
  } as any
}

class DeepMapEntry<T> {
  private root: Map<any, any>
  private closest: Map<any, any>
  private closestIdx = 0

  constructor(
    private base: Map<any, any>,
    private args: any[],
    private version: number,
    private versionChecker: (version: number) => boolean,
  ) {
    let current: undefined | Map<any, any> = (this.closest = this.root = base)
    let i = 0
    for (; i < this.args.length - 1; i++) {
      current = current!.get(args[i])
      if (current) this.closest = current
      else break
    }
    this.closestIdx = i
  }

  exists(): boolean {
    this.assertCurrentVersion()
    const l = this.args.length
    return this.closestIdx >= l - 1 && this.closest.has(this.args[l - 1])
  }

  get(): T {
    this.assertCurrentVersion()
    if (!this.exists()) throw new Error("Entry doesn't exist")
    return this.closest.get(this.args[this.args.length - 1])
  }

  set(value: T) {
    this.assertCurrentVersion()
    const l = this.args.length
    let current: Map<any, any> = this.closest
    // create remaining maps
    for (let i = this.closestIdx; i < l - 1; i++) {
      const m = new Map()
      current.set(this.args[i], m)
      current = m
    }
    this.closestIdx = l - 1
    this.closest = current
    current.set(this.args[l - 1], value)
  }

  delete() {
    this.assertCurrentVersion()
    if (!this.exists()) throw new Error("Entry doesn't exist")
    const l = this.args.length
    this.closest.delete(this.args[l - 1])
    // clean up remaining maps if needed (reconstruct stack first)
    let c = this.root
    const maps: Map<any, any>[] = [c]
    for (let i = 0; i < l - 1; i++) {
      c = c.get(this.args[i])!
      maps.push(c)
    }
    for (let i = maps.length - 1; i > 0; i--) {
      if (maps[i].size === 0) maps[i - 1].delete(this.args[i - 1])
    }
  }

  private assertCurrentVersion() {
    if (!this.versionChecker(this.version)) {
      throw new Error('Concurrent modification exception')
    }
  }
}

class DeepMap<T> {
  private store = new Map<any, any>()
  private argsLength = -1
  private currentVersion = 0

  private checkVersion = (version: number) => {
    return this.currentVersion === version
  }

  entry(args: any[]): DeepMapEntry<T> {
    if (this.argsLength === -1) this.argsLength = args.length
    else if (this.argsLength !== args.length)
      throw new Error(
        `DeepMap should be used with functions with a consistent length, expected: ${this.argsLength}, got: ${args.length}`,
      )

    if (this.currentVersion >= Number.MAX_SAFE_INTEGER) {
      // Reset version counter when it reaches max safe integer
      this.currentVersion = 0
    }

    this.currentVersion++
    return new DeepMapEntry(
      this.store,
      args,
      this.currentVersion,
      this.checkVersion,
    )
  }
}
