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
  onboardingDestination,
  parseOnboardingPlanIntent,
  PLAN_LABELS,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_HOST_GROUP,
  ICON_VARIANT_ORGANIZATION,
} from '@aglyn/shared-data-enums'
import { mdiPin, mdiPinOutline } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListFilterToolbar from '@aglyn/shared-ui-jsx/components/list-filter-toolbar.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { trackEventBeforeNavigation } from '@aglyn/aglyn/app-utils/analytics-events'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  SITE_CREATE_PARAM,
  SITE_CREATE_VALUE,
} from '../../../components/create-host-dialog.component'
import CreateOrgDialog from '../../../components/create-org-dialog.component'
import EmptyState from '../../../components/empty-state.component'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import PlatformMarketingConsentPrompt from '../../../components/marketing-consent-prompt.component'
import OrgInvitesBanner from '../../../components/org-invites-banner.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgPlans } from '@aglyn/tenant-feature-instance/hooks/use-org-plans'
import { useOrgScope } from '../../../hooks/use-org-scope'
import { usePinnedOrgs } from '../../../hooks/use-pinned-orgs'
import {
  PinnedFullDialog,
  type PinnedOrgEntry,
} from '../../../components/pinned-orgs-dialogs.component'
import { useWorkspacePage } from '../../../hooks/use-workspace-page'
import { readOutcome } from '@aglyn/shared-ui-jsx/utils/read-outcome'
import { usePendingInvites } from '../../../hooks/use-pending-invites'
import { consumeOnboardingPlanIntent } from '../../../utils/onboarding-plan-intent'
import {
  claimSignUpWorkspace,
  createSignUpWorkspace,
  needsBackstopWorkspace,
  personalWorkspaceName,
} from '../../../utils/signup-workspace'
import {
  holdSignUpLanding,
  isLeavingConsole,
  releaseSignUpLanding,
} from '../../../utils/sign-up-landing-hold'
import hardNavigate from '../../../utils/hard-navigate'
import { currentConsoleLandingHref } from '../../../utils/console-landing'
import { createFirstSiteWorkspace } from '../../../utils/first-site-workspace'
import {
  arrangeWorkspaces,
  needsWorkspacePlans,
  WORKSPACE_FILTER_FIELDS,
  WORKSPACE_FILTER_HEADERS,
  WORKSPACE_FILTER_OPTIONS,
  type WorkspaceRow,
} from '../../../utils/workspace-list'

/** The landing hold the workspace provisioning takes (AGL-3690). */
const PROVISION_HOLD_KEY = 'home:provision-sign-up-workspace'
/** Longer than a slow create: the hold's own timer is only the backstop. */
const PROVISION_HOLD_MAX_MS = 60_000
/** What the picker pages while its list is still settling. */
const NO_WORKSPACES: WorkspaceRow[] = []

/**
 * Reads each workspace's plan for the Plan filter (AGL-3762) and hands the
 * answers up. A component rather than a hook call in the page so it is
 * MOUNTED only while that filter is in force: the reads are one per
 * workspace, and a reader who never filters by plan pays none of them.
 */
function WorkspacePlansReader(props: {
  orgIds: string[]
  onPlans: (plans: Record<string, string>) => void
}) {
  const { orgIds, onPlans } = props
  const plans = useOrgPlans(orgIds)
  useEffect(() => onPlans(plans), [plans, onPlans])
  return null
}

/**
 * Org jump page (AGL-621) — the authenticated console root at `/`. Picks the
 * workspace to enter, making the org an explicit choice rather than an implicit
 * precedence guess. Lives in the `(app)` group so it wears the console chrome,
 * and frames its content in DashboardLayout (AGL-631). A single-org member
 * skips straight to their sites; a first-time member with no org creates their
 * first site, which sets up the workspace first and then asks, in it, how the
 * site should start (AGL-3761).
 */
function OrgJump() {
  const {
    orgs,
    loading,
    confirmed,
    hasMoreOrgs,
    loadMoreOrgs,
    error: orgsError,
    retry: retryOrgs,
  } = useOrgScope()
  /*
   * THE WHOLE MEMBERSHIP SET, BEFORE ANY ORDER (AGL-3762).
   *
   * The picker sorts by name, pins, searches and filters in memory, which is
   * only honest over every row: sorting a 50-row window would put "Zed" last
   * on one page and then move it when the window grew. The set is the
   * reader's own memberships — one small row per organization they belong to
   * — so the window is grown until the listen says it is complete, and
   * nothing is arranged before then. One growth per arrival of rows, so it
   * cannot outrun the listen.
   */
  useEffect(() => {
    if (hasMoreOrgs) loadMoreOrgs()
  }, [hasMoreOrgs, loadMoreOrgs, orgs.length])
  const orgsComplete = !hasMoreOrgs
  const [orgClauses, setOrgClauses] = useState<ListFilterClause[]>([])
  const [orgSearch, setOrgSearch] = useState<string[]>([])
  const {
    pinned: pinnedOrgIds,
    full: pinsFull,
    toggle: togglePinnedOrg,
    replace: replacePinnedOrg,
  } = usePinnedOrgs()
  // A sixth pin asks which of the five it replaces (AGL-3943).
  const [pinning, setPinning] = useState<PinnedOrgEntry | null>(null)
  /*
   * The plan is the ORG document's, not the membership row's, so the Plan
   * filter reads each workspace's plan — only while that filter is in force —
   * and lists nothing until every plan has answered: a workspace whose plan
   * is still in flight is never mistaken for one that does not match.
   */
  const planFilter = needsWorkspacePlans(orgClauses)
  const orgIds = useMemo(() => orgs.map((org) => org.$id), [orgs])
  const [orgPlans, setOrgPlans] = useState<Record<string, string>>({})
  const plansPending = planFilter && orgIds.some((orgId) => !orgPlans[orgId])
  const orgListSettling = !orgsComplete || plansPending
  const arrangedOrgs = useMemo(
    () =>
      orgListSettling
        ? NO_WORKSPACES
        : arrangeWorkspaces(orgs, {
            pinned: pinnedOrgIds,
            plans: orgPlans,
            clauses: orgClauses,
            search: orgSearch,
          }),
    [orgListSettling, orgs, pinnedOrgIds, orgPlans, orgClauses, orgSearch],
  )
  // The picker pages on the console's own footer (AGL-2501), over the
  // arranged list, so a page holds the same five workspaces every render.
  const {
    visible: visibleOrgs,
    page: orgPage,
    setPage: setOrgPage,
    pageSize: orgPageSize,
    hasMore: hasMoreOrgPages,
  } = useWorkspacePage(arrangedOrgs, {
    hasMoreRows: hasMoreOrgs,
    loadMoreRows: loadMoreOrgs,
  })
  // A list that shrank under the page (an unpin under a Pinned filter took
  // the last card away) steps back to its new last page.
  useEffect(() => {
    if (orgListSettling || orgPage === 0) return
    if (orgPage * orgPageSize < arrangedOrgs.length) return
    setOrgPage(Math.max(0, Math.ceil(arrangedOrgs.length / orgPageSize) - 1))
  }, [arrangedOrgs.length, orgListSettling, orgPage, orgPageSize, setOrgPage])
  // A new search or filter is a new list, read from its first page.
  const onOrgClauses = useCallback(
    (next: ListFilterClause[]) => {
      setOrgClauses(next)
      setOrgPage(0)
    },
    [setOrgPage],
  )
  const onOrgSearch = useCallback(
    (next: string[]) => {
      setOrgSearch(next)
      setOrgPage(0)
    },
    [setOrgPage],
  )
  const orgFiltering = orgClauses.length > 0 || orgSearch.length > 0
  /**
   * `useOrgScope` has said all along that an errored membership listen "says
   * nothing about what orgs exist" (AGL-1260), and this page read `orgs`
   * alone — so a session denied that read landed on **Create your first
   * site** in front of someone who has several (AGL-1066). It is the Sites
   * page's bug one level up, and worse: the workspace list is what the whole
   * console routes off.
   */
  const orgsRead = readOutcome({ ready: !loading, error: orgsError })
  // A first-time invitee has zero orgs and lands here; this is the only jump
  // surface, so it must offer the invite (AGL-851). Without it the invite was
  // reachable only from a hosts page, which needs an org you don't have yet.
  const { invites, loading: invitesLoading } = usePendingInvites()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [creatingOrg, setCreatingOrg] = useState(false)
  /**
   * "Create site" with no workspace: the workspace being made for it
   * (AGL-3761), then the sites page with the start open.
   */
  const [startingSite, setStartingSite] = useState(false)
  const [startSiteError, setStartSiteError] = useState<string | null>(null)
  /**
   * The workspace for a first site was just created from this page
   * (AGL-3742, AGL-3761), and the page is already leaving for its start. The
   * single-org redirect below must not race it to the sites list.
   */
  const siteCreatedRef = useRef(false)
  /**
   * A workspace this page tried to create for a sign-up, and could not
   * (AGL-1523).
   *
   * The person typed a name into the sign-up form and got nothing; landing
   * them here with no explanation made the field feel like a lie. Raised in
   * this page's own state because this is where the create now happens
   * (AGL-2590) — it used to cross from /signup in sessionStorage, which is a
   * carrier there is nothing left to carry.
   */
  const [signupOrgFailure, setSignupOrgFailure] = useState<{
    name: string
    error: string | null
  } | null>(null)

  // The plan intent that survived the email-verification wall (AGL-1535).
  //
  // `/verify-email` sends a freshly verified account here with a bare `/` —
  // no plan on the URL, and (when the link was opened on a phone) no browser
  // storage from the signup tab either. So the account's own record is asked.
  // One document read, started in parallel with the org list this page is
  // already waiting on, so it costs no perceptible time.
  //
  // `undefined` means "not answered yet" and the jump below HOLDS on it: a
  // redirect is not a render you can correct a beat later, and firing the
  // ordinary jump first would drop the intent for good.
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid
  // Memoized: this is an effect dependency, and a fresh object every render
  // would re-run the consume — which CLEARS what it reads — in a loop.
  const urlIntent = useMemo(
    () => parseOnboardingPlanIntent(searchParams),
    [searchParams],
  )
  const [storedIntent, setStoredIntent] = useState<
    ReturnType<typeof parseOnboardingPlanIntent> | undefined
  >(undefined)
  // Consuming DESTROYS what it reads, so it must happen at most once per
  // account — never on a re-render that merely changed an effect dependency's
  // identity.
  const consumedForRef = useRef<string | null>(null)
  const currentUidRef = useRef(uid)
  currentUidRef.current = uid
  useEffect(() => {
    // An intent on the URL already answers the question, and it outranks a
    // remembered one — it is what this visit says, not what a past one did.
    if (urlIntent) return void setStoredIntent(null)
    if (!uid || consumedForRef.current === uid) return void 0
    consumedForRef.current = uid
    // NOT cancelled on cleanup. The read happens once per account, so a
    // result this drops is never read again, and `storedIntent` would stay
    // `undefined` for good: the workspace provisioning below and the jump
    // both HOLD on `undefined`, so the account sat on "0 workspaces" with its
    // sign-up name never claimed. Any re-run of this effect while the read
    // was in flight did that, and React's development StrictMode re-runs
    // every effect once on mount, so locally it happened every time. The only
    // result to discard is one for an account no longer signed in here.
    void consumeOnboardingPlanIntent(firestore, uid).then((intent) => {
      if (currentUidRef.current === uid) setStoredIntent(intent)
    })
    return undefined
  }, [firestore, uid, urlIntent])

  /**
   * The one resolved answer to "what is this visit trying to buy", shared by
   * every exit from this page — the single-org jump below, the picker's
   * workspace links, and the org the picker creates.
   *
   * An intent on the URL outranks a remembered one, and it is resolved ONCE
   * here so the exits cannot disagree: a multi-org member's click and a
   * single-org member's redirect are the same decision reached by different
   * routes, and a picker link that dropped the plan sent a buyer to their
   * sites to go find billing on their own.
   *
   * `undefined` — the account read still in flight — collapses to null for the
   * links, which re-render with the intent the moment it answers. The redirect
   * effect cannot do that: it HOLDS on `undefined` instead, because a
   * navigation is not a render you can correct a beat later.
   */
  const intent = urlIntent ?? storedIntent ?? null
  /**
   * Where entering `orgSlug` should land. `onboardingDestination` is the sole
   * builder of that path — it owns the enterprise-goes-to-support branch and
   * the interval serialization, and hand-appending `&interval=` anywhere else
   * turns "the CTA stated no interval" into "the CTA said monthly" (AGL-1535).
   */
  const enterOrg = useCallback(
    (orgSlug: string) =>
      intent
        ? onboardingDestination(orgSlug, intent)
        : buildRoute(Route.HOST_LIST, { orgSlug }),
    // Stable while the intent is: the jump effect below depends on this, and a
    // fresh function every render would re-fire a navigation on every render.
    [intent],
  )

  /**
   * "Create site" for an account with no workspace (AGL-3761).
   *
   * How a site starts is asked inside a workspace — its plan decides what is
   * offered — so the workspace is made first and the site is not: the person
   * lands in the new workspace's sites with "Create site" open, and the site
   * is created there only once they choose how it starts. A visit carrying a
   * plan lands on billing with it instead (AGL-1117), where the workspace is
   * what the plan is bought for.
   *
   * Hard, like the sign-up provisioning above: the whole chrome resolves
   * against a workspace that did not exist when this page rendered. And on
   * the auth host, to the console host, which serves the path (AGL-3742).
   */
  const startFirstSite = useCallback(async () => {
    if (startingSite || !user) return
    setStartingSite(true)
    setStartSiteError(null)
    siteCreatedRef.current = true
    const outcome = await createFirstSiteWorkspace(user, user)
    if ('slug' in outcome) {
      const target = intent
        ? enterOrg(outcome.slug)
        : `${buildRoute(Route.HOST_LIST, { orgSlug: outcome.slug })}?${SITE_CREATE_PARAM}=${SITE_CREATE_VALUE}`
      hardNavigate(currentConsoleLandingHref(target))
      return
    }
    siteCreatedRef.current = false
    setStartSiteError(outcome.error)
    setStartingSite(false)
  }, [enterOrg, intent, startingSite, user])

  /**
   * THE WORKSPACE THE SIGN-UP ASKED FOR, CREATED ON THE FIRST VERIFIED
   * SESSION (AGL-2590).
   *
   * Sign-up used to create it seconds after the Firebase account. That
   * workspace was unusable until the person verified — `/api/auth/session`
   * refuses to mint a session cookie while `email_verified` is false, and
   * every console route refuses the account behind it — so all eager creation
   * bought was a permanent claim on a workspace address handed out before
   * anyone had shown the address was theirs. The AGL-1115 landing it was for
   * is delivered on the first USABLE session, and this page is where that
   * session arrives.
   *
   * ## Why here rather than at the verification click
   *
   * `/verify-email` applies the code in whichever browser the mail client
   * opened, which is routinely not the one that signed up, while the tab that
   * did sign up sits polling for the same event. Both would provision. This
   * page is reached once per session, holds the membership list the decision
   * needs, and already asks the account for what else the sign-up remembered.
   *
   * ## What it costs
   *
   * One transaction against `users/{uid}`, and only for an account that has
   * NO workspaces — a returning member never pays it. `confirmed` rather than
   * `!loading`, for the reason the jump below states at length: the console's
   * multi-tab cache answers first, and creating a workspace for someone whose
   * memberships had merely not arrived yet is not a render you can correct.
   */
  const [provisionSettled, setProvisionSettled] = useState(false)
  const provisionedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user || !uid || loading || !confirmed || orgs.length !== 0) return
    // The remembered plan decides where the new workspace LANDS, and it is
    // read once and destructively — starting before it answers would drop it.
    if (storedIntent === undefined) return
    // A pending invite is why a zero-workspace account is here; the backstop
    // below must not hand it a workspace of its own before it can see that.
    if (invitesLoading) return
    if (provisionedForRef.current === uid) return
    // The editor-hint bounce is already leaving (AGL-3690). The claim clears
    // the held name, so starting it now would lose the name with the page.
    // The page this bounce returns to provisions instead.
    if (isLeavingConsole()) return
    provisionedForRef.current = uid
    let active = true
    /**
     * Held from the claim to the create (AGL-3690). The claim CLEARS the held
     * name, so a top-level navigation between the two leaves the account
     * with no name and no workspace, and the chooser then reads "0
     * workspaces" for good. `EditHintBounce` is exactly such a navigation,
     * and a fresh verified page is exactly when it fires. It re-reads this
     * hold before it leaves. A success keeps the hold, because the page is
     * leaving anyway.
     */
    holdSignUpLanding(PROVISION_HOLD_KEY, PROVISION_HOLD_MAX_MS)
    void (async () => {
      // No held name: the backstop (AGL-4021). A door that should have made
      // the workspace died on the way, so a young verified account with no
      // workspace and no invite gets the personal one that door would have
      // created, instead of an empty chooser — unless another tab claimed
      // provisioning moments ago and is creating it now (AGL-4079).
      const backstop = invites.length === 0 && needsBackstopWorkspace(user)
      const { pending, claimedElsewhere } = await claimSignUpWorkspace(
        firestore,
        user,
        { backstop },
      )
      const name =
        pending?.name ??
        (backstop && !claimedElsewhere ? personalWorkspaceName(user) : '')
      if (!name) {
        releaseSignUpLanding(PROVISION_HOLD_KEY)
        if (active) setProvisionSettled(true)
        return
      }
      // Only a typed name is offered back on the chooser; any other address
      // is tried once more under a suffix (AGL-4024).
      const { slug, error } = await createSignUpWorkspace(user, name, {
        derived: !pending?.nameWasTyped,
      })
      if (!slug) releaseSignUpLanding(PROVISION_HOLD_KEY)
      if (slug) {
        // Activation (AGL-1561), counted where the workspace is actually
        // created. A refused create falls through to this page uncounted,
        // which is what makes "orgs created" match reality.
        //
        // Through the navigation-safe door (AGL-2587): the hard navigation
        // below tears this document down, and the console's transport awaits
        // the Firebase SDK's initialization promise before it reaches gtag —
        // so a continuation scheduled behind that teardown simply never runs.
        // That is how `org_created` reached the property zero times while
        // nine workspaces existed in Firestore.
        await trackEventBeforeNavigation('org_created', {})
        // Hard, not `router.replace`: the org is brand new, so the whole
        // chrome (switcher, plan badge, nav) has to resolve against it rather
        // than re-using a tree built for an account that had no workspaces.
        // `provisionSettled` deliberately stays false — the page is leaving,
        // and settling it would flash the empty state on the way out.
        hardNavigate(enterOrg(slug))
        return
      }
      if (!active) return
      // Best-effort no longer means silent (AGL-1523). The name was typed
      // into the sign-up form; say what happened to it and offer it back.
      if (pending?.nameWasTyped) {
        setSignupOrgFailure({ name: pending.name, error })
      }
      setProvisionSettled(true)
    })()
    return () => void (active = false)
  }, [
    confirmed,
    enterOrg,
    firestore,
    invites.length,
    invitesLoading,
    loading,
    orgs.length,
    storedIntent,
    uid,
    user,
  ])
  /**
   * Hold the zero-workspace surfaces until the account has answered.
   *
   * From the moment this page knows there are no workspaces until the claim
   * above settles, "Create your first site" is a question that may be about to
   * answer itself. A spinner for one document read is cheaper than showing
   * someone an empty state and replacing it with their workspace.
   */
  const provisioning =
    Boolean(uid) &&
    !loading &&
    confirmed &&
    orgs.length === 0 &&
    !provisionSettled

  // Single-org members never see a picker — go straight to their sites.
  //
  // Gated on `confirmed`, not merely `loading` (AGL-1149). The console runs a
  // persistent multi-tab Firestore cache, and `loading` goes false on the
  // FIRST snapshot — which is the CACHED one. A member who just accepted an
  // invite to a second org still has a one-org list in cache, so this fired
  // and replaced the chooser with their old org before the server snapshot
  // arrived. They then looked at that org's sites and reasonably asked where
  // the new org's sites had gone. Both halves of that report were this line.
  //
  // A redirect is the wrong thing to do on unconfirmed data: it is not a
  // render you can correct a beat later, it is a navigation the user has to
  // undo — and the chooser they wanted is exactly what it navigates away from.
  useEffect(() => {
    if (loading || !confirmed || orgs.length !== 1) return
    if (siteCreatedRef.current) return
    // The remembered intent has not been answered yet (AGL-1535) — hold. The
    // ordinary jump below is the one that drops it.
    if (storedIntent === undefined) return
    const slug = orgs[0]?.slug
    if (!slug) return
    // An already-signed-in visitor who clicked a plan CTA on the marketing
    // site arrives here with the intent still on the URL (AGL-1117). Sending
    // them to their sites would silently drop the plan they just picked, so
    // the upgrade path lands on billing with it preselected instead. A
    // malformed param parses to null and falls through to the normal jump.
    //
    // Failing that, the intent the ACCOUNT remembers from signup: this is the
    // landing the email-verification bounce discards, and it arrives here as a
    // bare `/` with nothing to read off the URL (AGL-1535).
    //
    // Under the auth host the org lives on another origin (AGL-3724): a
    // client-side replace there asks `auth.` for a page it refuses with a 404.
    const destination = enterOrg(slug)
    const landing = currentConsoleLandingHref(destination)
    if (landing !== destination) return void hardNavigate(landing)
    router.replace(destination)
  }, [loading, confirmed, orgs, router, storedIntent, enterOrg])

  return (
    <DashboardLayout
      disableDefaultBreadcrumb
      breadcrumbItems={[{ children: 'Workspaces' }]}
      // No host is in scope here, so suppress the default host nav tabs.
      header={{
        children: 'Workspaces',
        icon: { path: ICON_VARIANT_ORGANIZATION.path },
      }}
      // The one page in the console with no help affordance (AGL-2486), and
      // the first page a new member sees: it is where "what IS a workspace,
      // and why am I picking one" is asked.
      help={{
        topic: 'consoleTour',
        anchor: '#choose-a-workspace',
        title: 'Workspaces',
        excerpt:
          'A workspace is your organization: its sites, team, billing and ' +
          'plan live together. Open one to see its sites, and pin the ones ' +
          'you use most to keep them first. The switcher in the app bar ' +
          'moves between them later.',
      }}
      // The primary action belongs in the header, like every other list page
      // (sites, screens, layouts) — at the foot of the list it sat below the
      // fold once you had more than a couple of workspaces. The zero-org
      // empty state keeps its own inline actions.
      headerRight={
        !loading && orgs.length > 1 ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setCreatingOrg(true)}
          >
            {'Create an organization'}
          </Button>
        ) : null
      }
    >
      {planFilter && orgsComplete ? (
        <WorkspacePlansReader orgIds={orgIds} onPlans={setOrgPlans} />
      ) : null}
      {loading || provisioning || orgs.length === 1 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* The one-time product-updates ask (AGL-3185), for an account
              with no decision on record. Here and on the sites list — the
              two places a signed-in person lands — rather than above every
              route. */}
          <PlatformMarketingConsentPrompt />
          {signupOrgFailure ? (
            <Alert
              severity="warning"
              sx={{ mb: 3 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setCreatingOrg(true)}
                >
                  {'Create it now'}
                </Button>
              }
            >
              {`We couldn’t create your workspace “${signupOrgFailure.name}” during sign-up`}
              {signupOrgFailure.error ? ` — ${signupOrgFailure.error}` : ''}
              {'. Your account is ready; the workspace still needs creating.'}
            </Alert>
          ) : null}
          {orgs.length === 0 ? (
            invitesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
              </Box>
            ) : invites.length > 0 ? (
              // A pending invite is the reason this person just signed up — lead
              // with it rather than "Create your first site" (AGL-851).
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" component="h1">
                    {"You've been invited"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {'Accept your invitation to join the workspace, or start ' +
                      'your own instead.'}
                  </Typography>
                </Box>
                <OrgInvitesBanner />
                {startSiteError ? (
                  <Alert severity="error">{startSiteError}</Alert>
                ) : null}
                <Button
                  variant="text"
                  sx={{ alignSelf: 'flex-start' }}
                  disabled={startingSite}
                  onClick={() => void startFirstSite()}
                >
                  {startingSite
                    ? 'Setting up your workspace…'
                    : 'Create my own site instead'}
                </Button>
              </Stack>
            ) : (
              <>
                <EmptyState
                  read={orgsRead}
                  subject="your workspaces"
                  onRetry={retryOrgs}
                  iconPath={ICON_VARIANT_HOST_GROUP.path}
                  title={'Create your first site'}
                  description={
                    'Your first site sets up your workspace automatically — no ' +
                    'separate setup needed.'
                  }
                  action={
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                    >
                      <Button
                        variant="contained"
                        color="primary"
                        disabled={startingSite}
                        onClick={() => void startFirstSite()}
                      >
                        {startingSite
                          ? 'Setting up your workspace…'
                          : 'Create site'}
                      </Button>
                      <Button
                        variant="text"
                        onClick={() => setCreatingOrg(true)}
                      >
                        {'Create an organization'}
                      </Button>
                    </Stack>
                  }
                />
                {/* The first site's workspace is the whole of the zero-org
                    buyer's path: someone arriving from a plan CTA with no
                    workspace at all has no picker and no create-workspace
                    dialog to carry the intent for them, so `startFirstSite`
                    lands a visit with a plan on billing. */}
                {startSiteError ? (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {startSiteError}
                  </Alert>
                ) : null}
              </>
            )
          ) : (
            <Stack spacing={3}>
              {/* A member of one org invited to another accepts it here too. */}
              <OrgInvitesBanner />
              <Box>
                <Typography variant="h6" component="h1">
                  {'Choose a workspace'}
                </Typography>
                {/* Name the plan when the visit is carrying one. The picker
                    is a detour a buyer did not ask for, and saying what the
                    choice is FOR is what keeps it a step in the purchase
                    rather than a dead end they have to reason about. */}
                <Typography variant="body2" color="text.secondary">
                  {intent
                    ? `You belong to several organizations — pick the one you ` +
                      `want ${PLAN_LABELS[intent.plan] ?? intent.plan} on.`
                    : 'You belong to several organizations — pick one to manage.'}
                </Typography>
              </Box>
              <Stack spacing={1}>
                <ListFilterToolbar
                  fields={WORKSPACE_FILTER_FIELDS}
                  headers={WORKSPACE_FILTER_HEADERS}
                  options={WORKSPACE_FILTER_OPTIONS}
                  clauses={orgClauses}
                  onChange={onOrgClauses}
                  search={{
                    words: orgSearch,
                    onChange: onOrgSearch,
                    placeholder: 'Search by name or slug',
                  }}
                />
                <ListFilterChips
                  fields={WORKSPACE_FILTER_FIELDS}
                  headers={WORKSPACE_FILTER_HEADERS}
                  options={WORKSPACE_FILTER_OPTIONS}
                  clauses={orgClauses}
                  onChange={onOrgClauses}
                />
              </Stack>
              {orgListSettling ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress aria-label="Loading workspaces" />
                </Box>
              ) : !arrangedOrgs.length && orgFiltering ? (
                <Typography color="text.secondary">
                  {'No workspaces match this search and these filters.'}
                </Typography>
              ) : null}
              <GridItems
                // A gallery of workspace tiles, each the same shape. Rows are the point.
                masonry={false}
                spacing={3}
                items={visibleOrgs.map((org) => ({
                  size: { xs: 12, sm: 6, md: 4 },
                  children: (
                    <CardDisplay
                      contentGutterX
                      contentGutterY
                      fullHeight
                      HeaderProps={{
                        avatar: (
                          <MdiIcon
                            color="primary"
                            fontSize="large"
                            path={ICON_VARIANT_ORGANIZATION.path}
                          />
                        ),
                        // The card's own action sits in its header: a pinned
                        // workspace leads the list, on every device.
                        action: (
                          <Tooltip
                            title={
                              org.pinned
                                ? 'Unpin'
                                : pinsFull
                                  ? 'Pinned is full: pick one to replace'
                                  : 'Pin to top'
                            }
                          >
                            <IconButton
                              aria-label={`${org.pinned ? 'Unpin' : 'Pin'} ${org.orgName ?? org.slug ?? org.$id}`}
                              aria-pressed={org.pinned}
                              color={org.pinned ? 'primary' : 'default'}
                              onClick={() => {
                                if (togglePinnedOrg(org.$id) === 'full') {
                                  setPinning({
                                    id: org.$id,
                                    name: org.orgName ?? org.slug ?? org.$id,
                                  })
                                }
                              }}
                            >
                              <MdiIcon
                                path={
                                  org.pinned ? mdiPin.path : mdiPinOutline.path
                                }
                              />
                            </IconButton>
                          </Tooltip>
                        ),
                      }}
                      header={org.orgName ?? org.slug ?? org.$id}
                      subheader={org.slug ?? undefined}
                      actions={
                        /*
                         * A real anchor. `router.push` from an
                         * onClick renders a <button>, so this could not be
                         * middle-clicked, ⌘-clicked, opened in a new tab, or
                         * copied as a link — and opening one workspace beside
                         * another is exactly what a list of workspaces is
                         * for. The styling is unchanged: `AppLink` is the
                         * component, MUI still draws the Button.
                         *
                         * An org with no slug has nowhere to link to, so it
                         * stays a disabled button rather than an anchor whose
                         * href would be a route with a hole in it.
                         *
                         * The href carries the plan intent (AGL-1117): the
                         * single-org member is redirected to billing with it,
                         * and a multi-org member reaches the same place by
                         * choosing. The choice is the thing this page exists
                         * for and stays theirs — what it must not do is
                         * discard the plan on the way through.
                         */
                        org.slug ? (
                          <Button
                            variant="contained"
                            component={AppLink as any}
                            {...({
                              componentVariant: 'naked',
                              nativeButton: false,
                            } as any)}
                            href={enterOrg(org.slug)}
                          >
                            {'Open'}
                          </Button>
                        ) : (
                          <Button variant="contained" disabled>
                            {'Open'}
                          </Button>
                        )
                      }
                    >
                      <Typography variant="body2" color="text.secondary">
                        {'Sites, media, data, plugins and billing for this ' +
                          'organization.'}
                      </Typography>
                    </CardDisplay>
                  ),
                }))}
              />
              {/* This grid is a WINDOW over the membership list and used to
                  end in silence, so an agency past its 50th client saw a
                  complete-looking picker that was not complete (AGL-2336).
                  The footer states the position instead: "1–5 of more than 5"
                  while another page is known to exist, the real total once it
                  is not. */}
              {orgListSettling || !arrangedOrgs.length ? null : (
                <ListPagination
                  page={orgPage}
                  pageSize={orgPageSize}
                  rowCount={visibleOrgs.length}
                  hasMore={hasMoreOrgPages}
                  onPageChange={setOrgPage}
                  labelDisplayedRows={({ from, to, count }) =>
                    `${from}–${to} of ${count === -1 ? 'more than ' + to : count} workspaces`
                  }
                />
              )}
            </Stack>
          )}
          <CreateOrgDialog
            open={creatingOrg}
            onClose={() => setCreatingOrg(false)}
            initialName={signupOrgFailure?.name}
            /* A workspace created DURING a buy-intent visit is the one most
               likely to be billed — the visitor came to buy and made a place
               to put it. Landing it on its sites drops the plan exactly where
               it was most wanted. */
            destination={enterOrg}
          />
          <PinnedFullDialog
            pinning={pinning}
            pins={pinnedOrgIds.map((id) => {
              const org = orgs.find((entry) => entry.$id === id)
              return { id, name: org?.orgName ?? org?.slug ?? id }
            })}
            onReplace={(replacing) => {
              if (pinning) replacePinnedOrg(replacing, pinning.id)
              setPinning(null)
            }}
            onClose={() => setPinning(null)}
          />
        </Container>
      )}
    </DashboardLayout>
  )
}

export default OrgJump
OrgJump.displayName = 'Page:OrgJump'
