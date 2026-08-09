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
 * Whether a collection may be deleted, and what to say when it may not
 * (AGL-1324).
 *
 * A collection could be created and never deleted: "New collection" existed,
 * no delete affordance did anywhere, so a mis-created collection was
 * permanent — a one-way door in an ordinary authoring flow for a no-code
 * product.
 *
 * The delete itself is the easy half; `/api/resources/erase` already
 * recursiveDeletes a collection subtree for the commerce catalog card. This
 * file is the hard half: deciding when it must NOT happen. It is pure and
 * lives beside `collection-kind` / `collection-slug` for the same reason
 * `eraseScopeDenial` lives beside its route — a destructive decision that
 * cannot be unit-tested is the shape of control this project exists to
 * avoid — and because BOTH sides need it: the console dialog to show the
 * blockers before the button is armed, and the route to enforce them.
 *
 * ## Why blocking, not cascading
 *
 * Both blockers refuse. The alternative — delete the collection and take its
 * entries and its published routes with it — makes destroying a live page a
 * side effect of tidying up a list, and no consent given to the second act
 * was given to the first. This repo already settled that argument for
 * account erasure (`userErasureBlockers`): blocking is recoverable, a
 * cascade is not. Emptying a collection is two clicks; un-deleting a
 * published page is a restore from an export.
 */

/** What a template binding drives — which public route it publishes. */
export type CollectionTemplateRole = 'list' | 'entry'

/** A screen as far as this decision cares: does it exist, and what's it called. */
export interface CollectionTemplateScreen {
  displayName?: string
  /**
   * Soft-deleted screens render nothing, so a binding to one is stale and
   * must not block — otherwise deleting a screen makes its collection
   * permanently undeletable, which is the bug this file exists to fix,
   * one level up.
   */
  deletedAt?: unknown
}

export interface CollectionTemplateBinding {
  role: CollectionTemplateRole
  screenId: string
  /** The screen's name; falls back to the id when it has none. */
  screenName: string
}

/** The collection fields that point at a template screen. */
export interface CollectionTemplateSource {
  listScreenId?: unknown
  entryScreenId?: unknown
  /** Superseded AGL-105 pointer; still honoured as the entry fallback. */
  templateScreenId?: unknown
}

const asId = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * The LIVE template bindings on a collection — the screens that would be
 * left publishing an empty route if it were deleted.
 *
 * `screens` is required rather than defaulted because the sole reason a
 * binding is dropped here is that its screen is gone, and an empty map means
 * "every screen is gone". Defaulting it would make the safe-looking call the
 * one that silently answers "nothing depends on this". Callers pass the
 * screens they read: the route fetches exactly the bound ids, the console
 * already holds the host's screen list.
 *
 * Mirrors `resolveCollectionTemplateScreenId` in tenant-runtime: the list
 * route uses `listScreenId` only, the entry route uses `entryScreenId` with
 * `templateScreenId` as the legacy fallback. Deduped by screen id, because
 * one screen serving both routes is one thing to detach, not two.
 */
export function collectionTemplateBindings(
  data: CollectionTemplateSource | undefined | null,
  screens: Readonly<Record<string, CollectionTemplateScreen | undefined>>,
): CollectionTemplateBinding[] {
  const listScreenId = asId(data?.listScreenId)
  // `||`, not `??`: the console writes `deleteField()` to clear, but an
  // empty string has meant "cleared" in older documents too.
  const entryScreenId = asId(data?.entryScreenId) || asId(data?.templateScreenId)

  const bindings: CollectionTemplateBinding[] = []
  const seen = new Set<string>()
  for (const [role, screenId] of [
    ['list', listScreenId],
    ['entry', entryScreenId],
  ] as const) {
    if (!screenId || seen.has(screenId)) continue
    const screen = screens[screenId]
    if (!screen || screen.deletedAt) continue
    seen.add(screenId)
    bindings.push({
      role,
      screenId,
      screenName: asId(screen.displayName) || screenId,
    })
  }
  return bindings
}

/** Why a delete was refused, for callers that need more than the sentence. */
export type CollectionDeleteBlocker = 'template-bound' | 'has-entries'

export interface CollectionDeleteInput {
  /** The collection's name, so the message names what it is refusing. */
  displayName: string
  /** How many entries still live under it. */
  entryCount: number
  /** Live template bindings — see {@link collectionTemplateBindings}. */
  bindings: readonly CollectionTemplateBinding[]
}

export interface CollectionDeleteDenial {
  error: string
  /** 409: the request is well-formed, the resource's state refuses it. */
  status: 409
  blockers: CollectionDeleteBlocker[]
}

const describeBinding = (binding: CollectionTemplateBinding) =>
  `"${binding.screenName}" (${binding.role} template)`

/**
 * Null when the collection may be deleted; otherwise the response to return.
 *
 * Both blockers are reported at once. Fixing one and being told about the
 * other is two trips through a destructive dialog to learn a fact that was
 * knowable on the first — and the second refusal, arriving after the user
 * has already detached a template, reads as the product changing its mind.
 */
export function collectionDeleteDenial(
  input: CollectionDeleteInput,
): CollectionDeleteDenial | null {
  const { displayName, entryCount, bindings } = input
  const name = displayName || 'This collection'
  const blockers: CollectionDeleteBlocker[] = []
  const sentences: string[] = []

  // Severity order: a bound template is a published page that stops
  // rendering; entries are data that merely becomes unreachable.
  if (bindings.length) {
    blockers.push('template-bound')
    sentences.push(
      `"${name}" is still the source for ${bindings
        .map(describeBinding)
        .join(' and ')}. Clear ${
        bindings.length > 1 ? 'those templates' : 'that template'
      } on the collection first — deleting it now would leave a published ` +
        'page with nothing to render.',
    )
  }

  if (entryCount > 0) {
    blockers.push('has-entries')
    sentences.push(
      `"${name}" still has ${entryCount} ${
        entryCount === 1 ? 'entry' : 'entries'
      }. Delete ${
        entryCount === 1 ? 'it' : 'them'
      } first — deleting a collection never removes published entries for ` +
        'you.',
    )
  }

  if (!blockers.length) return null
  return { error: sentences.join(' '), status: 409, blockers }
}

export default collectionDeleteDenial
