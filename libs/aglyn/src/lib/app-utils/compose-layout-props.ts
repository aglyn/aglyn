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

import type {
  AglynNodeSchema,
  NodeId,
  ReusableComponentProp,
} from '../foundation'
import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import { composeLayoutChainAndScreenNodes } from './compose-layout-nodes'
import { applyDeclaredProps } from './compose-reusable-components'
import {
  applyLayoutStyleOverrides,
  layoutStyleOverridesFor,
} from './layout-style-overrides'

/**
 * Layout properties (AGL-2893): a shared layout declares properties exactly as
 * a reusable component does, binds its own nodes to them with `{{prop.*}}`,
 * and each screen rendering inside it sets the values.
 *
 * The values are applied to each layout's OWN nodes before the screen is
 * grafted into its slot, so a `{{prop.*}}` the screen's own copy happens to
 * contain is never touched, and a component the layout places receives the
 * values it is handed before it is grafted.
 */

type NormalizedNodes<N extends AglynNodeSchema> = Record<NodeId, N>

/**
 * Screen-version key holding the screen's values for the layouts it renders
 * inside, beside the `layoutId` binding. Persisted in screen version documents
 * — never rename.
 */
export const SCREEN_LAYOUT_PROP_VALUES_KEY = 'layoutPropValues'

/** One layout of a screen's chain, as composition reads it. */
export interface LayoutChainEntry<N extends AglynNodeSchema = AglynNodeSchema> {
  /** The layout document's id, which a screen's values are keyed by. */
  layoutId?: string | null
  /** The published version's nodes. */
  nodes?: NormalizedNodes<N> | null
  /** The published version's declared properties. */
  props?: ReusableComponentProp[] | null
}

/**
 * A screen's values for one layout of its chain, or `undefined` where it set
 * none. Anything that is not a map of values is read as none.
 */
export function layoutPropValuesFor(
  layoutPropValues: unknown,
  layoutId: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!layoutId || !layoutPropValues || typeof layoutPropValues !== 'object') {
    return undefined
  }
  const values = (layoutPropValues as Record<string, unknown>)[layoutId]
  return values && typeof values === 'object' && !Array.isArray(values)
    ? (values as Record<string, unknown>)
    : undefined
}

/**
 * A layout's nodes with its declared properties applied for one screen: each
 * `{{prop.*}}` takes the screen's value or the property's default, a field
 * bound to one property receives the value its kind holds, and the parts the
 * screen hides (`hideIf` / `hideUnless`) are pruned — the sequence a reusable
 * component's graft runs, over the layout's root.
 *
 * A layout with no root is returned as it is, for the reason
 * `composeLayoutAndScreenNodes` gives: a broken layout degrades to the bare
 * screen rather than taking a page down.
 */
export function applyLayoutProps<N extends AglynNodeSchema = AglynNodeSchema>(
  nodes: NormalizedNodes<N> | null | undefined,
  props: ReusableComponentProp[] | null | undefined,
  values: Readonly<Record<string, unknown>> | null | undefined,
): NormalizedNodes<N> | undefined {
  if (!nodes || !nodes[NODE_ROOT_ID]) return nodes ?? undefined
  return applyDeclaredProps(nodes, props, values, NODE_ROOT_ID)
}

/**
 * A screen grafted through its whole layout chain, innermost first, with each
 * layout's properties applied from the screen's values for that layout
 * (`layoutPropValues`, keyed by layout id), and then the screen's per-page
 * restyling of that layout's elements (`layoutStyleOverrides`, AGL-3286) —
 * after the properties, so a page's style wins over whatever a property
 * bound, and before the graft, so an element the layout hides for this page
 * is simply not there to be styled.
 *
 * The one composition the published page, the besigner's Preview and its
 * layout chrome all run, so none of them can disagree about which value a
 * layout renders with.
 */
export function composeLayoutChainWithProps<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  chain: ReadonlyArray<LayoutChainEntry<N> | null | undefined>,
  screenNodes: NormalizedNodes<N>,
  layoutPropValues?: unknown,
  layoutStyleOverrides?: unknown,
): NormalizedNodes<N> {
  return composeLayoutChainAndScreenNodes(
    chain.map((entry) =>
      applyLayoutStyleOverrides(
        applyLayoutProps(
          entry?.nodes,
          entry?.props,
          layoutPropValuesFor(layoutPropValues, entry?.layoutId),
        ),
        layoutStyleOverridesFor(layoutStyleOverrides, entry?.layoutId),
      ),
    ),
    screenNodes,
  )
}

export default composeLayoutChainWithProps
