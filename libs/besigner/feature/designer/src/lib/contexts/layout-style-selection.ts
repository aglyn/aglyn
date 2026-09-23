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

import * as Besigner from '@aglyn/besigner'
import { makeAutoObservable, reaction } from 'mobx'

/**
 * The shared-layout element a screen's author is restyling for this page
 * (AGL-3286).
 *
 * A layout's elements are not on the screen canvas — they render from a
 * separate, read-only chrome canvas — so they can never be the focus store's
 * selection, and the panels could not name one. This is that selection, in
 * the one "styles only" mode the page allows: while it is set the right
 * panel's Styles tab edits the page's override for this element, and the
 * Attributes and Interactions tabs say where the element's content is edited.
 */
export interface LayoutElementSelection {
  /** The layout document the element belongs to. */
  layoutId: string
  /** The layout's display name, for the panel's prose. */
  layoutName?: string
  /** The element's id in the LAYOUT's own node map. */
  nodeId: string
  /** The element's name as the hierarchy shows it. */
  label: string
}

class LayoutStyleSelectionStore {
  current: LayoutElementSelection | null = null
  private disposeFollow: (() => void) | null = null

  constructor() {
    makeAutoObservable<LayoutStyleSelectionStore, 'disposeFollow'>(this, {
      disposeFollow: false,
    })
  }

  /**
   * Targets one layout element. Clears the screen selection first — the two
   * are one selection as far as the author is concerned — and ends the
   * layout mode as soon as anything on the screen is selected again, so
   * clicking a page element always lands on that element.
   */
  select(selection: LayoutElementSelection) {
    Besigner.focus.clearSelection()
    this.current = selection
    this.disposeFollow?.()
    this.disposeFollow = reaction(
      () => Besigner.focus.getLastSelected()?.$id,
      (id) => {
        if (id) this.clear()
      },
    )
  }

  clear() {
    this.disposeFollow?.()
    this.disposeFollow = null
    this.current = null
  }
}

export const layoutStyleSelection = new LayoutStyleSelectionStore()

export default layoutStyleSelection
