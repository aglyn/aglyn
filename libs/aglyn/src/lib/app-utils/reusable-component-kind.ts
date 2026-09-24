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

import {
  REUSABLE_COMPONENT_CATEGORY,
  REUSABLE_EMAIL_BLOCK_CATEGORY,
} from '../foundation/constants/components'
import {
  HostViewType,
  type ReusableComponentKind,
} from '../foundation/definitions/platform.types'

/**
 * Where a reusable component is placed, and every answer that follows from it
 * (AGL-3287) — see {@link ReusableComponentKind}.
 *
 * One module so the questions are answered from one place: which kind a
 * promotion makes, which view a component's own editor opens in, which drawer
 * group offers it, and which starters a new email block can begin from. The
 * console, the designer and the plugins each ask one of them, and a second
 * answer to any would let a component be saved as one kind and offered as the
 * other.
 */

/** Placed on pages: what every component made before AGL-3287 is. */
export const REUSABLE_COMPONENT_KIND_SITE: ReusableComponentKind = 'site'

/** Placed in emails: a reusable email block, such as a header or a footer. */
export const REUSABLE_COMPONENT_KIND_EMAIL: ReusableComponentKind = 'email'

/** Every value a component may be stored with. */
export const REUSABLE_COMPONENT_KINDS: readonly ReusableComponentKind[] = [
  REUSABLE_COMPONENT_KIND_SITE,
  REUSABLE_COMPONENT_KIND_EMAIL,
]

/**
 * The bundle whose blocks an email's drawer offers (AGL-395).
 *
 * The EMAIL view keeps a drawer entry only when the entry's own `pluginId`
 * names this bundle, and every other view drops such an entry. A reusable
 * email block is filed under it for exactly that reason — it is the whole of
 * how one reaches an email's drawer and never a page's.
 */
export const EMAIL_VIEW_BUNDLE_ID = 'email'

/** Whether a value is one a component may be stored with. */
export function isReusableComponentKind(
  value: unknown,
): value is ReusableComponentKind {
  return (REUSABLE_COMPONENT_KINDS as readonly unknown[]).includes(value)
}

/**
 * The kind a component document says it is.
 *
 * Anything but `email` — absent, `site`, or a value no reader knows — is a
 * page component, which is what every component was before the field
 * existed. Reading it any other way would move components nobody touched out
 * of the drawer their pages use.
 */
export function reusableComponentKindOf(
  component: { kind?: unknown } | null | undefined,
): ReusableComponentKind {
  return component?.kind === REUSABLE_COMPONENT_KIND_EMAIL
    ? REUSABLE_COMPONENT_KIND_EMAIL
    : REUSABLE_COMPONENT_KIND_SITE
}

/**
 * The kind a component saved from an editor showing this view is: an email
 * block when it was promoted out of an email, a page component otherwise.
 *
 * The view decides because the view decides what the subtree can be made of.
 * An email's drawer offers email blocks alone, so whatever is promoted there
 * is built from them — and renders in an email and nowhere else.
 */
export function reusableComponentKindForView(
  viewType: unknown,
): ReusableComponentKind {
  return viewType === HostViewType.EMAIL
    ? REUSABLE_COMPONENT_KIND_EMAIL
    : REUSABLE_COMPONENT_KIND_SITE
}

/**
 * The kind a promoted subtree makes, read from the element being promoted:
 * an email block when that element is one of the email bundle's.
 *
 * For a surface that reads the canvas but cannot see the designer's view — a
 * plugin's own save action. It agrees with {@link reusableComponentKindForView}
 * wherever both can be asked, because an email offers email blocks alone and
 * a page never offers one.
 */
export function reusableComponentKindForRoot(
  root: { pluginId?: unknown } | null | undefined,
): ReusableComponentKind {
  return root?.pluginId === EMAIL_VIEW_BUNDLE_ID
    ? REUSABLE_COMPONENT_KIND_EMAIL
    : REUSABLE_COMPONENT_KIND_SITE
}

/**
 * The view a component's own editor opens in.
 *
 * An email block edits in the EMAIL view, so its drawer offers what an
 * email's does and its canvas draws what an email's does. A page component
 * sets none, which leaves the editor in the screen view it has always used —
 * deliberately not LAYOUT, whose slot outlet has nowhere to graft inside a
 * component (AGL-680).
 */
export function reusableComponentEditorView(
  kind: ReusableComponentKind,
): HostViewType | undefined {
  return kind === REUSABLE_COMPONENT_KIND_EMAIL ? HostViewType.EMAIL : undefined
}

/** Where a component's entry sits in the element drawer. */
export interface ReusableComponentPaletteSlot {
  /** The drawer group the entry is listed under. */
  category: string
  /** The bundle the entry is filed under, which the view filter reads. */
  pluginId?: string
}

/**
 * The drawer group and bundle a component's entry is registered with.
 *
 * An email block is filed under {@link EMAIL_VIEW_BUNDLE_ID}, so the EMAIL
 * view keeps it and every other view drops it — the rule the email plugin's
 * own blocks already follow. A page component names no bundle, as it never
 * has: it belongs to no plugin, so the email view drops it and no plugin
 * switch on the site can hide it.
 *
 * Only the ENTRY is filed this way. The node it inserts is an ordinary
 * instance, the same on a page and in an email, which is what lets the
 * canvas draw either through one graft.
 */
export function reusableComponentPaletteSlot(
  kind: ReusableComponentKind,
): ReusableComponentPaletteSlot {
  return kind === REUSABLE_COMPONENT_KIND_EMAIL
    ? { category: REUSABLE_EMAIL_BLOCK_CATEGORY, pluginId: EMAIL_VIEW_BUNDLE_ID }
    : { category: REUSABLE_COMPONENT_CATEGORY }
}

/** What a new email block can start as on the Components page. */
export type ReusableEmailBlockStarter = 'header' | 'footer' | 'blank'

/**
 * The element presets a Header or a Footer email block starts from, by id.
 *
 * Named here and registered by the email plugin, which owns the trees: the
 * Components page builds its starters from the same presets an author drops
 * into an email, so each starter is one tree wherever it is started from.
 * `blank` has no preset — it is the empty canvas every new component opens on.
 */
export const REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS: Readonly<
  Record<Exclude<ReusableEmailBlockStarter, 'blank'>, string>
> = {
  header: 'email:emailSection.header',
  footer: 'email:emailSection.footer',
}
