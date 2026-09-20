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
 * The canvas's side of a read it cannot make itself (AGL-2838, AGL-3111).
 *
 * The designer does not read Firestore — it renders inside a plugin sandbox,
 * and the documents are the host app's to know. So a canvas element HOLDS what
 * it needs read, the host app renders one reader per held request, and each
 * reader files its answer back here under the request's key, where the element
 * reads it.
 */
export interface HeldAnswersSource<Request, Answer> {
  /**
   * The answer filed under `key`, or `undefined` while nothing has answered.
   */
  get(key: string): Answer | undefined
  /**
   * Keeps the request read while the caller holds it, and returns the
   * release. Holds are counted, so two holders of one request share a read
   * and the read ends with the last of them.
   */
  retain(request: Request): () => void
  /** Called after any answer changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Moves on every change, so a subscriber can tell a new answer apart. */
  getVersion(): number
}

/** The source, plus the two ends the host app drives it from. */
export interface HeldAnswersStore<Request, Answer>
  extends HeldAnswersSource<Request, Answer> {
  /** Files a request's answer; no answer withdraws it. */
  set(key: string, answer: Answer | undefined): void
  /**
   * The requests something currently holds, one per key. The array is
   * replaced only when that set changes, which is the stable snapshot
   * `useSyncExternalStore` needs to render one reader per request.
   */
  getRetained(): readonly Request[]
  /** Called after the held set changes. Returns the unsubscribe. */
  subscribeRetained(listener: () => void): () => void
}

/**
 * An in-memory store keyed by `keyOf`. How each request is read is the host
 * app's business.
 */
export function createHeldAnswersStore<Request, Answer>(
  keyOf: (request: Request) => string,
): HeldAnswersStore<Request, Answer> {
  const answers = new Map<string, Answer>()
  const holds = new Map<string, { request: Request; count: number }>()
  const listeners = new Set<() => void>()
  const retainedListeners = new Set<() => void>()
  let version = 0
  let retained: readonly Request[] = []
  const notify = (targets: Set<() => void>) => {
    for (const listener of [...targets]) listener()
  }
  const publishRetained = () => {
    retained = [...holds.values()].map((hold) => hold.request)
    notify(retainedListeners)
  }
  return {
    get: (key) => answers.get(key),
    getVersion: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retain: (request) => {
      const key = keyOf(request)
      const hold = holds.get(key)
      if (hold) {
        hold.count += 1
      } else {
        holds.set(key, { request, count: 1 })
        publishRetained()
      }
      let released = false
      return () => {
        if (released) return
        released = true
        const current = holds.get(key)
        if (!current) return
        current.count -= 1
        if (current.count > 0) return
        holds.delete(key)
        publishRetained()
      }
    },
    set: (key, answer) => {
      if (answer) answers.set(key, answer)
      else if (!answers.delete(key)) return
      version += 1
      notify(listeners)
    },
    getRetained: () => retained,
    subscribeRetained: (listener) => {
      retainedListeners.add(listener)
      return () => {
        retainedListeners.delete(listener)
      }
    },
  }
}
