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
  CRM_COLLECTIONS,
  CRM_EMAIL_TEMPLATE_KIND_LABELS,
  CRM_EMAIL_TEMPLATE_VISIBILITY_LABELS,
  CRM_EMAIL_TEMPLATES_LIMIT,
  type CrmEmailTemplateRow,
  createResourceUid,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPencilOutline } from '@aglyn/shared-data-mdi'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection, deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useCrmEmailTemplates,
  useCrmEmailTemplateScope,
} from '../hooks/use-crm-email-templates'
import EmailTemplateDrawer, { type EmailTemplateDraft } from './email-template-drawer'

export interface EmailTemplatesCardProps {
  /** The site the section is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
}

/**
 * "Email templates" — the letters the team keeps for **Send email**
 * (AGL-2658): every template and snippet this member can use, with a
 * drawer to write one and a row menu to edit or delete it.
 *
 * ## Whose card this is
 *
 * Unlike the switches above it, which the org's owner or admin alone may
 * move, this card is every CRM editor's: a template is working material,
 * not policy. The rules gate the rest — a shared row is any editor's, a
 * personal row its owner's — and a colleague's personal rows are not
 * listed here at all, so every row on screen is one this member may
 * change.
 *
 * ## Where a new template lands
 *
 * Under a site, in that site's scope; from the organization's own hub, in
 * the org's — the same rule the send dialog's Save as template follows
 * (`useCrmEmailTemplateScope`). A personal template is owned by its
 * writer; switching one to shared drops the owner, and back to personal
 * makes the member editing it the owner.
 */
export function EmailTemplatesCard(props: EmailTemplatesCardProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  const templateScope = useCrmEmailTemplateScope({ hostId, org })
  const { scope, ready: scopeReady } = templateScope
  const { templates, ready } = useCrmEmailTemplates({
    scope,
    visibleTo: templateScope.visibleTo,
    uid,
  })

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<CrmEmailTemplateRow | null>(null)
  const [busyId, setBusyId] = useState('')

  const templateRef = useCallback(
    (id: string) => {
      if (!scope) throw new Error('an email template needs an organization')
      return doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.emailTemplates, id)
    },
    [firestore, scope],
  )

  const openCreate = useCallback(() => {
    setEditing(null)
    setDrawerOpen(true)
  }, [])
  const openEdit = useCallback((template: CrmEmailTemplateRow) => {
    setEditing(template)
    setDrawerOpen(true)
  }, [])

  const handleSubmit = useCallback(
    async (draft: EmailTemplateDraft) => {
      if (!scope || !uid) return
      const now = Date.now()
      const ownership =
        draft.visibility === 'personal' ? { ownerUid: uid } : { ownerUid: deleteField() }
      if (editing) {
        await updateDoc(templateRef(editing.$id), {
          name: draft.name,
          kind: draft.kind,
          visibility: draft.visibility,
          subject: draft.subject,
          body: draft.body,
          ...ownership,
          updatedAtMs: now,
          updatedAt: new Date(now),
        })
        enqueueSnackbar('Template saved', { variant: 'success', persist: false })
      } else {
        await setDoc(
          doc(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.emailTemplates),
            createResourceUid(),
          ),
          {
            name: draft.name,
            kind: draft.kind,
            visibility: draft.visibility,
            subject: draft.subject,
            body: draft.body,
            ...(draft.visibility === 'personal' ? { ownerUid: uid } : {}),
            createdByUid: uid,
            createdAtMs: now,
            updatedAtMs: now,
            hostId: templateScope.createHostId,
            visibleTo: [...templateScope.createTokens],
            createdAt: new Date(now),
            updatedAt: new Date(now),
          },
        )
        enqueueSnackbar(`Template "${draft.name}" added`, { variant: 'success', persist: false })
      }
      setDrawerOpen(false)
      setEditing(null)
    },
    [scope, uid, editing, templateRef, enqueueSnackbar, firestore, templateScope],
  )

  const handleDelete = useCallback(
    async (template: CrmEmailTemplateRow) => {
      if (!scope || busyId) return
      const accepted = await confirm({
        title: `Delete "${template.name}"?`,
        description:
          template.kind === 'snippet'
            ? 'The snippet is removed for everyone it is listed for. Emails already sent are not changed.'
            : 'The template is removed for everyone it is listed for. Emails already sent are not changed.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
      setBusyId(template.$id)
      try {
        await deleteDoc(templateRef(template.$id))
        enqueueSnackbar('Template deleted', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, confirm, templateRef, enqueueSnackbar],
  )

  const rowActions = (template: CrmEmailTemplateRow): RowActionsMenuItem[] => [
    {
      key: 'edit',
      label: 'Edit',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      onClick: () => openEdit(template),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      disabled: Boolean(busyId),
      onClick: () => void handleDelete(template),
    },
  ]

  const atCap = templates.length >= CRM_EMAIL_TEMPLATES_LIMIT
  const canCreate = Boolean(scope) && Boolean(uid) && !atCap
  return (
    <CardDisplay
      header={'Email templates'}
      help={pluginDocsHelp('crmEmailTemplates', { anchor: '#managing-templates' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button variant="contained" disabled={!canCreate} onClick={openCreate}>
            {'New template'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The letters your team sends from a record. A template fills in the ' +
            'subject and the message of Send email; a snippet drops a paragraph ' +
            'in where the cursor is. Merge fields such as {{contact.firstName}} ' +
            'are filled in from the record when the email is sent.'}
        </Typography>
        {scopeReady && !scope ? (
          <Typography variant="body2" color="text.secondary">
            {'This site has no organization, so it has no email templates.'}
          </Typography>
        ) : !ready ? null : templates.length === 0 ? (
          <EmptyStateComponent
            label={'No templates yet'}
            description={'Write one here, or save an email you are about to send as a template.'}
            action={
              canCreate ? (
                <Button variant="contained" onClick={openCreate}>
                  {'New template'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Name'}</TableCell>
                <TableCell>{'Kind'}</TableCell>
                <TableCell>{'For'}</TableCell>
                <TableCell>{'Subject'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.$id} hover>
                  <TableCell>
                    <Typography variant="body2">{template.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {CRM_EMAIL_TEMPLATE_KIND_LABELS[template.kind]}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant={template.visibility === 'personal' ? 'outlined' : 'filled'}
                      label={CRM_EMAIL_TEMPLATE_VISIBILITY_LABELS[template.visibility]}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {template.kind === 'template' ? template.subject || '—' : template.body}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 56 }}>
                    <RowActionsMenu label={template.name} items={rowActions(template)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {atCap ? (
          <Typography variant="caption" color="text.secondary">
            {`A workspace keeps at most ${CRM_EMAIL_TEMPLATES_LIMIT} templates and snippets. Delete one to add another.`}
          </Typography>
        ) : null}
      </Stack>
      <EmailTemplateDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        template={editing}
        onSubmit={handleSubmit}
      />
    </CardDisplay>
  )
}
EmailTemplatesCard.displayName = 'EmailTemplatesCard'

export default EmailTemplatesCard
