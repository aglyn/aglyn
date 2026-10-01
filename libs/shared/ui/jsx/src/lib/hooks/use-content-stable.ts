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

import { useRef } from 'react'

/** A stable token per function, so two keys agree only on the same function. */
const functionTokens = new WeakMap<object, number>()
let nextFunctionToken = 0
let nextUnkeyable = 0

/**
 * What a value HOLDS, as a string: plain data by value, a function by
 * identity, a Set by its members. A value it cannot write down — a cycle, a
 * React element's owner — gets a key of its own, so it only ever equals
 * itself.
 */
export function contentKey(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === 'function') {
        let token = functionTokens.get(entry)
        if (token === undefined) {
          nextFunctionToken += 1
          token = nextFunctionToken
          functionTokens.set(entry, token)
        }
        return `ƒ${token}`
      }
      if (entry instanceof Set) return { set: [...entry].sort() }
      return entry
    })
  } catch {
    nextUnkeyable += 1
    return `unkeyable:${nextUnkeyable}`
  }
}

/**
 * `value` itself while it holds the same content as last render, else the new
 * one — so a caller that builds a value inline on every render hands on the
 * SAME value while what it holds has not changed (AGL-3423).
 */
export function useContentStable<T>(value: T): T {
  const held = useRef<{ key: string; value: T } | undefined>(undefined)
  const key = contentKey(value)
  if (!held.current || held.current.key !== key) held.current = { key, value }
  return held.current.value
}
