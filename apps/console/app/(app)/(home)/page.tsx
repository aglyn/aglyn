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
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_HOST_GROUP,
  ICON_VARIANT_ORGANIZATION,
} from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import CreateHostDialog from '../../../components/create-host-dialog.component'
import CreateOrgDialog from '../../../components/create-org-dialog.component'
import EmptyState from '../../../components/empty-state.component'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import OrgInvitesBanner from '../../../components/org-invites-banner.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgScope } from '../../../hooks/use-org-scope'
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
  const { orgs, loading, confirmed } = useOrgScope()
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
    const intent = urlIntent ?? storedIntent
    if (intent) return void router.replace(onboardingDestination(slug, intent))
    router.replace(buildRoute(Route.HOST_LIST, { orgSlug: slug }))
  }, [loading, confirmed, orgs, router, storedIntent, urlIntent])

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
                />
              </Stack>
            ) : (
              <>
                <EmptyState
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
                <CreateHostDialog
                  open={creatingSite}
                  onClose={() => setCreatingSite(false)}
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
                <Typography variant="body2" color="text.secondary">
                  {'You belong to several organizations — pick one to manage.'}
                </Typography>
              </Box>
              <GridItems
                spacing={3}
                items={orgs.map((org) => ({
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
                        <Button
                          variant="contained"
                          disabled={!org.slug}
                          onClick={() =>
                            org.slug &&
                            router.push(
                              buildRoute(Route.HOST_LIST, {
                                orgSlug: org.slug,
                              }),
                            )
                          }
                        >
                          {'Open'}
                        </Button>
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
            </Stack>
          )}
          <CreateOrgDialog
            open={creatingOrg}
            onClose={() => setCreatingOrg(false)}
            initialName={signupOrgFailure?.name}
          />
        </Container>
      )}
    </DashboardLayout>
  )
}

export default OrgJump
OrgJump.displayName = 'Page:OrgJump'
