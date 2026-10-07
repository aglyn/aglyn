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

import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'

/**
 * A component registered by name whose code loads the first time it is
 * drawn. `load` resolves to the component itself — the module's export —
 * so a spec can hold a registration to the component it stands for.
 */
export type LazyWidget<P = any> = ComponentType<P> & {
  load: () => Promise<ComponentType<P>>
}

/**
 * Registers a component without loading it (AGL-3649).
 *
 * The console loads this plugin on every screen, because it fills the dock
 * and the top bar, so anything `plugin.ts` imports statically is downloaded
 * by every reader of every page, whichever card it is. A registration needs
 * only a name and a component to call; this hands the registry a small
 * stand-in that imports the real one when the shell first draws it.
 *
 * The stand-in carries its own `Suspense`. The shell's zones draw widgets
 * with no boundary of their own, and the dock and the top bar sit above every
 * route's boundary, so a bare `React.lazy` there would suspend the shell
 * itself while one card's code arrived. Here the wait is the card's alone:
 * it draws `fallback` (nothing, unless the caller says otherwise) in its own
 * place, which is what a widget held by a gate already draws.
 *
 * Every gate stays on the registration — feature flag, permission, release
 * flag — so a widget the shell withholds is never drawn and never loaded.
 */
export function lazyWidget<P extends object>(
  name: string,
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
): LazyWidget<P> {
  let loading: Promise<ComponentType<P>> | undefined
  const loadOnce = () => (loading ??= load())
  const Loaded = lazy(() =>
    loadOnce().then((Component) => ({ default: Component })),
  )
  const Widget = (props: P) => (
    <Suspense fallback={fallback}>
      <Loaded {...(props as any)} />
    </Suspense>
  )
  Widget.displayName = name
  Widget.load = loadOnce
  return Widget
}
