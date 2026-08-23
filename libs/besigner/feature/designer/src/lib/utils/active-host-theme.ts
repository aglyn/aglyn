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

import { useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { useEffect, useSyncExternalStore } from 'react'

/**
 * The editor's current site theme, reachable from OUTSIDE the page tree
 * (AGL-2486).
 *
 * `HostThemeDocumentContext` is provided inside the besigner PAGE, but
 * `withBesignerContext` wraps that page — so `ComponentsDrawerContextProvider`,
 * and the Choose-element dialog it renders, are ancestors of the provider
 * rather than descendants. React context flows through portals, so the
 * dialog's mounting is not the problem; its ANCESTRY is. The consequence was
 * that the dialog's element preview fell back to the console's own brand and
 * painted an Aglyn-cyan header for a site whose brand is brown — a preview
 * showing the wrong colours is worse than no preview, because it sends an
 * author to a component they believe matches their site.
 *
 * A register rather than another context, because another context would have
 * exactly the same ancestry problem. One editor renders one site at a time,
 * which is what makes a module-scoped value correct here rather than merely
 * convenient — and the context is still preferred wherever it IS available,
 * so this only ever fills the gap.
 */
let activeHostTheme: unknown = undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function getSnapshot() {
  return activeHostTheme
}

/** Server render has no editor, so there is no theme to report. */
function getServerSnapshot() {
  return undefined
}

export function publishActiveHostTheme(doc: unknown) {
  if (activeHostTheme === doc) return
  activeHostTheme = doc
  listeners.forEach((listener) => listener())
}

export function useActiveHostTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Publishes the page's host theme for surfaces that sit outside the page.
 * Call from a component mounted INSIDE `HostThemeDocumentContext.Provider`.
 */
export function usePublishActiveHostTheme() {
  const doc = useHostThemeDocument()
  useEffect(() => {
    publishActiveHostTheme(doc)
  }, [doc])
}

/**
 * The site theme document, preferring real context and falling back to the
 * register. Use this anywhere a preview may be rendered outside the page.
 */
export function useResolvedHostThemeDocument() {
  const fromContext = useHostThemeDocument()
  const fromRegister = useActiveHostTheme()
  return (fromContext ?? fromRegister) as any
}
