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

import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import useCurrentOrg from '../hooks/use-current-org'
import {
  EMPTY_DASHBOARD_WIDGET_PREFS,
  moveDashboardWidget,
  readDashboardWidgetPrefs,
  setDashboardWidgetHidden,
  type DashboardWidgetPrefs,
} from '../utils/dashboard-widgets'

/**
 * The user-document field holding every workspace's dashboard arrangement,
 * as `{ [orgId]: { hidden, order } }`.
 *
 * ## Per USER, per ORG
 *
 * The person choosing is the user; the catalog they are choosing from belongs
 * to the org. Which cards exist at all is decided by the org's plugin
 * switchboard and the org's entitlements, so an arrangement only means
 * anything against one workspace's catalog. An agency member in six client
 * workspaces would otherwise carry one list of ids across six different sets
 * of installed plugins, where hiding a card for one client hides it for
 * every other.
 *
 * PER SITE was considered and rejected. A merchant running twelve sites does
 * not want to arrange twelve dashboards, and per-site enablement does not
 * argue for it either: a site with `accounts` switched off simply never
 * offers that card, so the id sits in the preference matching nothing. That
 * is the whole benefit of storing what is hidden — a preference is allowed to
 * name cards this site does not have.
 *
 * ## Why the user document and not the membership row
 *
 * `users/{uid}/orgs/{orgId}` is the user-by-org join and looks like the
 * natural home. It is `allow write: if false` — the membership API maintains
 * it transactionally with the member doc — so its owner cannot write there
 * and a membership resync would overwrite anything that was. `users/{uid}`
 * itself is owner read/write, which is where the other per-user preference
 * this console keeps server-side (`notificationPrefs`) already lives, and
 * needs no rules change to hold one more field.
 */
export const DASHBOARD_WIDGETS_FIELD = 'dashboardWidgets'

export interface DashboardWidgetPrefsValue {
  prefs: DashboardWidgetPrefs
  /**
   * The stored preference has arrived (or there is nobody to have one).
   *
   * Slots withhold their widgets until this is true. The alternative is to
   * render everything and then remove what is hidden, which draws a card and
   * takes it away again — and the dashboard's widgets are already held behind
   * the org read for entitlement, so this settles inside a window that exists
   * anyway rather than adding one.
   */
  ready: boolean
  /** True where a `DashboardWidgetPrefsProvider` is actually mounted. */
  customizable: boolean
  setHidden: (widgetId: string, hidden: boolean) => void
  move: (
    groupIds: readonly string[],
    widgetId: string,
    delta: number,
  ) => void
}

/**
 * Inert by default, which is what makes the provider the opt-in.
 *
 * `PluginWidgetSlot` renders on a dozen console surfaces, and reading a
 * preference on all of them would mean a user-document read on every one —
 * for a setting only the dashboard offers any way to change. With no provider
 * above it the slot reads this constant: no fetch, no filtering, and the
 * behavior every other surface has today.
 */
const INERT: DashboardWidgetPrefsValue = {
  prefs: EMPTY_DASHBOARD_WIDGET_PREFS,
  ready: true,
  customizable: false,
  setHidden: () => undefined,
  move: () => undefined,
}

const DashboardWidgetPrefsContext =
  createContext<DashboardWidgetPrefsValue>(INERT)

/**
 * Reads the signed-in person's arrangement for the current workspace once,
 * and shares it with every slot on the dashboard.
 *
 * ONE read per dashboard visit, of one document the reader owns, on a page
 * they navigated to deliberately. The provider is what keeps it at one: the
 * dashboard mounts four widget slots and a customize dialog, and a hook doing
 * its own fetch per consumer would turn a preference into five reads a page.
 */
export function DashboardWidgetPrefsProvider(props: { children: ReactNode }) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | undefined)?.uid
  const { orgId } = useCurrentOrg()
  const [prefs, setPrefs] = useState<DashboardWidgetPrefs>(
    EMPTY_DASHBOARD_WIDGET_PREFS,
  )
  const [ready, setReady] = useState(false)

  /**
   * The reader+workspace whose arrangement has been asked for.
   *
   * A ref rather than an effect cleanup, and it does two jobs. It keeps the
   * fetch at ONE per person per workspace, where a bare dependency list would
   * re-read on any re-render that hands the effect a new Firestore handle;
   * and it decides staleness across renders, so an answer that arrives after
   * the workspace has changed — or after this reader has already moved a card
   * — is dropped rather than written over what is on screen.
   */
  const requestedFor = useRef<string | null>(null)

  useEffect(() => {
    const key = uid && orgId ? `${uid}:${orgId}` : null
    if (!key) {
      requestedFor.current = null
      setPrefs(EMPTY_DASHBOARD_WIDGET_PREFS)
      // No signed-in reader is a SETTLED answer — there is nobody to hold a
      // preference, so the dashboard is the ordinary one rather than blank.
      // A missing org id is the loading window instead: the workspace is
      // still resolving, and its arrangement cannot be read until it has.
      setReady(!uid)
      return
    }
    if (requestedFor.current === key) return
    requestedFor.current = key
    void (async () => {
      let next = EMPTY_DASHBOARD_WIDGET_PREFS
      try {
        const snapshot = await getDoc(doc(firestore, 'users', uid))
        next = readDashboardWidgetPrefs(
          snapshot.get(DASHBOARD_WIDGETS_FIELD),
          orgId,
        )
      } catch {
        // An unreadable preference is the default dashboard, never an error
        // on it: the cards this decorates are all readable without it.
      }
      if (requestedFor.current !== key) return
      setPrefs(next)
      setReady(true)
    })()
  }, [firestore, uid, orgId])

  const persist = useCallback(
    (next: DashboardWidgetPrefs) => {
      // Optimistic: the switch answers the click, and a failed write leaves
      // the arrangement showing until the page is reloaded. Nothing here
      // decides access, so the cost of being wrong for a session is a card in
      // the wrong place.
      setPrefs(next)
      if (!uid || !orgId) return
      void setDoc(
        doc(firestore, 'users', uid),
        {
          // Both keys, always. `merge` leaves an omitted key at its stored
          // value, so writing only the one that changed would keep a rank
          // that no longer matches the arrangement being saved.
          [DASHBOARD_WIDGETS_FIELD]: {
            [orgId]: { hidden: [...next.hidden], order: [...next.order] },
          },
        },
        // Recursive for maps, so one workspace's arrangement is written
        // without reading or rewriting the others'.
        { merge: true },
      ).catch(console.error)
    },
    [firestore, uid, orgId],
  )

  const value = useMemo<DashboardWidgetPrefsValue>(
    () => ({
      prefs,
      ready,
      customizable: true,
      setHidden: (widgetId, hidden) =>
        persist(setDashboardWidgetHidden(prefs, widgetId, hidden)),
      move: (groupIds, widgetId, delta) =>
        persist(moveDashboardWidget(prefs, groupIds, widgetId, delta)),
    }),
    [prefs, ready, persist],
  )

  return (
    <DashboardWidgetPrefsContext.Provider value={value}>
      {props.children}
    </DashboardWidgetPrefsContext.Provider>
  )
}
DashboardWidgetPrefsProvider.displayName = 'DashboardWidgetPrefsProvider'

/** The dashboard arrangement in scope, or the inert one off the dashboard. */
export function useDashboardWidgetPrefs(): DashboardWidgetPrefsValue {
  return useContext(DashboardWidgetPrefsContext)
}

export default DashboardWidgetPrefsProvider
