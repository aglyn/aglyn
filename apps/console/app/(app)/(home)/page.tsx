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
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import CreateHostDialog from '../../../components/create-host-dialog.component'
import CreateOrgDialog from '../../../components/create-org-dialog.component'
import EmptyState from '../../../components/empty-state.component'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import OrgInvitesBanner from '../../../components/org-invites-banner.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgScope } from '../../../hooks/use-org-scope'
import { useWorkspacePage } from '../../../hooks/use-workspace-page'
import { readOutcome } from '../../../utils/read-outcome'
import { usePendingInvites } from '../../../hooks/use-pending-invites'
import {
  consumeSignUpOrgFailure,
  type SignUpOrgFailure,
} from '../../../utils/signup-org-failure'
import { consumeOnboardingPlanIntent } from '../../../utils/onboarding-plan-intent'

/**
 * Org jump page (AGL-621) — the authenticated console root at `/`. Picks the
 * workspace to enter, making the org an explicit choice rather than an implicit
 * precedence guess. Lives in the `(app)` group so it wears the console chrome,
 * and frames its content in DashboardLayout (AGL-631). A single-org member
 * skips straight to their sites; a first-time member with no org creates their
 * first site (which auto-provisions the workspace).
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
  // The picker pages on the console's own footer (AGL-2501); the membership
  // window still grows underneath when the reader walks to its end.
  const {
    visible: visibleOrgs,
    page: orgPage,
    setPage: setOrgPage,
    pageSize: orgPageSize,
    hasMore: hasMoreOrgPages,
  } = useWorkspacePage(orgs, {
    hasMoreRows: hasMoreOrgs,
    loadMoreRows: loadMoreOrgs,
  })
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
  const [creatingSite, setCreatingSite] = useState(false)
  // A signup-time org creation that failed left a note for this page
  // (AGL-1523): the person typed a workspace name into the signup form and
  // got nothing — landing them here with no explanation made the field feel
  // like a lie. Consumed once; the create dialog re-offers the typed name.
  const [signupOrgFailure] = useState<SignUpOrgFailure | null>(() =>
    typeof window === 'undefined' ? null : consumeSignUpOrgFailure(),
  )

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
  useEffect(() => {
    // An intent on the URL already answers the question, and it outranks a
    // remembered one — it is what this visit says, not what a past one did.
    if (urlIntent) return void setStoredIntent(null)
    if (!uid || consumedForRef.current === uid) return void 0
    consumedForRef.current = uid
    let active = true
    void consumeOnboardingPlanIntent(firestore, uid).then((intent) => {
      if (active) setStoredIntent(intent)
    })
    return () => void (active = false)
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
    router.replace(enterOrg(slug))
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
      {loading || orgs.length === 1 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
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
                <Button
                  variant="text"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setCreatingSite(true)}
                >
                  {'Create my own site instead'}
                </Button>
                <CreateHostDialog
                  open={creatingSite}
                  onClose={() => setCreatingSite(false)}
                  destination={intent ? enterOrg : undefined}
                />
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
                    <Stack direction="row" spacing={1.5}>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => setCreatingSite(true)}
                      >
                        {'Create site'}
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
                {/* The first site provisions the workspace, so this is the
                    whole of the zero-org buyer's path: someone arriving from
                    a plan CTA with no workspace at all has no picker and no
                    create-workspace dialog to carry the intent for them. The
                    prop is passed only when there IS an intent, so an
                    ordinary first site still lands on its Setup page. */}
                <CreateHostDialog
                  open={creatingSite}
                  onClose={() => setCreatingSite(false)}
                  destination={intent ? enterOrg : undefined}
                />
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
              <GridItems
                spacing={3}
                items={visibleOrgs.map((org) => ({
                  size: { xs: 12, sm: 6, md: 4 },
                  children: (
                    <CardDisplay
                      contentGutterX
                      contentGutterY
                      HeaderProps={{
                        avatar: (
                          <MdiIcon
                            color="primary"
                            fontSize="large"
                            path={ICON_VARIANT_ORGANIZATION.path}
                          />
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
        </Container>
      )}
    </DashboardLayout>
  )
}

export default OrgJump
OrgJump.displayName = 'Page:OrgJump'
