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

import { useInsertionEffect, useLayoutEffect, useRef } from 'react'

/**
 * Turns every CSS transition in the document off.
 *
 * Unlayered and `!important`, so it outranks every normal declaration in
 * every cascade layer — MUI's own transitions are normal declarations inside
 * `@layer mui`.
 */
export const SUPPRESS_TRANSITIONS_CSS =
  '*,*::before,*::after{transition:none!important}'

/**
 * Marks the suppressing sheet, so a spec or a person in DevTools can find it.
 */
export const SCHEME_SWAP_ATTRIBUTE = 'data-aglyn-scheme-swap'

/**
 * Adds {@link SUPPRESS_TRANSITIONS_CSS} to `doc` and returns its release.
 *
 * The release restyles the document BEFORE it removes the sheet: reading a
 * computed value makes the browser resolve every element whose style is
 * pending while transitions are still off, so each one lands on its new value
 * outright. Removing the sheet afterwards turns transitions back on for later
 * changes without starting any, because no value differs between the two
 * restyles. Nothing waits for a frame, so the outcome is the same in a tab
 * that is not painting.
 */
export function suppressTransitions(doc: Document): () => void {
  const sheet = doc.createElement('style')
  sheet.setAttribute(SCHEME_SWAP_ATTRIBUTE, '')
  sheet.textContent = SUPPRESS_TRANSITIONS_CSS
  doc.head.appendChild(sheet)
  return () => {
    doc.defaultView?.getComputedStyle(doc.body).getPropertyValue('transition')
    sheet.remove()
  }
}

/**
 * Makes a light/dark swap land on every element at once.
 *
 * A site swaps a single-mode theme between schemes, so a swap re-renders the
 * tree with the other scheme's classes. Most elements simply take the new
 * value. An element that declares a transition on the property instead
 * ANIMATES from the old scheme's value — MUI's animated `InputLabel` (color,
 * 200ms) and its `Button` (background-color) among them — and a document that
 * is not painting never advances that animation. A dark render that hydrates
 * in a background tab, or is read by a tool that never paints, keeps every
 * form label at the light scheme's `rgba(0,0,0,0.6)` on a dark card
 * (AGL-3449); a visible one shows the labels trailing the rest of the page.
 *
 * The sheet goes in from an insertion effect, which React runs while it is
 * still applying the commit's DOM changes and before any layout effect can
 * read a style — a child's layout effect that measures (`TextareaAutosize`
 * does, on every render) already restyles the document, and it must find
 * transitions off when it does. The release runs from this hook's own layout
 * effect, which React runs after every child's.
 *
 * The first render is left alone: there is no previous scheme to animate
 * from, and the server-rendered document must hydrate untouched.
 */
export function useInstantSchemeSwap(scheme: 'light' | 'dark'): void {
  const committed = useRef(scheme)
  const release = useRef<(() => void) | null>(null)

  useInsertionEffect(() => {
    if (committed.current === scheme) return
    committed.current = scheme
    release.current?.()
    release.current = suppressTransitions(document)
  }, [scheme])

  useLayoutEffect(() => {
    release.current?.()
    release.current = null
  }, [scheme])
}
