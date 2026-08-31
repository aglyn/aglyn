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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { Section } from '@aglyn/shared-ui-email-campaigns/components/report-figures'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { buildRoute, CAMPAIGN_MEMBERSHIP_FIELD, Route } from '@aglyn/aglyn'
import {
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'

/**
 * How many members of one kind the section enumerates.
 *
 * One document past it is asked for, so "this campaign holds more than are
 * listed" is a fact rather than a guess — the same probe the emails table on
 * this page makes.
 */
const MEMBER_CEILING = 25

export interface CampaignMembersSectionProps {
  hostId: string
  campaignId: string
}

/**
 * The rows a reader may act on: the window, minus what has been deleted.
 *
 * The soft delete is filtered HERE and not in the query. `deletedAt` is
 * written only when a record is removed, so `where('deletedAt', '==', null)`
 * would match nothing at all — Firestore's equality matches documents that
 * HAVE the field — and every live record would vanish from the campaign. The
 * campaigns table filters its own soft-deleted containers the same way.
 */
function live(
  docs: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  return (docs ?? [])
    .slice(0, MEMBER_CEILING)
    .filter((row) => !row['deletedAt'])
}

/** One row, whatever collection it came out of. */
interface MemberRow {
  id: string
  name: string
  href: string | null
  /** Why there is no link, when there is none. */
  hrefReason?: string
}

/**
 * WHAT ELSE IS IN THIS CAMPAIGN — the landing pages and forms assigned to it.
 *
 * ## Declared, and therefore different from every section above it
 *
 * The conversions, revenue and destinations sections are EVIDENCE: they join
 * on the campaign's send ids and report what visitors did. This one is a
 * statement the merchant made — a screen or a form carries this campaign's id
 * in {@link CAMPAIGN_MEMBERSHIP_FIELD}, and that is the whole of what is
 * claimed here. The two can disagree, and both are true: a landing page
 * assigned to the spring campaign is still assigned to it on a day nobody
 * visited.
 *
 * So the heading says "assigned", never "reached", and no figure on this page
 * is computed from these rows.
 *
 * ## The join is `array-contains`, on the member's own document
 *
 * A campaign holds no member list. Each record names the campaigns it is in,
 * which is what makes deleting one record leave nothing behind and what lets
 * a record's own page draw its campaigns without a query. The query here is
 * the other direction of the same field, served by Firestore's automatic
 * single-field index.
 *
 * `orderBy(documentId())`, like every other bounded list in this console: a
 * form carries `updatedAt` only if some writer stamped one, and ordering on a
 * field a writer may omit does not mis-sort the list, it drops rows from it.
 *
 * ## Contacts are named here and NOT listed, and the reason is a query limit
 *
 * A contact is org-scoped and shared between the sites that captured it, so
 * every client read of the collection has to carry
 * `visibleTo array-contains-any` — that is what makes the read provable
 * per-document under the rules. Firestore permits ONE array clause per query,
 * and that is it: there is no client query that filters contacts by campaign
 * as well. The assignment is real and is set from the contact's own drawer;
 * what cannot be built on this page is the list of them, and saying so is
 * better than a count that silently describes the newest thousand contacts.
 */
export function CampaignMembersSection(props: CampaignMembersSectionProps) {
  const { hostId, campaignId } = props
  const firestore = useFirestore()
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)

  const memberQuery = (collectionName: string) => () =>
    query(
      collection(firestore, 'hosts', hostId, collectionName),
      where(CAMPAIGN_MEMBERSHIP_FIELD, 'array-contains', campaignId),
      orderBy(documentId()),
      limit(MEMBER_CEILING + 1),
    )

  const { data: screenDocs, status: screensStatus } = useFirestoreCollection<
    Record<string, unknown>
  >(memberQuery('screens'), [firestore, hostId, campaignId], {
    idField: '$id',
  })
  const { data: formDocs, status: formsStatus } = useFirestoreCollection<
    Record<string, unknown>
  >(memberQuery('forms'), [firestore, hostId, campaignId], { idField: '$id' })

  const screens = useMemo<MemberRow[]>(() => {
    return live(screenDocs).map((row) => {
      const id = String(row['$id'])
      const versionId = String(row['versionId'] ?? '')
      return {
        id,
        name: String(row['displayName'] ?? id),
        /*
         * A screen with no saved version has no detail address to build —
         * the route carries a version — so it stays plain text rather than
         * linking somewhere that 404s. The screens list applies the same
         * guard to its own name column.
         */
        href:
          versionId && orgSlug && host
            ? buildRoute(Route.SCREEN_DETAILS, {
                orgSlug,
                host,
                screenId: id,
                versionId,
              })
            : null,
        hrefReason: versionId
          ? 'This site’s console URL has not resolved yet'
          : 'This screen has no saved version yet',
      }
    })
  }, [screenDocs, orgSlug, host])

  const forms = useMemo<MemberRow[]>(() => {
    return live(formDocs).map((row) => {
      const id = String(row['$id'])
      return {
        id,
        name: String(row['displayName'] ?? id),
        href:
          orgSlug && host
            ? buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId: id })
            : null,
        hrefReason: 'This site’s console URL has not resolved yet',
      }
    })
  }, [formDocs, orgSlug, host])

  const screensTruncated = (screenDocs ?? []).length > MEMBER_CEILING
  const formsTruncated = (formDocs ?? []).length > MEMBER_CEILING
  const settled = screensStatus !== 'loading' && formsStatus !== 'loading'

  return (
    <Section title="Assigned to this campaign">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The pages and forms somebody put in this campaign. Assignment is ' +
            'a grouping — what the campaign was credited with is measured ' +
            'above, from the links its emails carried.'}
        </Typography>
        <MemberTable
          heading="Screens"
          noun="screen"
          rows={screens}
          truncated={screensTruncated}
          settled={settled}
        />
        <MemberTable
          heading="Forms"
          noun="form"
          rows={forms}
          truncated={formsTruncated}
          settled={settled}
        />
        {/*
          The people, named rather than omitted.

          A contact CAN be filed under a campaign and this page cannot list
          them — see the module comment for the query rule that decides it.
          Leaving the heading out entirely would read as "contacts cannot be
          assigned", which is the one thing it does not mean.
         */}
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            {'Contacts'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {'Contacts are filed under a campaign from the contact’s own ' +
              'panel on the Contacts page, where they are also filtered. ' +
              'They are not listed here: a contact belongs to the ' +
              'organization rather than to this site, so the query that ' +
              'reads them is already spending its one array filter on which ' +
              'sites may see the person.'}
          </Typography>
        </Stack>
      </Stack>
    </Section>
  )
}

/**
 * One kind's members, paged on the shared footer.
 *
 * The page is a SLICE of a window this component already holds — the same
 * arrangement the campaign's emails table beside it uses, and for the same
 * reason: the ceiling bounds the read, and the footer lets a reader walk what
 * came back without the card deciding how many rows fit.
 */
function MemberTable(props: {
  heading: string
  noun: string
  rows: MemberRow[]
  truncated: boolean
  settled: boolean
}) {
  const { heading, noun, rows, truncated, settled } = props
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize)
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        {heading}
      </Typography>
      {truncated ? (
        <Alert severity="info">
          {`More than ${MEMBER_CEILING} ${noun}s are in this campaign. The ` +
            `first ${MEMBER_CEILING} are listed, in document order.`}
        </Alert>
      ) : null}
      {rows.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Name'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.href ? (
                    <AppLink href={row.href}>{row.name}</AppLink>
                  ) : (
                    <Stack>
                      <Typography variant="body2">{row.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.hrefReason}
                      </Typography>
                    </Stack>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {rows.length ? (
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={visible.length}
          // The members this card HOLDS — bounded by the ceiling, which the
          // notice above owns up to when it bites.
          count={rows.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          {settled
            ? `No ${noun} is in this campaign. Open a ${noun} and pick this ` +
              'campaign on its own page to put it in one.'
            : `Reading this campaign’s ${noun}s…`}
        </Typography>
      )}
    </Stack>
  )
}

CampaignMembersSection.displayName = 'CampaignMembersSection'

export default CampaignMembersSection
