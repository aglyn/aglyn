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
  CONTACT_FIELD_TYPE_LABELS,
  type ConsolePluginPageProps,
  createResourceUid,
  CRM_COLLECTIONS,
  newResourceScopeFields,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import {
  mdiArchiveArrowUpOutline,
  mdiArchiveOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiDeleteOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  MdiIcon,
  SrOnly,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useOrgDataScope,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  IconButton,
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
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  type ContactFieldDefinitionDoc,
  useContactFieldDefinitions,
} from '../hooks/use-contact-field-definitions'
import ContactFieldDrawer, { type ContactFieldDraft } from './contact-field-drawer'

export type ContactsFieldsSectionProps = Pick<ConsolePluginPageProps, 'hostId' | 'org'>

/**
 * `/crm/fields` — the custom fields a holder keeps on a person (AGL-2601).
 *
 * Definitions live in `orgs/{orgId}/contactFields`, one document per field,
 * and the VALUES live under each contact facet's `custom` keyed by the
 * definition's `key`. That split decides everything this section does:
 *
 *  - A field is RETIRED, not deleted, while values may exist under it. A
 *    retired field leaves every form and every column, but an export can
 *    still read what was written, and a restore brings it back intact.
 *    Delete is offered only on a retired field, because retiring is the step
 *    where the author had to look at what they were losing.
 *  - The KEY never changes. It is the map key every value sits under; a
 *    rename is a new field and a retire.
 *  - Order is a stored `order` on each document, moved with the arrows here,
 *    and every reader sorts by it — the profile card, the columns, an export.
 *
 * ## What is NOT on this page
 *
 * How many contacts carry a value under each field. That count is a read of
 * every contact document in the org — the expensive-read shape this codebase
 * has a standing rule against — and it would be paid on every visit to a
 * settings page. The list says so rather than showing a number it cannot
 * afford to keep true.
 *
 * Definitions are ORG-WIDE (`visibleTo: ['org']`): a field is a fact about
 * how this business describes people, and every site in the org files
 * people into the same address book. `hostId` records which site defined it.
 */
export function ContactsFieldsSection(props: ContactsFieldsSectionProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { scope, ready: scopeReady } = useOrgDataScope({ hostId })
  const orgId = scope?.[1] ?? null
  const { definitions, ready, fromCache } = useContactFieldDefinitions(orgId)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ContactFieldDefinitionDoc | null>(null)
  const [busyId, setBusyId] = useState('')

  const fieldRef = useCallback(
    (id: string) => {
      if (!scope) throw new Error('a contact field needs an organization')
      return doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.contactFields, id)
    },
    [firestore, scope],
  )

  const openCreate = useCallback(() => {
    setEditing(null)
    setDrawerOpen(true)
  }, [])
  const openEdit = useCallback((definition: ContactFieldDefinitionDoc) => {
    setEditing(definition)
    setDrawerOpen(true)
  }, [])

  /**
   * Create, or save the editable half of an existing field.
   *
   * On create the document carries everything a reader expects: the key,
   * an `order` past every existing one so it lands last, an explicit
   * `retiredAt: null` so a `where('retiredAt', '==', null)` can find it, the
   * defining site, and the org-wide scope stamp the rules require. On edit
   * only the label, the choices and the required flag move — the key and
   * the type are the drawer's disabled inputs, and this writer does not
   * take them either.
   */
  const handleSubmit = useCallback(
    async (draft: ContactFieldDraft) => {
      if (!scope) return
      const now = new Date()
      if (editing) {
        const verdict = await writeGuardedBySeed(
          { subject: 'field', fromCache },
          async () => {
            await updateDoc(fieldRef(editing.$id), {
              label: draft.label,
              ...(editing.type === 'select' ? { options: draft.options } : {}),
              required: draft.required,
              updatedAt: now,
            })
          },
        )
        if (!verdict.ok) {
          return void enqueueSnackbar(verdict.message, {
            variant: 'warning',
            persist: false,
          })
        }
        enqueueSnackbar('Field saved', { variant: 'success', persist: false })
      } else {
        const order =
          definitions.reduce(
            (highest, definition) => Math.max(highest, Number(definition.order) || 0),
            -1,
          ) + 1
        await setDoc(
          doc(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.contactFields),
            createResourceUid(),
          ),
          {
            key: draft.key,
            label: draft.label,
            type: draft.type,
            ...(draft.type === 'select' ? { options: draft.options } : {}),
            required: draft.required,
            order,
            retiredAt: null,
            hostId,
            ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
            createdAt: now,
            updatedAt: now,
          },
        )
        enqueueSnackbar(`Field "${draft.label}" added`, {
          variant: 'success',
          persist: false,
        })
      }
      setDrawerOpen(false)
      setEditing(null)
    },
    [scope, editing, fromCache, fieldRef, enqueueSnackbar, definitions, firestore, hostId],
  )

  /**
   * Move a field one place up or down.
   *
   * Writes `order` as the POSITION for every row whose stored order is not
   * already its position, in one batch. Swapping two numbers would be enough
   * on a list whose orders are already distinct, and wrong on one where they
   * are not — every field created before this section existed carries the
   * same `order`, and a swap of two equal numbers moves nothing. Renumbering
   * what is out of place makes the first move on such a list also the one
   * that normalizes it, at the cost of a batch that is at most the list.
   */
  const move = useCallback(
    async (definition: ContactFieldDefinitionDoc, direction: -1 | 1) => {
      if (!scope || busyId) return
      const index = definitions.findIndex((entry) => entry.$id === definition.$id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= definitions.length) return
      const next = [...definitions]
      next[index] = definitions[target]
      next[target] = definitions[index]
      setBusyId(definition.$id)
      try {
        const verdict = await writeGuardedBySeed(
          { subject: 'field order', fromCache },
          async () => {
            const batch = writeBatch(firestore)
            const now = new Date()
            next.forEach((entry, position) => {
              if (entry.order === position) return
              batch.update(fieldRef(entry.$id), { order: position, updatedAt: now })
            })
            await batch.commit()
          },
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
        }
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, definitions, fromCache, firestore, fieldRef, enqueueSnackbar],
  )

  /**
   * Retire a field, or bring one back.
   *
   * Retiring is asked about because it takes a control off every contact
   * form and a column off the list; restoring is not, because it puts a
   * choice back and is undone by retiring again. Neither touches a value.
   */
  const toggleRetired = useCallback(
    async (definition: ContactFieldDefinitionDoc) => {
      if (!scope || busyId) return
      if (!definition.retiredAt) {
        const accepted = await confirm({
          title: `Retire “${definition.label}”?`,
          description:
            'It leaves every contact form, column and form-field mapping. ' +
            'Values already saved under it are kept and still export, and ' +
            'you can restore the field at any time.',
          confirmationText: 'Retire',
        })
          // `confirm` resolves with no value and REJECTS on cancel, so gating
          // on the resolved value alone would always fall through.
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }
      setBusyId(definition.$id)
      try {
        await updateDoc(fieldRef(definition.$id), {
          retiredAt: definition.retiredAt ? null : Date.now(),
          updatedAt: new Date(),
        })
        enqueueSnackbar(definition.retiredAt ? 'Field restored' : 'Field retired', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, confirm, fieldRef, enqueueSnackbar],
  )

  /**
   * Delete a RETIRED field's definition.
   *
   * The values under its key are not touched — they sit on contact documents
   * this page does not read — so what is destroyed is the ability to show
   * them anywhere. The dialog says exactly that, and the key stays taken for
   * as long as the list can see it, which after this write it cannot; a new
   * field with the same key would read the orphaned values back as its own.
   */
  const handleDelete = useCallback(
    async (definition: ContactFieldDefinitionDoc) => {
      if (!scope || busyId || !definition.retiredAt) return
      const accepted = await confirm({
        title: `Delete “${definition.label}”?`,
        description:
          'The definition is removed for good. Values saved under its key ' +
          `(${definition.key}) stay on the contacts that carry them but ` +
          'nothing will show them again — and a new field created with the ' +
          'same key would read them as its own.',
        confirmationText: 'Delete field',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
      setBusyId(definition.$id)
      try {
        await deleteDoc(fieldRef(definition.$id))
        enqueueSnackbar('Field deleted', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, confirm, fieldRef, enqueueSnackbar],
  )

  const rowActions = (definition: ContactFieldDefinitionDoc): RowActionsMenuItem[] => [
    {
      key: 'edit',
      label: 'Edit field',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      onClick: () => openEdit(definition),
    },
    {
      key: 'retire',
      label: definition.retiredAt ? 'Restore' : 'Retire',
      icon: (
        <MdiIcon
          path={definition.retiredAt ? mdiArchiveArrowUpOutline.path : mdiArchiveOutline.path}
          size={0.8}
        />
      ),
      destructive: !definition.retiredAt,
      disabled: Boolean(busyId),
      disabledReason: busyId ? 'Another field is being saved' : undefined,
      onClick: () => void toggleRetired(definition),
    },
    ...(definition.retiredAt
      ? [
          {
            key: 'delete',
            label: 'Delete',
            icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
            destructive: true,
            disabled: Boolean(busyId),
            disabledReason: busyId ? 'Another field is being saved' : undefined,
            onClick: () => void handleDelete(definition),
          } satisfies RowActionsMenuItem,
        ]
      : []),
  ]

  return (
    <CardDisplay
      header={'Fields'}
      help={pluginDocsHelp('contactFields', { anchor: '#define-a-field' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: scope ? (
          <Button variant="contained" onClick={openCreate}>
            {'New field'}
          </Button>
        ) : null,
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The custom fields on a contact — text, number, date, choice, ' +
            'checkbox or link. They show on every contact, as columns on ' +
            'the list, and a form field can save into one. Fields are ' +
            'shared across every site in this organization, like the ' +
            'contacts themselves.'}
        </Typography>
        {scopeReady && !scope ? (
          <Typography variant="body2" color="text.secondary">
            {'This site has no organization, so it has no contact fields.'}
          </Typography>
        ) : !ready ? null : definitions.length === 0 ? (
          <EmptyStateComponent
            label={'No custom fields yet'}
            description={'A field you define here is kept on every contact and shows on their page.'}
            action={
              scope ? (
                <Button variant="contained" onClick={openCreate}>
                  {'New field'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 96 }}>{'Order'}</TableCell>
                <TableCell>{'Field'}</TableCell>
                <TableCell>{'Key'}</TableCell>
                <TableCell>{'Type'}</TableCell>
                <TableCell>{'Required'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {definitions.map((definition, index) => (
                <TableRow
                  key={definition.$id}
                  hover
                  sx={definition.retiredAt ? { opacity: 0.6 } : undefined}
                >
                  <TableCell>
                    <Stack direction="row" spacing={0}>
                      <IconButton
                        size="small"
                        disabled={index === 0 || Boolean(busyId)}
                        onClick={() => void move(definition, -1)}
                      >
                        <MdiIcon path={mdiArrowUp.path} size={0.7} />
                        <SrOnly>{`Move ${definition.label} up`}</SrOnly>
                      </IconButton>
                      <IconButton
                        size="small"
                        disabled={index === definitions.length - 1 || Boolean(busyId)}
                        onClick={() => void move(definition, 1)}
                      >
                        <MdiIcon path={mdiArrowDown.path} size={0.7} />
                        <SrOnly>{`Move ${definition.label} down`}</SrOnly>
                      </IconButton>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      <Typography variant="body2">{definition.label}</Typography>
                      {definition.retiredAt ? (
                        <Chip size="small" variant="outlined" color="warning" label="Retired" />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      {definition.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {CONTACT_FIELD_TYPE_LABELS[definition.type] ?? definition.type}
                      {definition.type === 'select' && definition.options?.length
                        ? ` · ${definition.options.length} choices`
                        : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {definition.required ? 'Yes' : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 56 }}>
                    <RowActionsMenu label={definition.label} items={rowActions(definition)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {definitions.length ? (
          <Typography variant="caption" color="text.secondary">
            {'How many contacts carry a value under each field is not ' +
              'counted — that would read every contact in the organization ' +
              'each time this page opened.'}
          </Typography>
        ) : null}
      </Stack>
      <ContactFieldDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        definition={editing}
        takenKeys={definitions.map((definition) => definition.key)}
        onSubmit={handleSubmit}
      />
    </CardDisplay>
  )
}
ContactsFieldsSection.displayName = 'ContactsFieldsSection'

export default ContactsFieldsSection
