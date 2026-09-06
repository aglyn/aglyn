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

import {
  CRM_COLLECTIONS,
  CRM_VIEW_NAME_MAX,
  type CrmViewFilterClause,
  type CrmViewSection,
  type CrmViewSort,
  type CrmViewState,
  crmViewStateEquals,
  EMPTY_CRM_VIEW_STATE,
  ORG_SCOPE_TOKEN,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { crmRoutes } from '../model/crm-routes'
import { crmViewHref, crmViewIdFromParams } from '../model/crm-view-param'
import { type CrmOrgDoc, useCrmScope } from './use-crm-scope'
import { useCrmDefaultView } from './use-crm-default-view'
import { type CrmSavedViewRow, useCrmViews } from './use-crm-views'

/**
 * The address value that means "no view, whatever my default is".
 *
 * Without it, choosing the plain list would clear the key and the default
 * would reapply on the next render — the reader could never leave their
 * own default. Written only when a default exists to be overridden, so an
 * address stays clean for a reader who never set one.
 */
export const CRM_VIEW_NONE = 'all'

/** What a section holds of its saved views, and can do with them. */
export interface CrmSavedViewController {
  section: CrmViewSection
  /** Mine and shared, by name. */
  views: CrmSavedViewRow[]
  /** Whether the listing has settled — a missing view is not missing until it has. */
  ready: boolean
  /** The view the list is showing, when the address or the default names a listed one. */
  current: CrmSavedViewRow | null
  /** The id the address names, listed or not. */
  currentId: string | null
  /** The address names a view the listing does not carry. */
  missing: boolean
  /** The list's working state: what the reader has narrowed, shown and sorted. */
  state: CrmViewState
  setFilters: (filters: CrmViewFilterClause[]) => void
  setColumns: (columns: string[]) => void
  setSort: (sort: CrmViewSort | null) => void
  /** The working state differs from the view it started from. */
  dirty: boolean
  /** The reader may change or remove the current view — its creator, or an org-wide member. */
  canEdit: boolean
  uid: string | null
  /** Open a view by id, or the plain list with `null`. */
  select: (viewId: string | null) => void
  /** Back to the view's saved state, or the plain list's. */
  reset: () => void
  save: () => Promise<void>
  /** Creates, opens, and answers with the new id. */
  saveAs: (name: string, shared: boolean) => Promise<string | null>
  rename: (name: string) => Promise<void>
  setShared: (shared: boolean) => Promise<void>
  remove: () => Promise<void>
  defaultViewId: string | null
  isDefault: boolean
  setDefault: (viewId: string | null) => Promise<void>
  /** A write is in flight. */
  busy: boolean
}

/**
 * One section's saved views, resolved against its address (AGL-2617).
 *
 * The controller behind the views control on every CRM list. It owns three
 * things the list used to keep in loose state and lose on reload: which
 * view is open, what the reader has changed since, and how that gets back
 * to the document.
 *
 * ## The address is the truth about which view is open
 *
 * `?view=<id>` names the view; choosing one navigates. So a view is a link,
 * Back returns to the one before it, and a reload lands where the reader
 * was. When the address names nothing, the reader's default for this
 * section (their own profile's) opens instead — unless the list was opened
 * FOR something, a form's captures or one address, in which case the plain
 * list shows what it was asked for and nothing narrows it further.
 *
 * ## The seed is kept, first
 *
 * A Contacts address that carries a seed and a view means both: the seed's
 * clause leads the view's, so the query serves the seed (it reaches the
 * whole collection, as it did before views existed) and the view narrows
 * the window. That is why `initial` folds into every baseline rather than
 * being a starting state the view replaces.
 *
 * ## A view's state is applied once per view
 *
 * When the address names a view, its stored filters, columns and sort
 * become the working state the moment the listing carries it — once. A
 * later change to the document does not overwrite what the reader is in
 * the middle of; a change the reader makes is theirs until they save it or
 * reset. The default applies only onto an untouched plain list, so a reader
 * who started narrowing before their profile arrived keeps what they typed.
 */
export function useCrmSavedView(options: {
  section: CrmViewSection
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  org?: CrmOrgDoc
  /** The CRM hub path the section hangs beneath — what the address is built from. */
  basePath: string
  /** What the list was opened for: clauses every baseline keeps in front. */
  initial?: Partial<CrmViewState>
}): CrmSavedViewController {
  const { section, hostId, org, basePath } = options
  const initialFilters = options.initial?.filters ?? EMPTY_CRM_VIEW_STATE.filters
  const initialColumns = options.initial?.columns ?? EMPTY_CRM_VIEW_STATE.columns
  const initialSort = options.initial?.sort ?? EMPTY_CRM_VIEW_STATE.sort
  const seeded = initialFilters.length > 0

  const firestore = useFirestore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? null
  const { scope, orgId, visibleTo, createTokens } = useCrmScope({ hostId, org })
  const reach = useScopeTokens(orgId ?? undefined)
  const { views, ready } = useCrmViews({ scope, visibleTo, section, uid })
  const {
    defaultViewId,
    ready: defaultReady,
    setDefault: writeDefault,
  } = useCrmDefaultView({ uid, orgId, section })

  const sectionPath = useMemo(
    () => crmRoutes(basePath).section(section),
    [basePath, section],
  )

  /*
   * Which view the address asks for. `all` is the reader stepping out of
   * their default on purpose; nothing at all defers to the default, except
   * on a seeded list, which shows what it was opened for.
   */
  const addressed = crmViewIdFromParams(searchParams)
  const currentId =
    addressed === CRM_VIEW_NONE
      ? null
      : addressed ?? (seeded ? null : defaultViewId)
  const current = useMemo(
    () => (currentId ? views.find((view) => view.$id === currentId) ?? null : null),
    [views, currentId],
  )
  const missing = Boolean(currentId) && ready && defaultReady && !current

  /** What the list opens on for a view — the seed in front — or for none. */
  const baseline = useCallback(
    (view: CrmSavedViewRow | null): CrmViewState =>
      view
        ? {
            filters: [...initialFilters, ...view.filters],
            columns: view.columns.length ? view.columns : initialColumns,
            sort: view.sort ?? initialSort,
          }
        : { filters: initialFilters, columns: initialColumns, sort: initialSort },
    [initialFilters, initialColumns, initialSort],
  )

  const [state, setState] = useState<CrmViewState>(() => baseline(null))
  /** The view whose state the working state was last set from — `''` for none. */
  const applied = useRef<string>('')
  const dirty = !crmViewStateEquals(state, baseline(current))

  useEffect(() => {
    const target = current?.$id ?? ''
    if (applied.current === target) return
    // A default arriving under a list the reader already narrowed is not
    // allowed to take that narrowing away; an explicit choice always is.
    if (target && !addressed && dirty) return
    applied.current = target
    setState(baseline(current))
  }, [current, addressed, dirty, baseline])

  const setFilters = useCallback(
    (filters: CrmViewFilterClause[]) => setState((prev) => ({ ...prev, filters })),
    [],
  )
  const setColumns = useCallback(
    (columns: string[]) => setState((prev) => ({ ...prev, columns })),
    [],
  )
  const setSort = useCallback(
    (sort: CrmViewSort | null) => setState((prev) => ({ ...prev, sort })),
    [],
  )
  const reset = useCallback(() => setState(baseline(current)), [baseline, current])

  const select = useCallback(
    (viewId: string | null) => {
      // Leaving a view for the plain list under a default has to SAY so,
      // or the default would reopen on the next render.
      const value = viewId ?? (defaultViewId ? CRM_VIEW_NONE : null)
      router.push(crmViewHref(sectionPath, searchParams, value))
    },
    [router, sectionPath, searchParams, defaultViewId],
  )

  const [busy, setBusy] = useState(false)
  const guarded = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try {
      return await work()
    } finally {
      setBusy(false)
    }
  }, [])

  const viewRef = useCallback(
    (viewId: string) =>
      scope ? doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.views, viewId) : null,
    [firestore, scope],
  )

  /** The three list-facing fields as the document stores them — without the seed. */
  const stored = useCallback(
    (): CrmViewState => ({
      // The seed is the address's, not the view's: a view saved while a
      // form's captures were open must not carry that form forever.
      filters: state.filters.filter(
        (clause) =>
          !initialFilters.some(
            (seed) =>
              seed.field === clause.field &&
              seed.op === clause.op &&
              seed.value === clause.value,
          ),
      ),
      columns: state.columns,
      sort: state.sort,
    }),
    [state, initialFilters],
  )

  const save = useCallback(async () => {
    const ref = current ? viewRef(current.$id) : null
    if (!ref) return
    await guarded(() => updateDoc(ref, { ...stored(), updatedAt: new Date() }))
  }, [current, viewRef, guarded, stored])

  const saveAs = useCallback(
    async (name: string, shared: boolean) => {
      const trimmed = name.trim().slice(0, CRM_VIEW_NAME_MAX)
      if (!trimmed || !scope || !uid) return null
      const created = await guarded(() =>
        addDoc(collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.views), {
          section,
          name: trimmed,
          ...stored(),
          ownerUid: uid,
          createdByUid: uid,
          shared,
          // A view made at the organization level belongs to the org
          // (AGL-2630): it names no site, and it is stamped org-wide so
          // every site's reader lists it — unlike a record, a view is a
          // working arrangement, not a person's data.
          hostId: hostId ?? null,
          visibleTo: hostId ? createTokens : [ORG_SCOPE_TOKEN],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      )
      // The new view's state IS the working state, so nothing is lost when
      // the address changes and the listing catches up.
      applied.current = created.id
      select(created.id)
      return created.id
    },
    [scope, uid, guarded, firestore, section, stored, hostId, createTokens, select],
  )

  const rename = useCallback(
    async (name: string) => {
      const trimmed = name.trim().slice(0, CRM_VIEW_NAME_MAX)
      const ref = current ? viewRef(current.$id) : null
      if (!trimmed || !ref) return
      await guarded(() => updateDoc(ref, { name: trimmed, updatedAt: new Date() }))
    },
    [current, viewRef, guarded],
  )

  const setShared = useCallback(
    async (shared: boolean) => {
      const ref = current ? viewRef(current.$id) : null
      if (!ref) return
      await guarded(() => updateDoc(ref, { shared, updatedAt: new Date() }))
    },
    [current, viewRef, guarded],
  )

  const isDefault = Boolean(currentId) && defaultViewId === currentId

  const setDefault = useCallback(
    async (viewId: string | null) => {
      await guarded(() => writeDefault(viewId))
    },
    [guarded, writeDefault],
  )

  const remove = useCallback(async () => {
    const ref = current ? viewRef(current.$id) : null
    if (!ref || !current) return
    await guarded(async () => {
      await deleteDoc(ref)
      // A default pointing at nothing would open every visit on "missing".
      if (defaultViewId === current.$id) await writeDefault(null)
    })
    applied.current = ''
    select(null)
  }, [current, viewRef, guarded, defaultViewId, writeDefault, select])

  const canEdit = Boolean(
    current &&
      uid &&
      (current.createdByUid === uid || (reach.loaded && reach.orgWide)),
  )

  return {
    section,
    views,
    ready: ready && defaultReady,
    current,
    currentId,
    missing,
    state,
    setFilters,
    setColumns,
    setSort,
    dirty,
    canEdit,
    uid,
    select,
    reset,
    save,
    saveAs,
    rename,
    setShared,
    remove,
    defaultViewId,
    isDefault,
    setDefault,
    busy,
  }
}

export default useCrmSavedView
