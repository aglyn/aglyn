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

import type { UserOrgMembership } from '@aglyn/aglyn'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
} from 'firebase/firestore'
import { useParams, usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isAuthFailure } from '../utils/auth-failure'
import { resolveNavSection } from './nav-section'
import { useAuthRecovery } from './use-auth-recovery'
import { MAX_RETRIES, retryDelayMs } from './use-host-resolution'

const SELECTED_ORG_STORAGE_KEY = 'aglyn.selectedOrgId'

/**
 * How many memberships the live listener holds at a time (AGL-2336).
 *
 * This used to be a bare `limit(50)` with no cursor, no count and no "load
 * more", and `useOrgScope` is not a list — it is what resolves WHICH org you
 * are in. So an agency following our own `run-an-agency-workspace` advice
 * (one organization per client) was not merely missing rows from a switcher
 * past its 50th client: those workspaces were UNREACHABLE, because nothing
 * could produce a `currentOrg` for them.
 *
 * The number is now a page, not a ceiling — `loadMoreOrgs` grows the window,
 * `hasMoreOrgs` says the window is full so the list is not the whole truth,
 * and `orgSlugs`-keyed resolution below reaches a workspace whether or not
 * it is inside the window at all.
 */
export const ORG_PAGE_SIZE = 50

/**
 * Console hostnames that are NOT org workspaces. Anything else with a
 * subdomain (e.g. business1.aglyn.com) resolves through orgSlugs.
 */
const APEX_LABELS = new Set(['console', 'www', 'app', 'localhost', 'aglyn'])

function subdomainSlugFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const [label, ...rest] = window.location.hostname.split('.')
  if (rest.length < 1) return null // localhost, bare hosts
  if (APEX_LABELS.has(label)) return null
  // Vercel previews (foo.vercel.app) and IPs are not workspaces either.
  if (window.location.hostname.endsWith('.vercel.app')) return null
  return label
}

export interface OrgScopeContextValue {
  /** Every org the user belongs to, from the reverse index. */
  orgs: UserOrgMembership[]
  /** The org the console is currently scoped to (null pre-resolution). */
  currentOrg: UserOrgMembership | null
  /** Remembers the last apex selection (used by the org jump page). */
  selectOrg: (orgId: string) => void
  /** The workspace slug the page was opened under, when subdomain-scoped. */
  orgSlug: string | null
  /**
   * The org slug in the URL path (`/[orgSlug]/…`), the source of truth for
   * the active workspace on org-scoped routes (AGL-621); null off them.
   *
   * Read from the matched route params when there are any, and from the
   * pathname when there are not — a not-found boundary matches no dynamic
   * segment but still has the slug right there in the URL (AGL-2486).
   */
  pathOrgSlug: string | null
  loading: boolean
  /**
   * True once the membership list has been echoed by the SERVER (AGL-886).
   * The first snapshot can come from the IndexedDB cache and be empty or
   * stale on a cold load (AGL-813/827) — a miss is only real once this is
   * true. A positive hit never needs to wait on it.
   */
  confirmed: boolean
  /** `false` only when `orgSlugs/{slug}` confirmed the slug does not exist. */
  slugExists: boolean | null
  /**
   * The membership listen gave up after retries (AGL-1260). Distinct from a
   * confirmed empty list: an errored read says nothing about what orgs exist,
   * so consumers must offer a retry, never a 404 or a Free-tier default.
   */
  error: boolean
  /**
   * The failure behind `error` was the SESSION, not the network — the listen
   * was refused for who you are, not dropped in transit.
   *
   * The console cannot heal a network fault and must not pretend to, so that
   * one keeps the standing error and the manual retry. This one it CAN heal:
   * `useAuthRecovery` below re-runs the listen the moment the session comes
   * back, and consumers use the flag to stop saying "check your connection"
   * about an expired token.
   */
  authError: boolean
  /** Re-runs the membership listen after it gave up (AGL-1260). */
  retry: () => void
  /**
   * The membership window came back FULL, so there are probably more (AGL-2336).
   * The truthful reading is "this list is not known to be complete" — surface
   * it rather than letting a truncated list pass for the whole set.
   */
  hasMoreOrgs: boolean
  /** Grows the membership window by one page (AGL-2336). */
  loadMoreOrgs: () => void
}

const OrgScopeContext = createContext<OrgScopeContextValue>({
  orgs: [],
  currentOrg: null,
  selectOrg: () => undefined,
  orgSlug: null,
  pathOrgSlug: null,
  loading: true,
  confirmed: false,
  slugExists: null,
  error: false,
  authError: false,
  retry: () => undefined,
  hasMoreOrgs: false,
  loadMoreOrgs: () => undefined,
})

/**
 * Org workspace context (AGL-236/AGL-621): the Slack-style scope the
 * console operates in. The URL is the source of truth — the `/[orgSlug]/…`
 * path segment wins, so a stale local selection can never override the org
 * you navigated to (this is what killed the old switch-bounce). Precedence:
 * the path slug, then the workspace subdomain (resolved via the public
 * orgSlugs doc — the deferred subdomain form), then the locally remembered
 * selection (jump-page convenience), then the user's first org.
 */
export function OrgScopeProvider(props: { children?: ReactNode }) {
  const { children } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const params = useParams<{ orgSlug?: string | string[] }>()
  const pathname = usePathname()
  /**
   * The workspace the URL PATH names.
   *
   * `useParams()` is the direct reading and stays first — on a matched route
   * it is exactly the `[orgSlug]` segment Next resolved. But it is empty on
   * routes that matched no dynamic segment, and the loudest of those is the
   * NOT-FOUND boundary (AGL-2486): `/aglyn-org/hosts/aglyn-marketing/screens/
   * pegb_4s5wV` is not a route — the screen editor lives at
   * `/screens/[screenId]/versions/[versionId]/…` — so the params bag came
   * back empty while the address bar still plainly read `aglyn-org`. Every
   * URL-derived candidate below missed, the chain fell through to the
   * remembered selection, and the chrome named a workspace the URL
   * contradicted.
   *
   * `usePathname()` survives that, and `resolveNavSection` already knows
   * which leading segments are workspaces and which are the org-less sections
   * (`/admin`, `/manage`, and the bare `/` picker all yield no `orgSlug`), so
   * those keep falling through to the org they need to ACT on.
   *
   * This is NOT a change to the precedence below — it is the same top
   * candidate, reading the same URL, through an API that does not vanish on
   * an unmatched route. A leading segment that names no real workspace (a
   * mistyped path) simply misses here as it always did, and the fallbacks
   * still catch it.
   */
  const pathOrgSlug =
    (typeof params?.orgSlug === 'string' ? params.orgSlug : null) ??
    resolveNavSection(pathname).orgSlug ??
    null
  const [orgs, setOrgs] = useState<UserOrgMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  /** `true` known, `false` CONFIRMED absent, `null` not yet answered. */
  const [slugExists, setSlugExists] = useState<boolean | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [subdomainOrgId, setSubdomainOrgId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [authError, setAuthError] = useState(false)
  // Bumping this re-runs the membership effect below — the whole mechanism
  // behind `retry`, same shape as useHostResolution's (AGL-1200).
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // A latched SESSION failure heals itself (AGL-1066's channel, plus a token
  // that refreshed with nobody watching). Wired here rather than at each
  // consumer so every reader of this context — not just the host guard —
  // gets the recovered list; `retry` is the same re-run the button calls, so
  // there is one recovery path, not two that can drift.
  useAuthRecovery(authError, retry)
  // The membership window (AGL-2336). A page, not a ceiling.
  const [windowSize, setWindowSize] = useState(ORG_PAGE_SIZE)
  const [hasMoreOrgs, setHasMoreOrgs] = useState(false)
  const loadMoreOrgs = useCallback(
    () => setWindowSize((size) => size + ORG_PAGE_SIZE),
    [],
  )
  /**
   * A membership fetched by id because the URL named a workspace that is NOT
   * in the loaded window (AGL-2336). Two reads, once, and only when needed —
   * this is what makes workspace 51 REACHABLE rather than merely listed.
   * Keyed by what was asked for so a confirmed miss is not asked again.
   */
  const [outOfWindow, setOutOfWindow] = useState<{
    key: string
    org: UserOrgMembership | null
  } | null>(null)
  const orgSlug = useMemo(subdomainSlugFromLocation, [])

  useEffect(() => {
    if (!user?.uid) {
      setOrgs([])
      setLoading(false)
      setConfirmed(false)
      setError(false)
      setAuthError(false)
      return undefined
    }
    // Growing the window re-subscribes; that is not a fresh cold load, and
    // flipping `loading` back on would blank the chrome app-wide mid-session.
    if (windowSize === ORG_PAGE_SIZE) {
      setLoading(true)
      setConfirmed(false)
    }
    setError(false)
    setAuthError(false)
    // Metadata changes included so the cache→server confirmation is
    // delivered even when the data is identical (AGL-886): without it, a
    // cache-served empty that the server agrees with would never re-fire,
    // and the guard below could neither 404 nor stop spinning.
    let seeded = false
    let retried = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null

    const subscribe = () => {
      unsubscribe = onSnapshot(
        query(collection(firestore, 'users', user.uid, 'orgs'), limit(windowSize)),
        { includeMetadataChanges: true },
        (snapshot) => {
          // A delivered snapshot re-arms the budget: a listen that worked and
          // later dies is a fresh outage, not attempt seven of this one.
          retried = 0
          if (!snapshot.metadata.fromCache) setConfirmed(true)
          // Metadata-only ticks carry no doc changes — skip the list write so
          // the whole app doesn't re-render on the confirmation event.
          // A FULL window means the query hit its limit, so there may be
          // more behind it. Not "there are more" — Firestore cannot say —
          // but "this list is not known to be complete", which is exactly
          // the thing the old silent truncation refused to admit.
          setHasMoreOrgs(snapshot.docs.length >= windowSize)
          if (!seeded || snapshot.docChanges().length) {
            seeded = true
            setOrgs(
              snapshot.docs.map(
                (entry) =>
                  ({ $id: entry.id, ...entry.data() }) as UserOrgMembership,
              ),
            )
          }
          setLoading(false)
        },
        (caught) => {
          // Firestore TERMINATES a listener on error — `permission-denied`
          // on a cold load, before the restored session's ID token attaches
          // (AGL-216/1179). This used to `setLoading(false)` and stop: no
          // data, no listener, no error surface, which host routes rendered
          // as an indefinite spinner (AGL-1260). Resubscribe on the shared
          // backoff schedule; only an exhausted budget latches `error`, so a
          // single transient denial never flashes an error screen.
          unsubscribe?.()
          if (retried < MAX_RETRIES) {
            timer = setTimeout(subscribe, retryDelayMs(retried))
            retried += 1
          } else {
            setError(true)
            // The handler used to take no argument at all, which is how a
            // refused SESSION and a dropped connection ended up sharing one
            // error state and one piece of copy. Classify the failure that
            // actually exhausted the budget — it is what decides whether
            // this can heal itself.
            setAuthError(isAuthFailure(caught))
            setLoading(false)
          }
        },
      )
    }
    subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
    }
  }, [firestore, user?.uid, attempt, windowSize])

  useEffect(() => {
    setSelectedOrgId(
      typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(SELECTED_ORG_STORAGE_KEY),
    )
  }, [])

  useEffect(() => {
    if (!orgSlug) {
      setSlugExists(null)
      return
    }
    let active = true
    setSlugExists(null)
    void getDoc(doc(firestore, 'orgSlugs', orgSlug))
      .then((snapshot) => {
        if (!active) return
        setSubdomainOrgId((snapshot.data()?.['orgId'] as string) ?? null)
        // TRI-STATE, deliberately (AGL-1149). This used to collapse "the slug
        // does not exist" and "the read failed" into the same `null`, and they
        // are opposite answers: the first is a definitive 404, the second is
        // "ask again". `orgSlugs` is the only unconditionally public-read
        // collection there is, which is what makes an absence here TRUSTWORTHY
        // — no membership, no session freshness, nothing to deny.
        setSlugExists(snapshot.exists())
      })
      .catch(() => {
        if (!active) return
        setSubdomainOrgId(null)
        // NOT `false`. A failed read is not an absent org, and treating it as
        // one would 404 a real workspace on a flaky network — the exact
        // false-404 the guards elsewhere exist to prevent.
        setSlugExists(null)
      })
    return () => {
      active = false
    }
  }, [firestore, orgSlug])

  /**
   * The workspace the URL names, when it is NOT inside the loaded membership
   * window (AGL-2336).
   *
   * This is the whole lock-out. `useOrgScope` resolves `currentOrg` by
   * SEARCHING the loaded list, so before this the list WAS the set of
   * reachable workspaces: a user whose membership fell past the window got a
   * null `currentOrg` on a URL they were fully entitled to, and paging the
   * list would not have fixed it — you cannot page to a workspace you cannot
   * name. Resolving the named one directly costs two reads and is
   * independent of how many memberships exist.
   */
  const missingTarget = useMemo(() => {
    if (pathOrgSlug) {
      return orgs.some((org) => org.slug === pathOrgSlug)
        ? null
        : { kind: 'slug' as const, key: pathOrgSlug }
    }
    if (subdomainOrgId) {
      return orgs.some((org) => org.$id === subdomainOrgId)
        ? null
        : { kind: 'id' as const, key: subdomainOrgId }
    }
    return null
  }, [orgs, pathOrgSlug, subdomainOrgId])

  useEffect(() => {
    // Nothing to reach, or the window already covers it: drop any answer
    // held for a workspace we are no longer being asked about.
    if (!missingTarget) {
      setOutOfWindow(null)
      return undefined
    }
    // Wait for the list before spending reads — on a cold load everything
    // looks missing for a moment, and reading then would cost two reads on
    // every navigation rather than only on the ones that need it.
    if (!user?.uid || loading) return undefined
    // Already answered for this key — including a CONFIRMED miss, which must
    // not be re-asked on every snapshot.
    if (outOfWindow?.key === missingTarget.key) return undefined
    let active = true
    void (async () => {
      try {
        let orgId = missingTarget.key
        if (missingTarget.kind === 'slug') {
          // `orgSlugs` is the public slug index — the same doc the subdomain
          // path resolves through.
          const slugSnapshot = await getDoc(
            doc(firestore, 'orgSlugs', missingTarget.key),
          )
          const resolved = slugSnapshot.data()?.['orgId'] as string | undefined
          if (!resolved) {
            // No such workspace. A definitive miss, recorded so the route
            // guards can 404 rather than spin.
            if (active) setOutOfWindow({ key: missingTarget.key, org: null })
            return
          }
          orgId = resolved
        }
        // The membership doc itself is the authorization: a user can only
        // read their OWN `users/{uid}/orgs/*`, so a hit here means the same
        // thing a hit in the listener's window means.
        const membership = await getDoc(
          doc(firestore, 'users', user.uid, 'orgs', orgId),
        )
        if (!active) return
        setOutOfWindow({
          key: missingTarget.key,
          org: membership.exists()
            ? ({
                $id: membership.id,
                ...membership.data(),
              } as UserOrgMembership)
            : null,
        })
      } catch {
        // A FAILED read is not a confirmed absence — leave the key
        // unanswered so a later snapshot or navigation tries again, exactly
        // as `slugExists` does above.
        if (active) setOutOfWindow(null)
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, user?.uid, loading, missingTarget, outOfWindow?.key])

  const selectOrg = useCallback((orgId: string) => {
    setSelectedOrgId(orgId)
    try {
      window.localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId)
    } catch {
      // storage unavailable (private mode) — selection lives for the session
    }
  }, [])

  const currentOrg = useMemo(() => {
    const bySlug = (slug: string | null) =>
      (slug && orgs.find((org) => org.slug === slug)) || null
    const byId = (orgId: string | null) =>
      (orgId && orgs.find((org) => org.$id === orgId)) || null
    // The URL path is authoritative on org-scoped routes; everything else is
    // a fallback for routes without an `[orgSlug]` (the jump page, manage/*).
    // The directly-resolved membership sits with the URL-derived candidates,
    // never ahead of the loaded window and never below the "first org"
    // fallback: it answers the SAME question the URL asks, for a workspace
    // the window happens not to hold (AGL-2336).
    const reached = (key: string | null) =>
      (key && outOfWindow?.key === key && outOfWindow.org) || null
    return (
      bySlug(pathOrgSlug) ??
      reached(pathOrgSlug) ??
      byId(subdomainOrgId) ??
      reached(subdomainOrgId) ??
      byId(selectedOrgId) ??
      orgs[0] ??
      null
    )
  }, [orgs, pathOrgSlug, subdomainOrgId, selectedOrgId, outOfWindow])

  const context = useMemo(
    () => ({
      orgs,
      currentOrg,
      selectOrg,
      orgSlug,
      pathOrgSlug,
      loading,
      confirmed,
      slugExists,
      error,
      authError,
      retry,
      hasMoreOrgs,
      loadMoreOrgs,
    }),
    [
      orgs,
      currentOrg,
      selectOrg,
      orgSlug,
      pathOrgSlug,
      loading,
      confirmed,
      slugExists,
      error,
      authError,
      retry,
      hasMoreOrgs,
      loadMoreOrgs,
    ],
  )

  return (
    <OrgScopeContext.Provider value={context}>
      {children}
    </OrgScopeContext.Provider>
  )
}
OrgScopeProvider.displayName = 'OrgScopeProvider'

export function useOrgScope(): OrgScopeContextValue {
  return useContext(OrgScopeContext)
}

/**
 * The active org slug for building `/[orgSlug]/…` links (AGL-621). The URL
 * path is authoritative; the current org's slug is the fallback while the
 * path is being resolved. Empty string only before anything resolves.
 */
export function useOrgSlug(): string {
  const { pathOrgSlug, currentOrg } = useContext(OrgScopeContext)
  return pathOrgSlug ?? currentOrg?.slug ?? ''
}

export default useOrgScope
