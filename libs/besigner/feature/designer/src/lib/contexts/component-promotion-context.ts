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

import type * as Aglyn from '@aglyn/aglyn'
import { createContext } from 'react'

/**
 * Host-app callbacks for reusable-component flows (AGL-35). The designer
 * stays storage-agnostic: the console provides `onPromote` ("Save as
 * reusable component" on a selected subtree) and `onDemote` ("Detach" an
 * instance into an editable copy); the Attributes panel shows the actions
 * only when the callbacks exist.
 */
export interface ComponentPromotionContextValue {
  onPromote?: (node: Aglyn.NodeSchema<any>) => void
  onDemote?: (node: Aglyn.NodeSchema<any>) => void
  /**
   * "Edit component" on a selected instance (AGL-1303 phase 1): the
   * console opens the component's own besigner in a new tab. Kills the
   * dead end where the panel offered only Save-as/Detach and an author
   * could not find where the component's truth lives.
   *
   * This comment used to say phase 2's live propagation "rides AGL-1301's
   * co-editing on component documents — no extra plumbing here". That is
   * wrong in two ways, and it was load-bearing enough to mislead whoever
   * picked phase 2 up (AGL-1898). AGL-1301's co-editing DID land for
   * component documents, but its RTDB room is keyed
   * `coedit/{org}/{host}/{docType}/{docId}/…`: a screen besigner subscribes
   * to its own screen's room and never to a component's. Even if it did,
   * the payload is component-internal node ids, not the
   * `cmp__{instance}__{def}` ids a screen renders.
   *
   * The propagation that actually works is unrelated to co-editing:
   * {@link definitions} arrives from a live `onSnapshot` over the host's
   * `components` collection, so an open canvas re-renders its instances
   * when a component's PARENT doc changes. In the component editor, Save
   * writes only the version doc; Publish writes the parent. So today the
   * loop is edit → Save → **Publish** → other tabs update, and a Save alone
   * does nothing anywhere else. Whether Save should propagate is a product
   * question (it would show screen authors component content the live site
   * does not have) and is open on AGL-1898 — not something to infer from
   * this comment.
   */
  onEditComponent?: (node: Aglyn.NodeSchema<any>) => void
  /**
   * The host's component definitions, keyed by id (AGL-1247/1251). The
   * designer stays storage-agnostic: the console reads them and passes them
   * down, exactly as it does the callbacks above.
   *
   * Three consumers, deliberately one field: the Attributes panel reads each
   * definition's declared `props` to build an instance's fields, `NodeLeaf`
   * renders the definition's subtree inside the instance so the canvas shows
   * the component instead of a dashed box, and `ComponentIconComponent`
   * reads its chosen `icon` (AGL-1193). Splitting them would let the panel,
   * the canvas and the hierarchy disagree about what a definition is.
   */
  definitions?: Record<string, Aglyn.ReusableComponentTree | undefined>
  /**
   * The host's FORM entities, keyed by id — the published `rootId`/`nodes`
   * design of each, in the shape the graft consumes
   * (`docs/specs/reusable-forms.md`).
   *
   * Beside {@link definitions} rather than in a context of its own because a
   * placed form and a component instance are one mechanism: both are a node
   * standing for a tree stored on another document, both are expanded by
   * `composeReusableComponentNodes`, and `NodeLeaf` needs both in the same
   * memo — a form design may contain an instance, and a component may contain
   * a placed form. Two contexts would have to be kept in step by hand for a
   * canvas that has to graft them together anyway.
   *
   * `undefined` while the read is still settling, distinct from `{}` for "this
   * host has none": grafting against an empty map would draw the page's own
   * fields and swap them for the entity's a beat later.
   */
  formDesigns?: Record<string, Aglyn.PlacedFormDesign | undefined>
}

export const ComponentPromotionContext =
  createContext<ComponentPromotionContextValue>({})
ComponentPromotionContext.displayName = 'ComponentPromotionContext'

export default ComponentPromotionContext
