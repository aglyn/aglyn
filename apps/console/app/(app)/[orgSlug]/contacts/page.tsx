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
  CAPTURED_BY_HOST_FIELD,
  checkContactQuota,
  MAX_SCOPE_HOSTS,
  orgContactConsentLabel,
  orgContactRow,
  type OrgContactHostConsent,
  type OrgContactRow,
} from '@aglyn/aglyn'
import { mdiCardAccountDetailsOutline, mdiOpenInNew } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  MdiIcon,
  AppLink,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  documentId,
  getCountFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  collectionPage,
  useFirestore,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import FeatureGate from '../../../../components/feature-gate.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  CONTENT_MAX_WIDTH,
  TABLE_ROW_HEIGHT,
} from '../../../../constants/shared'
import useCurrentOrg from '../../../../hooks/use-current-org'
import useOrgHosts from '../../../../hooks/use-org-hosts'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import { useOrgReach } from '../../../../hooks/use-org-reach'
import { useReleaseFlag } from '../../../../hooks/use-release-flags'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import {
  orgContactsRefusalNotice,
  resolveOrgContactsAccess,
} from '../../../../utils/org-contacts-access'

/**
 * THE ORGANIZATION'S ADDRESS BOOK.
 *
 * A contact document is shared by every site in the org: one human who
 * touched two of them is ONE row. That is the dedupe the shared address book
 * exists for, it is what keeps a suppression describing one person, and it is
 * what makes the billing unit — unique people per org — mean anything. Until
 * this page there was no surface anywhere that showed the deduped person, so
 * the entire benefit of the model was invisible and its price looked
 * arbitrary.
 *
 * This page answers what a site page cannot: **who does this organization
 * know, across every site, and which sites know them.**
 *
 * ## What it deliberately does NOT show
 *
 * Notes, tags, activity, call logs and commercial figures live under
 * `facets.{groupId}` and are the holder's own business records. This is the
 * one surface in the product designed to cross the host boundary, which makes
 * it the one place where showing them would re-create exactly the disclosure
 * the facets closed — an agency's client reading another client's notes about
 * a person they both know. `orgContactRow` is an allow-list for that reason
 * and this page renders nothing it did not return.
 *
 * ## There is no create here, and that is not an omission
 *
 * A contact is CAPTURED, by a site, through a form or an order or a booking —
 * the capture is what attributes it and what gives its consent a controller.
 * An org-level create would have to invent both. Creating and editing belong
 * on the site's own Contacts surface, which is a click away from every row.
 */
function OrgContacts() {
  const orgSlug = useOrgSlug()
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const orgId = currentOrg?.$id

  /*==========================================
   * THE GATE.
   *
   * Reach first, permission second — see `resolveOrgContactsAccess` for why
   * the order is load-bearing and why a permission alone (which a SITE
   * COLLABORATOR holds) is not an org-level check.
   *
   * `OrgGuard` in the parent layout already redirects a scoped collaborator
   * off every org route, and the Firestore rules already refuse them the
   * unfiltered list this page runs. This is the third rail, not the only one,
   * and it is the one that can say WHY.
   *=========================================*/
  const { orgWide, ready: reachReady } = useOrgReach()
  const {
    can,
    loaded: permissionsLoaded,
    errored: permissionsErrored,
  } = useOrgPermissions()
  const access = resolveOrgContactsAccess({
    orgWide,
    reachReady,
    can,
    permissionsLoaded,
    permissionsErrored,
  })
  const admitted = access === 'granted'
  /*
   * The release flag, read for the HEADER as well as the body.
   *
   * `FeatureGate` below covers the surface itself, but `headerRight` sits
   * outside it — so without this a flagged-off org reads its audience band
   * over a coming-soon notice, which is a figure about a feature it has not
   * been given. `visible` rather than `released`: staff previewing the
   * surface should see the same header the customer eventually will.
   */
  const { visible: contactsVisible } = useReleaseFlag('release_contacts')

  /*==========================================
   * WHICH SITES, AND WHAT THEY ARE CALLED.
   *
   * The contact document holds host IDS. Names come from the org's own site
   * list, which this reader can already see — one read for the whole page
   * rather than a lookup per row.
   *=========================================*/
  const { hosts, ready: hostsReady } = useOrgHosts(
    firestore,
    (user as any)?.uid,
    orgId ?? undefined,
  )
  const hostNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const host of hosts) {
      const name =
        (host['displayName'] as string) || (host['subdomain'] as string) || ''
      if (name) names.set(host.$id, name)
    }
    return names
  }, [hosts])
  /**
   * Host id → the SUBDOMAIN a console URL is built from.
   *
   * `/[orgSlug]/hosts/[host]/...` takes the subdomain, not the document id —
   * the contact document holds the id, so a link built straight from
   * `capturedByHostIds` is a dead route that renders the site-not-found page.
   * A site whose subdomain has not resolved gets no link rather than a broken
   * one, and the menu says why.
   */
  const hostSlugs = useMemo(() => {
    const slugs = new Map<string, string>()
    for (const host of hosts) {
      const subdomain = host['subdomain'] as string | undefined
      if (subdomain) slugs.set(host.$id, subdomain)
    }
    return slugs
  }, [hosts])
  /**
   * A capturing site the viewer cannot name.
   *
   * Rendered as its raw id rather than dropped. A site that has been deleted,
   * or whose document this read did not answer for, still HELD a relationship
   * with this person — and the column's whole job is saying how many sites
   * do. Hiding the ones we cannot label would understate that, silently, in
   * the direction that makes the page look tidier than the truth.
   */
  const siteName = (hostId: string) => hostNames.get(hostId) ?? hostId

  /*==========================================
   * THE HOST FILTER — "everyone captured on A, B or C".
   *
   * `capturedByHostIds` is a top-level array precisely so this question can be
   * a QUERY rather than a client-side sift over a page.
   *=========================================*/
  const [hostFilter, setHostFilter] = useState<string[]>([])
  /**
   * `array-contains-any` accepts at most this many values, so a selection
   * past it cannot be expressed as one query.
   *
   * Truncating the SELECTION rather than the RESULT is deliberate: a query
   * built from a silently-clipped list answers about sites the reader did not
   * ask about and, worse, omits ones they did — with a full-looking table and
   * nothing to notice. The picker refuses the extra site and says so instead.
   */
  const filterCeilingHit = hostFilter.length >= MAX_SCOPE_HOSTS
  const hostFilterKey = hostFilter.join(',')

  const {
    status,
    rows: contactDocs,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) => {
      if (!orgId || !admitted) return null
      const ref = collection(firestore, 'orgs', orgId, 'contacts')
      /*
       * ORDERED ON THE DOCUMENT ID, and paged.
       *
       * `limit()` with no `orderBy` is answered in document-id order, so an
       * unordered cap is a pseudo-random SAMPLE and a client `.sort()` over it
       * makes the wrong rows look reliably newest-first. `collectionPage`
       * holds that decision.
       *
       * It orders on the id rather than on `updatedAt` because `orderBy`
       * matches only documents that HAVE the field: a contact written by a
       * path that never stamped one would not be mis-ordered, it would be
       * HIDDEN — and this is the org's whole address book, where a missing
       * person is the failure that matters. A document's name cannot be
       * absent, so this walk is TOTAL: every contact is reachable by paging.
       *
       * The price is that the window is an arbitrary slice rather than the
       * most recent one, which is why the caption below says so rather than
       * letting the order be read as a recency.
       *
       * ⛔ Nothing may re-sort the page. Re-ordering a slice of an id-ordered
       * walk is the same lie: rows run in one order within a page and another
       * across pages, and the first page is still not the first page of the
       * order shown.
       */
      if (!hostFilter.length) return collectionPage(ref, pageLimit)
      return query(
        ref,
        where(CAPTURED_BY_HOST_FIELD, 'array-contains-any', hostFilter),
        orderBy(documentId()),
        limit(pageLimit),
      )
    },
    [firestore, orgId, admitted, hostFilterKey],
    { idField: '$id' },
  )

  /**
   * The org's contact TOTAL, as a server aggregate.
   *
   * The table holds ten rows. The number this page exists to stand behind is
   * how many unique people the organization knows, which is also what it is
   * billed on — so it cannot be `rows.length`, and it cannot be the size of
   * any window. One `count()` per mount, against the same collection the
   * billing usage cron counts, so the readout and the invoice cannot
   * disagree.
   *
   * `null` until it answers and on failure alike: the readout renders a bare
   * count rather than a denominator invented from an unresolved read.
   */
  const [contactTotal, setContactTotal] = useState<number | null>(null)
  useEffect(() => {
    if (!orgId || !admitted) return undefined
    let active = true
    void getCountFromServer(collection(firestore, 'orgs', orgId, 'contacts'))
      .then((snapshot) => {
        if (active) setContactTotal(snapshot.data().count)
      })
      .catch(() => {
        // A refused or failed aggregate leaves the figure unknown. The page
        // says nothing about the total rather than reporting the page size as
        // one, which is what a saturated count reads as.
        if (active) setContactTotal(null)
      })
    return () => {
      active = false
    }
  }, [firestore, orgId, admitted])

  const quota = checkContactQuota(org, contactTotal ?? 0)
  /**
   * The total the FOOTER may quote, which is not always the org's.
   *
   * The aggregate counts the whole collection, so it describes the list only
   * while the list is the whole list. Handed to a FILTERED footer it reads
   * "1-10 of 4,213" over three matching rows — a number that is true about
   * the organization and false about the thing it is printed under, which is
   * the worse kind of wrong because it looks authoritative.
   *
   * Filtered, the footer falls back to `hasMore`, which says "more than this"
   * and stops claiming a total nobody has counted. The header readout keeps
   * the org figure: that one is a fact about the PLAN, and the filter does
   * not change how many people the organization knows.
   */
  const listTotal = hostFilter.length ? undefined : (contactTotal ?? undefined)

  /** Every row, projected to what the ORG may see. Facets never enter. */
  const rows: OrgContactRow[] = useMemo(
    () =>
      (contactDocs ?? []).map((record: any) =>
        orgContactRow(record, String(record.$id), org as Record<string, unknown>),
      ),
    [contactDocs, org],
  )

  const [openContact, setOpenContact] = useState<OrgContactRow | null>(null)

  const columns: GridColDef[] = [
    {
      field: 'email',
      headerName: 'Person',
      flex: 1,
      minWidth: 240,
      type: 'string',
      renderCell: ({ row }: { row: OrgContactRow }) => (
        <Stack sx={{ justifyContent: 'center', height: '100%' }}>
          {row.name ? (
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {row.name}
            </Typography>
          ) : null}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {row.email || '--'}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'capturedByHostIds',
      headerName: 'Known by',
      flex: 1,
      minWidth: 220,
      sortable: false,
      renderCell: ({ row }: { row: OrgContactRow }) =>
        row.capturedByHostIds.length ? (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', height: '100%', flexWrap: 'nowrap' }}
          >
            {row.capturedByHostIds.slice(0, 2).map((hostId) => (
              <Chip key={hostId} size="small" label={siteName(hostId)} />
            ))}
            {row.capturedByHostIds.length > 2 ? (
              <Chip
                size="small"
                variant="outlined"
                label={`+${row.capturedByHostIds.length - 2}`}
              />
            ) : null}
          </Stack>
        ) : (
          /*
           * Unattributed, not unknown. A row written before the attribution
           * existed names no site, and reading that as "every site" would put
           * a person in front of businesses that never met them.
           */
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {'No site recorded'}
          </Typography>
        ),
    },
    {
      field: 'consent',
      headerName: 'Marketing consent',
      flex: 1,
      minWidth: 260,
      sortable: false,
      renderCell: ({ row }: { row: OrgContactRow }) => (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', height: '100%', flexWrap: 'nowrap' }}
        >
          {row.consent.length ? (
            <>
              {row.consent.slice(0, 2).map((entry) => (
                <ConsentChip
                  key={entry.hostId}
                  entry={entry}
                  siteName={siteName(entry.hostId)}
                />
              ))}
              {row.consent.length > 2 ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`+${row.consent.length - 2}`}
                />
              ) : null}
            </>
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {'--'}
            </Typography>
          )}
        </Stack>
      ),
    },
    listActionsColumn((row: OrgContactRow) => (
      <ListRowActions
        label={row.name || row.email || row.$id}
        quick={{
          icon: mdiCardAccountDetailsOutline.path,
          label: 'Details',
          onClick: () => setOpenContact(row),
        }}
        items={[
          /*
           * The bridge between the two halves of the CRM. This page says WHICH
           * sites know the person; a site's own Contacts page is where that
           * holder's notes, tags, timeline and order history live — and it is
           * the only place they may be read, by somebody who holds that site.
           */
          ...row.capturedByHostIds.map((hostId) => {
            const host = hostSlugs.get(hostId)
            return {
              key: `open-${hostId}`,
              label: `Open in ${siteName(hostId)}`,
              icon: <MdiIcon path={mdiOpenInNew.path} size={0.8} />,
              ...(host
                ? {
                    href: buildRoute(Route.HOST_PLUGIN, {
                      orgSlug,
                      host,
                      pluginSlug: 'contacts',
                    }),
                  }
                : {
                    disabled: true,
                    disabledReason:
                      'This site is no longer one you can open, so its ' +
                      'records cannot be reached from here.',
                  }),
            }
          }),
        ]}
      />
    )),
  ]

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Contacts',
          href: buildRoute(Route.ORG_CONTACTS, { orgSlug }),
        },
      ]}
      help="contacts"
      header={{
        children: 'Contacts',
        icon: { path: mdiCardAccountDetailsOutline.path },
      }}
      headerRight={
        /*
         * The quota belongs in the PAGE header: this surface has no vertical
         * sections, so there is no card header to carry it, and the figure is
         * a fact about the page rather than about the list beneath it.
         *
         * It is also the one place the figure is honest. The number here is
         * the org's unique-person total from a server aggregate — which is
         * exactly the unit billing counts — rather than the size of a window.
         */
        admitted && contactsVisible ? (
          <QuotaReadoutComponent
            ready={orgReady && contactTotal !== null}
            used={contactTotal ?? 0}
            limit={quota.included}
            noun="contact"
          />
        ) : undefined
      }
      aside={
        <OrgContactDrawer
          contact={openContact}
          onClose={() => setOpenContact(null)}
          orgSlug={orgSlug}
          siteName={siteName}
          hostSlug={(hostId) => hostSlugs.get(hostId)}
        />
      }
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <FeatureGate flag="release_contacts">
          {access === 'pending' ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          ) : access === 'unavailable' ? (
            <Alert severity="warning">
              {"We couldn't confirm your access to this organization. " +
                'Reload the page, and if it keeps happening sign out and ' +
                'back in.'}
            </Alert>
          ) : access === 'refused' ? (
            <Alert severity="info">
              {orgContactsRefusalNotice(reachReady && !orgWide ? 'scoped' : 'permission')}
            </Alert>
          ) : (
            <CardDisplay>
              <Stack spacing={2} sx={{ p: 2, pb: 0 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {'Everyone your organization knows, deduplicated across ' +
                    'every site. Notes, tags and history stay on the site ' +
                    'that holds them — open a person in a site to see those.'}
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Captured by"
                  sx={{ maxWidth: 360 }}
                  value={hostFilter}
                  onChange={(event) => {
                    const next = event.target.value as unknown as string[]
                    setHostFilter(next.slice(0, MAX_SCOPE_HOSTS))
                  }}
                  disabled={!hostsReady}
                  helperText={
                    filterCeilingHit
                      ? `Filtering by the first ${MAX_SCOPE_HOSTS} sites — one query cannot ask about more.`
                      : 'Any site, unless you pick some.'
                  }
                  slotProps={{
                    // `displayEmpty` renders a placeholder inside the field,
                    // which a floating label would sit on top of.
                    inputLabel: { shrink: true },
                    select: {
                      multiple: true,
                      renderValue: (selected: unknown) =>
                        (selected as string[]).length
                          ? (selected as string[])
                              .map((hostId) => siteName(hostId))
                              .join(', ')
                          : 'Any site',
                      displayEmpty: true,
                    },
                  }}
                >
                  {hosts.map((host) => (
                    <MenuItem key={host.$id} value={host.$id}>
                      <Checkbox
                        size="small"
                        checked={hostFilter.includes(host.$id)}
                      />
                      <ListItemText primary={siteName(host.$id)} />
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <ListTable
                rowHeight={TABLE_ROW_HEIGHT}
                columns={columns}
                rows={rows}
                noRowsLabel="No contacts yet"
                noRowsDescription={
                  hostFilter.length
                    ? 'No one has been captured by the sites you picked.'
                    : 'People arrive here when a site captures them — a form ' +
                      'submission, an order, a booking or a signup.'
                }
                onOpen={(_id, row) => setOpenContact(row as OrgContactRow)}
                loading={status === 'loading'}
                // Paged by the footer below, so the grid must not also slice.
                hideFooter
              />
              {/*
                THE COUNT IS THE SERVER'S, NOT THE PAGE'S.
                Handing `ListPagination` the real total is what makes the
                footer read "1–10 of 4,213" instead of implying that ten is
                all there is. When the aggregate has not answered, `hasMore`
                carries the disclosure instead: MUI renders "of more than 10"
                rather than a number nobody has earned.
              */}
              <ListPagination
                page={page}
                pageSize={pageSize}
                rowCount={rows.length}
                count={listTotal}
                hasMore={hasMore}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
              {hasMore || (listTotal ?? 0) > rows.length ? (
                <Box sx={{ px: 2, pb: 2 }}>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary' }}
                  >
                    {'This page is one window of a stable walk through every ' +
                      'contact — not the most recent ones. Page through to ' +
                      'reach them all.'}
                  </Typography>
                </Box>
              ) : null}
            </CardDisplay>
          )}
        </FeatureGate>
      </Container>
    </DashboardLayout>
  )
}

/**
 * One consent verdict, rendered.
 *
 * The label always names the controller — `orgContactConsentLabel` is what
 * guarantees that, and the color follows the basis rather than replacing it:
 * a green chip with no name on it would be a bare "consented", which is the
 * claim this whole model exists to stop anybody making.
 */
function ConsentChip(props: {
  entry: OrgContactHostConsent
  siteName: string
}) {
  const { entry, siteName } = props
  return (
    <Chip
      size="small"
      color={
        entry.basis === 'granted'
          ? 'success'
          : entry.basis === 'declined'
            ? 'error'
            : 'default'
      }
      variant={entry.basis === 'unrecorded' ? 'outlined' : 'filled'}
      label={orgContactConsentLabel(entry, siteName)}
    />
  )
}

/**
 * One person, expanded — still the org view.
 *
 * A drawer rather than a detail route because there is nothing to edit here:
 * every editable field on a contact belongs to a holder, and editing happens
 * on that holder's own site page. A read-only expansion of the row is what
 * this is, so it is a panel over the list it came from.
 */
function OrgContactDrawer(props: {
  contact: OrgContactRow | null
  onClose: () => void
  orgSlug: string
  siteName: (hostId: string) => string
  hostSlug: (hostId: string) => string | undefined
}) {
  const { contact, onClose, orgSlug, siteName, hostSlug } = props
  return (
    <Drawer anchor="right" open={Boolean(contact)} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: 420 }, p: 3 }}>
        {contact ? (
          <Stack spacing={3}>
            <Stack spacing={0.5}>
              <Typography variant="h6">
                {contact.name || contact.email || contact.$id}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {contact.email}
              </Typography>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="overline">{'Known by'}</Typography>
              {contact.capturedByHostIds.length ? (
                contact.capturedByHostIds.map((hostId) => {
                  const host = hostSlug(hostId)
                  /*
                   * ONE ELEMENT IN BOTH BRANCHES, with the `href` dropped
                   * rather than the anchor.
                   *
                   * A site whose subdomain has not resolved must still be
                   * NAMED — the relationship is real and hiding it would
                   * understate who knows this person — but it must not be
                   * linked, because the route would not exist. Switching to a
                   * different ELEMENT for that case is what makes the server
                   * and client renders disagree and remounts the subtree at
                   * hydration, so the anchor stays and only its destination
                   * goes: an `<a>` with no `href` is HTML's placeholder link.
                   */
                  return (
                    <AppLink
                      key={hostId}
                      href={
                        host
                          ? buildRoute(Route.HOST_PLUGIN, {
                              orgSlug,
                              host,
                              pluginSlug: 'contacts',
                            })
                          : undefined
                      }
                    >
                      {siteName(hostId)}
                    </AppLink>
                  )
                })
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {'No site recorded'}
                </Typography>
              )}
            </Stack>
            <Stack spacing={1}>
              <Typography variant="overline">{'Marketing consent'}</Typography>
              {contact.consent.length ? (
                contact.consent.map((entry) => (
                  <Stack key={entry.hostId} spacing={0.5}>
                    <ConsentChip
                      entry={entry}
                      siteName={siteName(entry.hostId)}
                    />
                    {entry.declared ? (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                      >
                        {`Given to ${entry.groupName ?? entry.groupId}, which ${siteName(entry.hostId)} is part of.`}
                      </Typography>
                    ) : null}
                  </Stack>
                ))
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {'--'}
                </Typography>
              )}
            </Stack>
            <Alert severity="info" icon={false}>
              {"Notes, tags, activity and order history belong to the site " +
                'that recorded them. Open this person in one of the sites ' +
                'above to see what it holds.'}
            </Alert>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  )
}

OrgContacts.displayName = 'Page:OrgContacts'

export default OrgContacts
