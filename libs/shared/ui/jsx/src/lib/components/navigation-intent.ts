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

/** Events that precede a click on a link, in pointer, touch and keyboard order. */
const INTENT_EVENTS = ['pointerover', 'touchstart', 'focusin'] as const

/**
 * Runs `react` the first time the visitor reaches for a link, and never on a
 * visit that reaches for none (AGL-2710).
 *
 * Work a navigation will need — a chunk to fetch, a plugin to register — has
 * to start before the click or it lands in front of the very thing it was
 * meant to cover. Starting it on a timer after first paint achieves that, and
 * charges every page view for it: on a page billed per view, bytes fetched at
 * idle cost exactly what bytes fetched eagerly cost, plus the round trip.
 *
 * Pointing at, touching or tabbing to a link is the earliest honest evidence
 * that a navigation may happen, and it precedes the click by long enough to
 * cover the work. One delegated listener rather than a handler per link, so
 * anchors rendered by a plugin or a hand-built menu count too; the capture
 * phase, so a link that stops propagation in its own handlers cannot suppress
 * it. Returns the detach function a caller's effect should return.
 */
export function onFirstNavigationIntent(react: () => void): () => void {
  const target = globalThis.document
  if (!target) return () => undefined
  const onIntent = (event: Event) => {
    const node = event.target
    // `closest` reaches the anchor from whatever inside it was pointed at —
    // a label, an icon, a nested span.
    if (!(node instanceof Element) || !node.closest('a[href]')) return
    detach()
    react()
  }
  const detach = () => {
    for (const name of INTENT_EVENTS)
      target.removeEventListener(name, onIntent, true)
  }
  for (const name of INTENT_EVENTS)
    target.addEventListener(name, onIntent, true)
  return detach
}
