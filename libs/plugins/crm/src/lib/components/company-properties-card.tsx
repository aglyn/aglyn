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
  type AglynPostalAddress,
  type CrmCompany,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPencilOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Button, Link, Stack, Typography } from '@mui/material'
import { type ReactNode, useCallback, useState } from 'react'
import type { CrmScope } from '../hooks/use-crm-scope'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import { COMPANY_DETACH_LIMIT } from '../model/companies'
import {
  companyDeleteFailureMessage,
  deleteCompanyDetaching,
} from '../model/company-delete'
import type { CrmRoutes } from '../model/crm-routes'
import CompanyEditDrawer from './company-edit-drawer'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'

export interface CompanyPropertiesCardProps {
  company: Partial<CrmCompany> & { $id: string }
  /** Whether the document the card holds is server-confirmed. */
  seed: { fromCache: boolean; unreadable: boolean }
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling>
  crmScope: CrmScope
  members: OrgMemberOptions
  routes: CrmRoutes
  /** Called once the record is gone, so the page can leave it. */
  onDeleted: () => void
}

/** A postal address on one line, or nothing. */
function formatAddress(address: AglynPostalAddress | null | undefined): string {
  if (!address) return ''
  return [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    address.postalCode,
    address.country,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * WHAT A COMPANY IS: its fields, read off the one document the page holds,
 * with the edit and the delete beside them (AGL-2597).
 *
 * ## Edit is the create drawer
 *
 * The same form the list creates with, opened on the record. One form means
 * one set of refusals — a domain that is not a domain is refused the same
 * way on day one and on a rename — and one place to add a field.
 *
 * ## Delete is a DETACH first
 *
 * `deleteCompanyDetaching` — the pass the bulk bar runs per row as well —
 * unlinks the contacts that name this company before removing it, bounded
 * at {@link COMPANY_DETACH_LIMIT} per pass and honest past it: the company
 * stands, and the person is told more remain. What this card adds is the
 * confirm, the sentence for each outcome, and leaving the page once the
 * record is gone.
 */
export function CompanyPropertiesCard(props: CompanyPropertiesCardProps) {
  const {
    company,
    seed,
    hostId,
    org,
    crmScope,
    members,
    routes,
    onDeleted,
  } = props
  const { scope } = crmScope
  const firestore = useFirestore()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  // The site whose feed the act is logged in: the mounted one, or at the
  // organization level the company's own (AGL-2630).
  const logActivity = useHostActivityLogger(hostId ?? company.hostId ?? undefined)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    if (!scope || deleting) return
    const name = String(company.name ?? company.$id)
    const accepted = await confirm({
      title: 'Delete this company?',
      description:
        `"${name}" is removed from Companies and unlinked from every ` +
        'contact at it. The contacts themselves are kept, and so is ' +
        'anything else filed against the company.',
      confirmationText: 'Delete company',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel, so gating
      // on the resolved value alone would make this always return.
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setDeleting(true)
    try {
      const outcome = await deleteCompanyDetaching(firestore, scope, company.$id)
      if (!outcome.deleted) {
        enqueueSnackbar(
          `${COMPANY_DETACH_LIMIT.toLocaleString()} contacts were unlinked ` +
            `from "${name}" and more remain. Delete again to continue.`,
          { variant: 'warning' },
        )
        return
      }
      // Setup → Activity shows CRM work (AGL-2622): the company is org
      // data, but the act happened in this site's console and belongs in
      // its feed.
      logActivity('Deleted company', { type: 'company', id: company.$id, name })
      enqueueSnackbar(
        outcome.detached
          ? `Company deleted and unlinked from ${outcome.detached.toLocaleString()} ` +
              `contact${outcome.detached === 1 ? '' : 's'}`
          : 'Company deleted',
        { variant: 'success', persist: false },
      )
      onDeleted()
    } catch (error) {
      console.error(error)
      enqueueSnackbar(companyDeleteFailureMessage(error), {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setDeleting(false)
    }
  }, [scope, deleting, company, confirm, firestore, logActivity, enqueueSnackbar, onDeleted])

  const address = formatAddress(company.address)
  // The domain, the industry and the owner read on the header — the
  // subtitle and the chip row — so the rows list what is left.
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Website',
      value: company.website ? (
        <Link href={company.website} target="_blank" rel="noreferrer noopener">
          {company.website}
        </Link>
      ) : null,
    },
    { label: 'Phone', value: company.phone },
    { label: 'Address', value: address },
    { label: 'Tags', value: (company.tags ?? []).join(', ') },
    { label: 'Notes', value: company.notes },
  ]

  return (
    <CrmRecordHeader
      kind="Company"
      title={String(company.name || company.$id)}
      subtitle={company.domain}
      help={pluginDocsHelp('companies', { anchor: '#a-companys-page' })}
      backHref={routes.section('companies')}
      backLabel="Back to companies"
      actions={
        <Button
          size="small"
          color="primary"
          variant="outlined"
          startIcon={<MdiIcon path={mdiPencilOutline.path} size={0.8} />}
          onClick={() => setEditing(true)}
        >
          {'Edit'}
        </Button>
      }
      menuItems={[
        {
          key: 'delete',
          label: deleting ? 'Deleting…' : 'Delete company',
          icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
          destructive: true,
          disabled: !scope || deleting,
          disabledReason: deleting ? 'The company is being deleted' : 'The organization has not loaded',
          onClick: () => void handleDelete(),
        },
      ]}
      chips={
        <>
          <CrmRecordChip label="Industry" value={company.industry} />
          <CrmRecordChip
            label="Owner"
            value={
              company.ownerUid
                ? members.ready
                  ? members.labelFor(company.ownerUid)
                  : '…'
                : undefined
            }
          />
        </>
      }
    >
      <Stack spacing={1}>
        {rows.map((row) => (
          <Stack
            key={row.label}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'baseline' }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ minWidth: 96, flexShrink: 0 }}
            >
              {row.label}
            </Typography>
            <Typography
              variant="body2"
              color={row.value ? 'text.primary' : 'text.secondary'}
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {row.value || '—'}
            </Typography>
          </Stack>
        ))}
      </Stack>
      {editing ? (
        <CompanyEditDrawer
          open
          onClose={() => setEditing(false)}
          hostId={hostId}
          org={org}
          company={company}
          seed={seed}
          members={members}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </CrmRecordHeader>
  )
}
CompanyPropertiesCard.displayName = 'CompanyPropertiesCard'

export default CompanyPropertiesCard
