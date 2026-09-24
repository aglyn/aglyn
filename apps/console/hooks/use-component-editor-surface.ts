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

import type { HostViewType, ReusableComponentKind } from '@aglyn/aglyn'
// Deep path, keeping the barrel out of whatever imports this hook.
import {
  EMAIL_VIEW_BUNDLE_ID,
  reusableComponentEditorView,
  reusableComponentKindOf,
  REUSABLE_COMPONENT_KIND_EMAIL,
} from '@aglyn/aglyn/app-utils/reusable-component-kind'
import { useEffect, useState } from 'react'
import { consolePluginLoader } from '../constants/console-plugin-loader'

/** How a reusable component's own editor opens. */
export interface ComponentEditorSurface {
  /** Where the component is placed: on pages, or in emails. */
  kind: ReusableComponentKind
  /** The canvas view to edit it in; undefined leaves the editor's default. */
  viewType: HostViewType | undefined
  /**
   * Whether the canvas may be drawn: the component has been read, so its
   * kind is known, and the elements that kind is built from are registered.
   */
  ready: boolean
}

/**
 * How a reusable component's own editor opens (AGL-3287).
 *
 * An email block edits in the EMAIL view, so its drawer offers what an
 * email's does and a page element cannot be dropped into a block no page will
 * ever show. It also needs the email plugin's canvas half, which the site
 * plugin gate loads only when the site has that plugin on — so it is loaded
 * here the way the site's email editor loads it, and the canvas waits for it
 * rather than drawing a tree of unregistered elements.
 *
 * A page component keeps the view the component editor has always used, and
 * waits on nothing but its own document.
 *
 * `loaded` is the component document's read having settled: until it has,
 * the kind is unknown, and a canvas drawn in the page view first would offer
 * page elements for a moment and then take them away.
 */
export function useComponentEditorSurface(
  component: { kind?: unknown } | null | undefined,
  loaded: boolean,
): ComponentEditorSurface {
  const kind = reusableComponentKindOf(component)
  const needsEmailBlocks = loaded && kind === REUSABLE_COMPONENT_KIND_EMAIL
  const [emailBlocksReady, setEmailBlocksReady] = useState(false)

  useEffect(() => {
    if (!needsEmailBlocks) return undefined
    let active = true
    void consolePluginLoader
      .ensure([EMAIL_VIEW_BUNDLE_ID], ['site'])
      .then(() => {
        if (active) setEmailBlocksReady(true)
      })
    return () => {
      active = false
    }
  }, [needsEmailBlocks])

  return {
    kind,
    viewType: reusableComponentEditorView(kind),
    ready: loaded && (!needsEmailBlocks || emailBlocksReady),
  }
}

export default useComponentEditorSurface
