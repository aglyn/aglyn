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
  PERSON_ERASURE_NOT_REACHED,
  PERSON_ERASURE_REMOVES,
  PERSON_ERASURE_RETAINS,
} from '@aglyn/aglyn'
import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { useOrgScope } from '../../hooks/use-org-scope'

/**
 * The two files of the people a workspace holds — the record system's
 * transfer resources, which every workspace may export on every plan — in
 * the order they are offered, with the export dialog's title for each.
 */
const PEOPLE_FILES: ReadonlyArray<{ resource: string; label: string; title: string }> = [
  { resource: 'crm.contacts', label: 'Export contacts', title: 'Export every contact' },
  { resource: 'crm.leads', label: 'Export leads', title: 'Export every lead' },
]

/** One of the erasure's three lists: what it removes, keeps, and cannot reach. */
function ErasureList(props: { heading: string; lines: readonly string[] }) {
  return (
    <Box>
      <Typography variant="subtitle2">{props.heading}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {props.lines.map((line) => (
          <Typography key={line} component="li" variant="body2" color="text.secondary">
            {line}
          </Typography>
        ))}
      </Box>
    </Box>
  )
}

/**
 * A WORKSPACE'S PRIVACY OBLIGATIONS, OUTSIDE THE CRM (AGL-2839).
 *
 * The CRM is included from Starter and a Free workspace has none of it
 * (AGL-2851), but every workspace must be able to hand over the people it
 * holds and remove one on request. Both used to live only inside the CRM — the
 * "Export…" buttons in its sections' headers and "Erase this person" on a
 * record's page — so this card is where they stand on every plan, beside the
 * workspace's other settings.
 *
 * - The files are the CRM's `crm.contacts` and `crm.leads` transfer
 *   resources, opened in the console's export dialog over the whole
 *   workspace (AGL-3552): the person picks the fields and the format, and
 *   the dialog checks the download against the row count the route
 *   promised. The export route asks neither the plan nor the CRM's release
 *   flag — only "Manage data", as every CRM export does — so the buttons are
 *   offered to whoever the transfer gate would admit, on every plan.
 * - The erasure is filed by address alone, typed twice, so it reaches a
 *   person whether or not any page shows them. The route decides who may file
 *   one — a workspace owner or admin — and the section is offered to them.
 */
export function OrgPrivacyCard() {
  const { currentOrg } = useOrgScope()
  const orgId = currentOrg?.$id ?? null
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const transfer = useTransferLauncher()
  const [email, setEmail] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [filing, setFiling] = useState(false)

  const typed = email.trim().toLowerCase()
  const confirmed = typed.includes('@') && typed === confirmEmail.trim().toLowerCase()

  const fileErasure = useCallback(async () => {
    if (!orgId || !user || !confirmed || filing) return
    setFiling(true)
    try {
      const response = await authorizedFetch(user, '/api/crm/erase-person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, email: email.trim(), confirmEmail: confirmEmail.trim() }),
      })
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (!response.ok) {
        enqueueSnackbar(String(payload['error'] ?? 'The erasure could not be filed'), {
          variant: 'error',
        })
        return
      }
      enqueueSnackbar(
        payload['alreadyPending']
          ? 'An erasure was already pending for this person'
          : 'Erasure requested — it runs with the nightly job',
        { variant: 'success' },
      )
      setEmail('')
      setConfirmEmail('')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The erasure could not be filed', { variant: 'error' })
    } finally {
      setFiling(false)
    }
  }, [orgId, user, confirmed, filing, email, confirmEmail, enqueueSnackbar])

  return (
    <Stack spacing={3}>
      <CardDisplay
        header="Export the people you hold"
        help={docsHelp('account', {
          anchor: '#privacy-requests',
          excerpt:
            'Export every contact and every lead this workspace holds, and file a ' +
            'privacy erasure for a person, on every plan.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'A file of every contact this workspace holds, and one of every lead its ' +
              'sites captured, with the fields and the format you choose. Available on ' +
              'every plan, whether or not it includes the CRM.'}
          </Typography>
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {PEOPLE_FILES.map(({ resource, label, title }) => (
              <Button
                key={resource}
                variant="outlined"
                disabled={!orgId || !transfer?.can('export', { resource, scope: 'org' })}
                onClick={() => transfer?.openExport({ resource, scope: 'org', title })}
              >
                {label}
              </Button>
            ))}
          </Stack>
        </Stack>
      </CardDisplay>
      <CardDisplay
        header="Erase a person"
        help={docsHelp('account', {
          anchor: '#privacy-requests',
          excerpt:
            'File a privacy erasure for anyone this workspace may hold, by the address ' +
            'typed twice. It suppresses the address at once and runs with the nightly job.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'A privacy erasure, not a delete: the person is removed from every site in ' +
              'this workspace, whether or not a page shows them. The request is filed now ' +
              'and runs with the nightly erasure job, and from the moment it is filed your ' +
              'sites stop capturing the address. Workspace owners and admins only.'}
          </Typography>
          <ErasureList heading="Removed across the workspace" lines={PERSON_ERASURE_REMOVES} />
          <ErasureList heading="Kept, with the person taken off" lines={PERSON_ERASURE_RETAINS} />
          <ErasureList
            heading="Not reached — finish these by hand"
            lines={PERSON_ERASURE_NOT_REACHED}
          />
          <TextField
            label="Email address"
            type="email"
            size="small"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            fullWidth
          />
          <TextField
            label="Type the email address again"
            size="small"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            fullWidth
          />
          <Box>
            <Button
              variant="contained"
              color="error"
              disabled={!orgId || !confirmed || filing}
              onClick={() => void fileErasure()}
            >
              {filing ? 'Filing…' : 'Erase permanently'}
            </Button>
          </Box>
        </Stack>
      </CardDisplay>
    </Stack>
  )
}
OrgPrivacyCard.displayName = 'OrgPrivacyCard'

export default OrgPrivacyCard
