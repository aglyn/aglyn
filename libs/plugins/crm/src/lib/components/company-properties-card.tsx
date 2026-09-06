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
  CRM_COLLECTIONS,
  type CrmCompany,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPencilOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useHostActivityLogger } from '@aglyn/tenant-feature-instance'
import { Button, Link, Stack, Typography } from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'
import { type ReactNode, useCallback, useState } from 'react'
import type { CrmScope } from '../hooks/use-crm-scope'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import {
  COMPANY_DETACH_LIMIT,
  CONTACT_COMPANY_IDS_FIELD,
  companyDetachUpdate,
} from '../model/companies'
import type { CrmRoutes } from '../model/crm-routes'
import CompanyEditDrawer from './company-edit-drawer'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'

export interface CompanyPropertiesCardProps {
  company: Partial<CrmCompany> & { $id: string }
  /** Whether the document the card holds is server-confirmed. */
  seed: { fromCache: boolean; unreadable: boolean }
  hostId: string
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
 * Contacts point at a company from their own documents, and Firestore does
 * not cascade. A bare delete would leave every one of them naming a record
 * that no longer exists: their page would render a link to nothing, and the
 * `companyIds` mirror the company list queries would keep matching a ghost.
 * So the delete reads the contacts that name this company, takes it off each
 * of them in one batch, and removes the document only when nobody is left
 * pointing at it.
 *
 * Bounded at {@link COMPANY_DETACH_LIMIT} per pass — a batch holds that many
 * writes — and honest past it: the pass detaches what it can, reports that
 * more remain, and leaves the company standing so the next delete continues
 * from where this one stopped. A company is never deleted with a link still
 * on a contact.
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
  const logActivity = useHostActivityLogger(hostId)
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
      /*
       * One over the limit, so "more remain" is a fact from the probe row
       * and not a guess from a full page — the same reason the paged lists
       * over-fetch by one.
       */
      const probe = await getDocs(
        query(
          collection(firestore, scope[0], scope[1], 'contacts'),
          where(CONTACT_COMPANY_IDS_FIELD, 'array-contains', company.$id),
          limit(COMPANY_DETACH_LIMIT + 1),
        ),
      )
      const linked = probe.docs.slice(0, COMPANY_DETACH_LIMIT)
      const moreRemain = probe.docs.length > COMPANY_DETACH_LIMIT
      if (linked.length) {
        const batch = writeBatch(firestore)
        for (const snapshot of linked) {
          batch.update(
            snapshot.ref,
            companyDetachUpdate(snapshot.data(), company.$id),
          )
        }
        await batch.commit()
      }
      if (moreRemain) {
        enqueueSnackbar(
          `${COMPANY_DETACH_LIMIT.toLocaleString()} contacts were unlinked ` +
            `from "${name}" and more remain. Delete again to continue.`,
          { variant: 'warning' },
        )
        return
      }
      await deleteDoc(
        doc(
          firestore,
          scope[0],
          scope[1],
          CRM_COLLECTIONS.companies,
          company.$id,
        ),
      )
      // Setup → Activity shows CRM work (AGL-2622): the company is org
      // data, but the act happened in this site's console and belongs in
      // its feed.
      logActivity('Deleted company', { type: 'company', id: company.$id, name })
      enqueueSnackbar(
        linked.length
          ? `Company deleted and unlinked from ${linked.length.toLocaleString()} ` +
              `contact${linked.length === 1 ? '' : 's'}`
          : 'Company deleted',
        { variant: 'success', persist: false },
      )
      onDeleted()
    } catch (error) {
      console.error(error)
      /*
       * The contact read runs without a scope predicate — it cannot carry
       * one beside the `array-contains` on the mirror — so the rules admit
       * it only to an org-wide member. A site-scoped member's delete stops
       * here, and is told why rather than shown a generic failure.
       */
      const denied =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'permission-denied'
      enqueueSnackbar(
        denied
          ? 'Your access is limited to specific sites, so the contacts at ' +
              'this company could not be read to unlink them. Ask an ' +
              'organization administrator to delete it.'
          : 'An error has occurred',
        { variant: 'error', allowDuplicate: true },
      )
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
