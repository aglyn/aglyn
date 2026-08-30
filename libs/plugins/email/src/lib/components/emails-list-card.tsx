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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { emailSendTimeMs, emailStateLabel } from '../model/email-record'

/** How many messages one read of this list covers. */
const EMAIL_CEILING = 30

const emailsDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#opens--clicks',
  excerpt:
    'Every message this site has sent or has scheduled, each with its own ' +
    'report: what was delivered, who opened it, and which links they followed.',
})

export interface EmailsListCardProps {
  hostId: string
  /** The emails hub URL, so a row can link to the message's own page. */
  basePath: string
}

/**
 * EVERY MESSAGE, AS AGAINST EVERY CAMPAIGN.
 *
 * A campaign groups messages; this is the messages. The two are different
 * questions — "how did the spring promotion do" and "what went out on the
 * 14th, and to whom" — and they were previously the same list because a
 * campaign document WAS a single send.
 *
 * ## Ordered in the browser, deliberately
 *
 * There is no date field on every message. A sent one carries `sentAt` and a
 * scheduled one carries `sendAtMs`, written by two different branches of the
 * send path, and there is no `createdAt` at all — so `orderBy` on either
 * would not mis-sort this list, it would DROP half of it. `collectionCeiling`
 * reads a bounded window in document-id order and probes one past the
 * ceiling, so the rows are sorted here and the reader is told when there are
 * more. Ordering this list in Firestore needs one field every writer stamps,
 * which is a change to the send path and a backfill.
 *
 * The page is therefore a SLICE of a window this card already holds, not a
 * query: paging an id-ordered walk and re-sorting each page by date would run
 * in one order within a page and another across them.
 */
export function EmailsListCard(props: EmailsListCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()

  const { data: emailDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'campaigns'),
        EMAIL_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readEmails, truncated } = ceilingedWindow<any>(
    emailDocs,
    EMAIL_CEILING,
  )
  const emails = useMemo(
    () =>
      [...readEmails].sort(
        (a: any, b: any) => emailSendTimeMs(b) - emailSendTimeMs(a),
      ),
    [readEmails],
  )

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visible = useMemo(
    () => emails.slice(page * pageSize, page * pageSize + pageSize),
    [emails, page, pageSize],
  )

  return (
    <CardDisplay
      header={'Emails'}
      help={emailsDocsHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {emails.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing has been sent or scheduled yet. A message is created ' +
              'when a campaign sends, and appears here with its report.'}
          </Typography>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Subject'}</TableCell>
                  <TableCell>{'State'}</TableCell>
                  <TableCell>{'When'}</TableCell>
                  <TableCell align="right">{'Addressed'}</TableCell>
                  <TableCell align="right">{'Opens'}</TableCell>
                  <TableCell align="right">{'Clicks'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((email: any) => {
                  const at = emailSendTimeMs(email)
                  return (
                    <TableRow key={email.$id} hover>
                      <TableCell>
                        <AppLink href={`${basePath}/emails/${email.$id}`}>
                          {email.subject || 'Untitled email'}
                        </AppLink>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={emailStateLabel(email.status)}
                        />
                      </TableCell>
                      <TableCell>
                        {at ? new Date(at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {Number(
                          email.stats?.recipients ?? 0,
                        ).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(email.stats?.opens ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {Number(email.stats?.clicks ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visible.length}
              count={emails.length}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next)
                setPage(0)
              }}
            />
          </>
        )}
        {truncated ? (
          <Alert severity="info">
            {`Showing ${EMAIL_CEILING} messages. This site has sent or ` +
              'scheduled more than that, and the rest are not in this list.'}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
EmailsListCard.displayName = 'EmailsListCard'

export default EmailsListCard
