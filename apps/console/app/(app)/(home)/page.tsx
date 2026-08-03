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
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import CreateHostDialog from '../../../components/create-host-dialog.component'
import CreateOrgDialog from '../../../components/create-org-dialog.component'
import EmptyState from '../../../components/empty-state.component'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import OrgInvitesBanner from '../../../components/org-invites-banner.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'
import { useOrgScope } from '../../../hooks/use-org-scope'
import { usePendingInvites } from '../../../hooks/use-pending-invites'

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
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [creatingSite, setCreatingSite] = useState(false)

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
    const slug = orgs[0]?.slug
    if (slug) router.replace(buildRoute(Route.HOST_LIST, { orgSlug: slug }))
  }, [loading, confirmed, orgs, router])

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
          />
        </Container>
      )}
    </DashboardLayout>
  )
}

export default OrgJump
OrgJump.displayName = 'Page:OrgJump'
