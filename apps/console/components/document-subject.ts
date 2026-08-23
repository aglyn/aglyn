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

/**
 * WHICH entity the current route is about, for the browser tab (AGL-2486).
 *
 * ## Why the client supplies the name, and the server does not
 *
 * `generateMetadata` runs on the server and could turn `screenId` into a
 * screen name with one Firestore read. It deliberately does not, and this is
 * the substantive decision in AGL-2486 rather than a performance dodge:
 *
 * **The console has no server-side authorization to spend.** `middleware.ts`
 * is a host/slug gate and a CSP; its own docblock says "in-app org scoping
 * stays client-side (OrgScopeProvider)". The auth gate is `AuthenticatedLayout`
 * in `(app)/layout.tsx`, which is `'use client'` — so an ANONYMOUS GET of a
 * besigner URL returns 200 with the server-rendered `<head>`. That is not
 * speculation; it is the documented premise of `listing-social-card.ts`, which
 * exists because marketplace links unfurl for logged-out crawlers.
 *
 * A server-rendered screen name would therefore be readable by anyone who can
 * guess a URL. The console's one data-reading `generateMetadata` — the
 * marketplace social card — is safe precisely because a browsable listing is
 * public by design, and it still needed an explicit visibility gate because
 * the Admin SDK bypasses Firestore rules. A screen's name is not public. To
 * read one safely on the server we would have to verify the `__session`
 * cookie, resolve which Firebase tenant minted it (`__session_tenant`), check
 * org membership, then check host access — a NEW security boundary, on the
 * render path, duplicated across 21 routes, whose failure mode is silent
 * disclosure. For a browser tab.
 *
 * The client already holds the answer. Every one of these routes loads the
 * entity anyway, through rules-enforced reads by a signed-in user, and every
 * document type carries `displayName`. So the name costs one more render and
 * zero new reads, and it cannot show a viewer a name they could not already
 * see — because they are looking at the document it came from.
 *
 * ## Why an external store rather than a context
 *
 * `ConsoleBrandingEffects` — where the rewrite lands — is a SIBLING of
 * `{children}` in `providers.tsx`, not an ancestor, so a context would have to
 * be threaded around both and would re-render the whole console subtree on
 * every subject change. `useSyncExternalStore` lets just that component
 * subscribe and nothing else re-render. It also keeps its existing standalone
 * unit test honest: with no page mounted the store is empty, so
 * `white-label-tab-title.spec.tsx` exercises exactly the behaviour it did
 * before.
 *
 * ## The title has TWO writers, not one
 *
 * Worth knowing before adding a third. `ConsoleBrandingEffects` performs the
 * brand and subject rewrites; `notifications-menu.component.tsx` prepends the
 * unread badge. Both defend their work with a `<head>` MutationObserver, and
 * they converge rather than loop only because each is idempotent and strips
 * before it re-applies. Anything new that wants to change the tab belongs
 * inside one of those two passes, not in a third observer.
 */

import { useEffect, useSyncExternalStore } from 'react'

export interface DocumentSubject {
  /** The id from the URL — the subject the SERVER put in the title. */
  id: string
  /** The loaded display name that should replace it. */
  name: string
}

/**
 * The current subject, or null.
 *
 * Held as one frozen object replaced wholesale, never mutated:
 * `useSyncExternalStore` compares snapshots by identity, and returning a fresh
 * object per call is the documented way to make it loop forever.
 */
let current: DocumentSubject | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Trimmed, or `''` for anything that is not a live string. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Publishes the subject, or clears it with `null`.
 *
 * A no-op when nothing actually changed — the callers are effects that run on
 * every render of a page whose data is still settling, and emitting an
 * identical subject would wake the owner for nothing.
 */
export function setDocumentSubject(next: DocumentSubject | null): void {
  const id = clean(next?.id)
  const name = clean(next?.name)
  // A name we do not have yet is not a subject: the server's id title already
  // distinguishes the tab, and publishing a half-loaded value would flicker
  // the tab through a wrong name on the way to the right one.
  const resolved = id && name ? Object.freeze({ id, name }) : null
  if (resolved?.id === current?.id && resolved?.name === current?.name) return
  current = resolved
  emit()
}

/** The snapshot `useSyncExternalStore` reads. Stable between changes. */
export function getDocumentSubject(): DocumentSubject | null {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Subscribes to the subject. For the ONE owner of `document.title`.
 *
 * The server snapshot is `null` so SSR renders the title the server built,
 * which is the whole point — the id title is the correct first paint.
 */
export function useDocumentSubject(): DocumentSubject | null {
  return useSyncExternalStore(subscribe, getDocumentSubject, () => null)
}

/**
 * Declares what the current page is about. For a PAGE component.
 *
 * Call it unconditionally with whatever is known this render — the hook
 * tolerates a name that is still loading (`undefined`) and simply leaves the
 * server's id title in place until one arrives. Clears on unmount so a
 * navigation away cannot strand the previous page's name in the tab.
 */
export function useDeclareDocumentSubject(
  id: string | undefined,
  name: string | undefined,
): void {
  useEffect(() => {
    setDocumentSubject({ id: clean(id), name: clean(name) })
    return () => setDocumentSubject(null)
  }, [id, name])
}

/** Test seam: drops the subject and every subscriber. */
export function resetDocumentSubject(): void {
  current = null
  listeners.clear()
}
