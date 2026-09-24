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
  type AglynOrgBilling,
  checkEntitlement,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import {
  describeVariantComparison,
  experimentResultRows,
  type ExperimentStatsByVariant,
  type HostExperiment,
} from '../model'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore'
import { Fragment, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { ExperimentResultZone } from './experiment-zones'
import { EXPERIMENT_STATUS_COLORS } from './host-experiments-card.component'
import { useMarketingOrgMount } from './marketing-org-mount'
import {
  OrgSitePickerButton,
  orgSiteSectionHref,
} from './org-site-picker-button'
import { ORG_SITES_PER_PAGE, useOrgSiteReads } from './use-one-shot-reads'

/**
 * How many A/B tests are read for each site.
 *
 * The same bargain as the org overlay list: a site runs a few tests at a
 * time, a page here holds a page of sites' worth of them, and a site with
 * more says so on its row and links to its own list, which pages through
 * every one.
 */
export const ORG_EXPERIMENTS_PER_SITE = 10

type ExperimentRow = HostExperiment & { $id: string; deletedAt?: unknown }

interface SiteExperiments {
  rows: ExperimentRow[]
  truncated: boolean
}

/**
 * One site's tests, ordered by name as the site's own list pages them —
 * `name` is on every experiment, since the one editor that creates them
 * refuses a save without it.
 */
async function readSiteExperiments(
  firestore: Firestore,
  hostId: string,
): Promise<SiteExperiments> {
  const snapshot = await getDocs(
    query(
      collection(firestore, 'hosts', hostId, 'experiments'),
      orderBy('name'),
      limit(ORG_EXPERIMENTS_PER_SITE + 1),
    ),
  )
  const { rows, truncated } = ceilingedWindow(
    snapshot.docs.map(
      (entry) => ({ ...(entry.data() as HostExperiment), $id: entry.id }) as ExperimentRow,
    ),
    ORG_EXPERIMENTS_PER_SITE,
  )
  return { rows: rows.filter((row) => !row.deletedAt), truncated }
}

const TARGET_LABEL: Record<string, string> = {
  screen: 'Screen',
  section: 'Section',
  email: 'Email',
}

/** Columns in a row, so a site's own line can span all of them. */
const COLUMNS = 5

export interface OrgExperimentsCardProps {
  /** The org's plan, for the `abTesting` entitlement. */
  org?: Partial<AglynOrgBilling>
}

/**
 * Every site's A/B tests, on the organization's Marketing hub.
 *
 * A test splits ONE site's traffic between versions of that site's screens,
 * sections or emails, so it is created, started and decided on the site:
 * the New button and each row's Open go to the site's own A/B testing
 * section. What the org hub adds is the view across sites, and each test's
 * results — read when somebody asks for them, one document per variant,
 * rather than for every test on every visit.
 *
 * Grouped by site and paged by site, like the org overlay list, so turning
 * the page reads the next sites and nothing else.
 */
export function OrgExperimentsCard(props: OrgExperimentsCardProps) {
  const { org } = props
  const mount = useMarketingOrgMount()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const entitled = checkEntitlement(org, 'abTesting')

  const sites = mount?.hosts ?? []
  const [page, setPage] = useState(0)
  const pageSites = sites.slice(
    page * ORG_SITES_PER_PAGE,
    (page + 1) * ORG_SITES_PER_PAGE,
  )
  const { reads } = useOrgSiteReads<SiteExperiments>(
    entitled ? pageSites.map((site) => site.id) : [],
    (hostId) => readSiteExperiments(firestore, hostId),
    [firestore, entitled],
  )

  const [results, setResults] = useState<{
    hostId: string
    siteName: string
    experiment: ExperimentRow
    stats: ExperimentStatsByVariant
  } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  /** The per-variant counters of one test, `experiments/{id}/stats`. */
  const openResults = async (
    hostId: string,
    siteName: string,
    experiment: ExperimentRow,
  ) => {
    setOpening(experiment.$id)
    try {
      const snapshot = await getDocs(
        collection(
          firestore,
          'hosts',
          hostId,
          'experiments',
          experiment.$id,
          'stats',
        ),
      )
      const stats: ExperimentStatsByVariant = {}
      snapshot.forEach((entry) => {
        stats[entry.id] = entry.data()
      })
      setResults({ hostId, siteName, experiment, stats })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The results could not be read', { variant: 'error' })
    } finally {
      setOpening(null)
    }
  }

  const resultsHref =
    results && mount
      ? orgSiteSectionHref(mount, results.hostId, 'experiments')
      : null

  return (
    <CardDisplay
      header="Experiments"
      subheader="Every site in this organization"
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#experiments-across-sites',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!entitled ? (
        <Alert severity="info">
          {'A/B experiments are included in the Business plan — see ' +
            'Billing to upgrade.'}
        </Alert>
      ) : !mount || !mount.hostsReady ? null : !sites.length ? (
        <Typography variant="body2" color="text.secondary">
          {'This organization has no sites yet. A test splits one site’s ' +
            'traffic, so it is created on a site.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2" color="text.secondary">
              {'Each test splits one site’s traffic. Read any test’s results ' +
                'here; create, start and decide them on the site.'}
            </Typography>
            <OrgSitePickerButton
              mount={mount}
              section="experiments"
              label="New experiment"
            />
          </Stack>
          <ScrollTable size="small" aria-label="Experiments by site">
            <TableHead>
              <TableRow>
                <TableCell>{'Experiment'}</TableCell>
                <TableCell>{'Tests'}</TableCell>
                <TableCell>{'Variants'}</TableCell>
                <TableCell>{'Status'}</TableCell>
                <TableCell align="right">{'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageSites.map((site) => {
                const read = reads.get(site.id)
                const answer = read?.value ?? null
                const href = orgSiteSectionHref(mount, site.id, 'experiments')
                const name = site.name || site.subdomain || site.id
                return (
                  <Fragment key={site.id}>
                    {/* The site's own line: its name, and what was not read. */}
                    <TableRow>
                      <TableCell colSpan={COLUMNS}>
                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                        >
                          <Typography variant="subtitle2">
                            {href ? <AppLink href={href}>{name}</AppLink> : name}
                          </Typography>
                          {answer?.truncated ? (
                            <Typography variant="caption" color="text.secondary">
                              {`More than ${ORG_EXPERIMENTS_PER_SITE} on this ` +
                                'site — these are the first by name; the ' +
                                'site’s own list has every one.'}
                            </Typography>
                          ) : null}
                        </Stack>
                      </TableCell>
                    </TableRow>
                    {read?.status === 'error' ? (
                      <TableRow>
                        <TableCell colSpan={COLUMNS}>
                          <Typography variant="body2" color="text.secondary">
                            {'This site’s experiments could not be read.'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : answer && !answer.rows.length ? (
                      <TableRow>
                        <TableCell colSpan={COLUMNS}>
                          <Typography variant="body2" color="text.secondary">
                            {'No experiments on this site.'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      (answer?.rows ?? []).map((experiment) => (
                        <TableRow key={experiment.$id}>
                          <TableCell>{experiment.name || experiment.$id}</TableCell>
                          <TableCell>
                            {TARGET_LABEL[experiment.target] ?? experiment.target}
                          </TableCell>
                          <TableCell>
                            {(experiment.variants ?? []).length.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={
                                EXPERIMENT_STATUS_COLORS[experiment.status] ??
                                'default'
                              }
                              label={experiment.status}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              color="primary"
                              disabled={opening === experiment.$id}
                              aria-label={`Results for ${experiment.name || experiment.$id} on ${name}`}
                              onClick={() =>
                                void openResults(site.id, name, experiment)
                              }
                            >
                              {'Results'}
                            </Button>
                            {/* A site the shell could not address has no section to open. */}
                            {href ? (
                              <AppLink
                                componentVariant="button"
                                href={href}
                                size="small"
                                color="primary"
                                aria-label={`Open ${experiment.name || experiment.$id} on ${name}`}
                              >
                                {'Open'}
                              </AppLink>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </ScrollTable>
          <ListPagination
            page={page}
            pageSize={ORG_SITES_PER_PAGE}
            rowCount={pageSites.length}
            count={sites.length}
            onPageChange={setPage}
            labelDisplayedRows={({ from, to, count }) =>
              `Sites ${from}–${to} of ${count}`
            }
          />
        </Stack>
      )}

      {/*
        The site card's results, read-only: picking a winner changes what a
        site serves, so it is done on the site, one link away.
       */}
      <Dialog
        open={Boolean(results)}
        onClose={() => setResults(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {`Results — ${results?.experiment.name ?? ''}`}
          {results?.experiment.autoCompleted ? (
            <Chip
              size="small"
              color="success"
              label="Auto-completed"
              sx={{ ml: 1 }}
            />
          ) : null}
        </DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">
            {results ? `On ${results.siteName}` : ''}
          </Typography>
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Variant'}</TableCell>
                <TableCell>{'Exposures'}</TableCell>
                <TableCell>{'Conversions'}</TableCell>
                <TableCell>{'Rate'}</TableCell>
                <TableCell>{'vs control'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(results
                ? experimentResultRows(results.experiment, results.stats)
                : []
              ).map(({ variant, summary, comparison, leader, winner }) => (
                <TableRow key={variant.id} selected={leader}>
                  <TableCell>
                    {variant.name ?? variant.id.toUpperCase()}
                    {winner ? ' 🏆' : leader ? ' ▲' : ''}
                  </TableCell>
                  <TableCell>{summary.exposures}</TableCell>
                  <TableCell>{summary.conversions}</TableCell>
                  <TableCell>{`${(summary.rate * 100).toFixed(1)}%`}</TableCell>
                  <TableCell>{describeVariantComparison(comparison)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
          {results ? (
            <ExperimentResultZone
              hostId={results.hostId}
              experimentId={results.experiment.$id}
              test={results.experiment.name?.trim() || results.experiment.$id}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          {resultsHref ? (
            <AppLink
              componentVariant="button"
              href={resultsHref}
              size="small"
              color="primary"
            >
              {'Open on the site'}
            </AppLink>
          ) : null}
          <Button color="inherit" onClick={() => setResults(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgExperimentsCard.displayName = 'OrgExperimentsCard'

export default OrgExperimentsCard
