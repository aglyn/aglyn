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
  canManageOrg,
  type ConsolePluginPageProps,
  CRM_ASSIGNMENT_RULES_MAX,
  CRM_ASSIGNMENT_RULES_PATH,
  CRM_AUTO_CREATE_COMPANIES_PATH,
  CRM_ROUND_ROBIN_POOL_MAX,
  CRM_ROUND_ROBIN_POOL_PATH,
  type CrmAssignmentRule,
  crmHostDefaultOwnerSegments,
  describeAssignmentRule,
  orgAutoCreatesCompanies,
  type OrgRole,
  pluginDocsHelp,
  readCrmAssignmentSettings,
  roundRobinOrder,
} from '@aglyn/aglyn'
import { mdiArrowDown, mdiArrowUp, mdiDeleteOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { deleteField, doc, FieldPath, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOrgMemberDirectory } from '../hooks/use-org-member-directory'
import AssignmentRuleDrawer from './assignment-rule-drawer'

export type CrmSettingsSectionProps = Pick<ConsolePluginPageProps, 'hostId' | 'org'>

/**
 * Whether the signed-in member may change an org-wide CRM setting, and
 * whether that is known yet.
 *
 * The org document's client branch admits an OWNER or ADMIN and nobody
 * else — `canManageOrg()` in the rules — so the question is the caller's
 * org role, read off their own membership document, which the rules let a
 * member read for themselves. A scoped collaborator, an editor, a viewer:
 * each sees the switch and cannot move it, with the reason beside it,
 * rather than a switch that moves and snaps back with a bare
 * `permission-denied`. `ready` separates "no" from "not yet", so the
 * control disables with a reason instead of hiding until the read lands.
 */
export function useCanManageCrmSettings(orgId: string | undefined): {
  canManage: boolean
  ready: boolean
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const { data: member, status } = useFirestoreDoc<{ role?: OrgRole }>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  return {
    canManage: canManageOrg(member?.role ?? null),
    ready: Boolean(orgId && uid) && status !== 'loading',
  }
}

export interface AutoCreateCompaniesCardProps {
  hostId: string
  org?: Partial<AglynOrgBilling> | null
}

/**
 * "Create companies from work email domains" — the org's one switch over
 * what a capture does with a company nobody has filed yet (AGL-2613).
 *
 * ## What the switch decides, and what it does not
 *
 * A contact captured from `jane@acme.com` is linked to the company at
 * `acme.com` whether this is on or off, provided exactly one such company
 * is visible to the capturing site. The switch decides the case where NO
 * company carries the domain: on, the capture creates one named after the
 * domain and links the contact; off — the default — it creates nothing and
 * the contact waits for a person to file them. Public mailbox domains never
 * create a company either way; a workspace's consumer list is not a list
 * of accounts.
 *
 * ## Written where it is read
 *
 * One dotted-path `update()` onto `orgs/{orgId}`, so the org's other keys
 * are untouched and the map under `crm` can grow a key per setting. The
 * shell's org listener delivers the new value back, which is what the
 * switch reflects; a local copy holds the click only until then.
 */
export function AutoCreateCompaniesCard(props: AutoCreateCompaniesCardProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId, ready: scopeReady } = useOrgDataScope({ hostId })
  const { canManage, ready: roleReady } = useCanManageCrmSettings(orgId)

  const stored = orgAutoCreatesCompanies(org as Record<string, unknown> | undefined)
  const [checked, setChecked] = useState(stored)
  const [busy, setBusy] = useState(false)
  // The stored value wins whenever it changes: the click is optimistic, and
  // the org document is what the capture door will actually read.
  useEffect(() => setChecked(stored), [stored])

  const handleChange = async (next: boolean) => {
    // The switch is disabled for a member who may not move it; the guard
    // stands anyway, because a disabled control still delivers a change
    // event in some environments and the rules would refuse the write.
    if (!orgId || !canManage) return
    setChecked(next)
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'orgs', orgId), {
        [CRM_AUTO_CREATE_COMPANIES_PATH]: next,
      })
      enqueueSnackbar(
        next
          ? 'Companies will be created from work email domains'
          : 'Companies will no longer be created from email domains',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      setChecked(stored)
      enqueueSnackbar('The setting could not be saved', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }

  const ready = scopeReady && roleReady
  return (
    <CardDisplay
      header={'Companies'}
      help={pluginDocsHelp('crmSettings', { anchor: '#companies' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={checked}
              disabled={!ready || !canManage || busy}
              onChange={(event) => void handleChange(event.target.checked)}
            />
          }
          label="Create companies from work email domains"
        />
        <FormHelperText>
          {'A contact captured with a work email address is linked to the ' +
            'company whose domain matches it. When this is on and no such ' +
            'company exists yet, one is created from the domain — acme.com ' +
            'becomes Acme — and the contact is linked to it. Public mailbox ' +
            'domains such as gmail.com never create a company.'}
        </FormHelperText>
        {ready && !canManage ? (
          <Typography variant="caption" color="text.secondary">
            {'Only a workspace owner or admin can change this.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
AutoCreateCompaniesCard.displayName = 'AutoCreateCompaniesCard'

/** The caption every card shows a member who may read but not change it. */
function ManagersOnlyNote(props: { ready: boolean; canManage: boolean }) {
  return props.ready && !props.canManage ? (
    <Typography variant="caption" color="text.secondary">
      {'Only a workspace owner or admin can change this.'}
    </Typography>
  ) : null
}
ManagersOnlyNote.displayName = 'ManagersOnlyNote'

/** The `value` of the default-owner picker's "nobody" entry. */
const NO_DEFAULT_OWNER = ''

export interface AssignmentCardProps {
  hostId: string
  org?: Partial<AglynOrgBilling> | null
}

/**
 * "Default owner" — who gets the records captured on THIS site when no
 * assignment rule claims them (AGL-2618).
 *
 * Per site, on the org document: the reader is the org-level assignment
 * pass, which reads one document for every site's default, and the writer
 * is the same owner-or-admin the rest of the `crm` map admits. The field
 * is addressed by `FieldPath` segments rather than a dotted string because
 * a host id is a document id and may contain a dot — joined with dots, the
 * write would land beside the setting rather than in it. Clearing the
 * picker deletes the field, so an org that once set a default and unset
 * it reads exactly like one that never did.
 */
export function DefaultOwnerCard(props: AssignmentCardProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId, ready: scopeReady } = useOrgDataScope({ hostId })
  const { canManage, ready: roleReady } = useCanManageCrmSettings(orgId)
  const roster = useOrgMemberDirectory(orgId)

  const stored =
    readCrmAssignmentSettings(org as Record<string, unknown> | undefined)
      .hostDefaultOwners[hostId] ?? NO_DEFAULT_OWNER
  const [value, setValue] = useState(stored)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(stored), [stored])

  const handleChange = async (next: string) => {
    if (!orgId || !canManage) return
    setValue(next)
    setBusy(true)
    try {
      await updateDoc(
        doc(firestore, 'orgs', orgId),
        new FieldPath(...crmHostDefaultOwnerSegments(hostId)),
        next || deleteField(),
      )
      enqueueSnackbar(
        next
          ? `New contacts on this site go to ${roster.nameOf(next)} unless a rule says otherwise`
          : 'New contacts on this site stay unassigned unless a rule says otherwise',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      setValue(stored)
      enqueueSnackbar('The default owner could not be saved', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }

  const ready = scopeReady && roleReady
  // A stored owner the roster no longer lists is still shown, by uid, so
  // the picker never silently reads "Nobody" for a setting that is there.
  const options = useMemo(
    () =>
      stored && !roster.members.some((member) => member.uid === stored)
        ? [...roster.members, { uid: stored, label: `${stored} (former member)` }]
        : roster.members,
    [roster.members, stored],
  )
  return (
    <CardDisplay
      header={'Default owner'}
      help={pluginDocsHelp('crmSettings', { anchor: '#default-owner' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <TextField
          select
          size="small"
          label="Default owner for this site"
          value={value}
          onChange={(event) => void handleChange(event.target.value)}
          disabled={!ready || !canManage || busy || roster.loading}
          // "Nobody" is the empty value, which a select would otherwise
          // render as a blank rather than as the choice it is.
          slotProps={{ select: { displayEmpty: true } }}
          sx={{ maxWidth: 360 }}
        >
          <MenuItem value={NO_DEFAULT_OWNER}>{'Nobody — leave unassigned'}</MenuItem>
          {options.map((member) => (
            <MenuItem key={member.uid} value={member.uid}>
              {member.label}
            </MenuItem>
          ))}
        </TextField>
        <FormHelperText>
          {'Every contact captured on this site — a form, a sign-up, a booking, ' +
            'an order — that no assignment rule claims is handed to this ' +
            'person, and they are notified. A contact added by hand or ' +
            'imported with an owner keeps the owner you chose.'}
        </FormHelperText>
        {roster.error ? (
          <Typography variant="caption" color="error">
            {roster.error}
          </Typography>
        ) : null}
        <ManagersOnlyNote ready={ready} canManage={canManage} />
      </Stack>
    </CardDisplay>
  )
}
DefaultOwnerCard.displayName = 'DefaultOwnerCard'

/**
 * "Assignment rules" — the ordered list the capture pass tries first
 * (AGL-2618), with Add rule in a drawer, reorder and delete.
 *
 * ## The whole list is the unit of write
 *
 * The rules are an array on the org document and every edit — a new rule,
 * a move, a delete — writes the whole array by its dotted path. A per-rule
 * write has no address (an array element is not a field), and the list is
 * bounded at fifty, so the write is small. The array the card writes is
 * the array it read off the org prop plus the one edit, so two admins
 * editing at once last-write-wins at the granularity of one edit, which
 * is what a list this short and this rarely edited needs.
 *
 * ## First match wins, so order is the meaning
 *
 * A rule's position is a fact about it — "bookings go to Kim, and
 * everything else to Sam" is two rules in that order and nonsense in the
 * other — which is why the reorder controls sit in the first column and
 * the row reads "1st, 2nd…" rather than a name. Up and down rather than
 * drag, the way the custom-field list does it: a drag handle needs a
 * pointer, and the reorder is rare.
 */
export function AssignmentRulesCard(props: AssignmentCardProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId, ready: scopeReady } = useOrgDataScope({ hostId })
  const { canManage, ready: roleReady } = useCanManageCrmSettings(orgId)
  const roster = useOrgMemberDirectory(orgId)
  const settings = useMemo(
    () => readCrmAssignmentSettings(org as Record<string, unknown> | undefined),
    [org],
  )
  const { rules } = settings
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const writeRules = useCallback(
    async (next: CrmAssignmentRule[], said: string) => {
      if (!orgId || !canManage) return
      setBusy(true)
      try {
        await updateDoc(doc(firestore, 'orgs', orgId), {
          [CRM_ASSIGNMENT_RULES_PATH]: next,
        })
        enqueueSnackbar(said, { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('The rules could not be saved', {
          variant: 'error',
          allowDuplicate: true,
        })
        throw error
      } finally {
        setBusy(false)
      }
    },
    [firestore, orgId, canManage, enqueueSnackbar],
  )

  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    void writeRules(next, 'Rule moved').catch(() => undefined)
  }
  const remove = (rule: CrmAssignmentRule) => {
    void writeRules(
      rules.filter((entry) => entry.id !== rule.id),
      'Rule deleted',
    ).catch(() => undefined)
  }
  const handleAdd = async (rule: CrmAssignmentRule) => {
    await writeRules([...rules, rule], 'Rule added')
    setDrawerOpen(false)
  }

  const ready = scopeReady && roleReady
  const atCap = rules.length >= CRM_ASSIGNMENT_RULES_MAX
  const canEdit = ready && canManage && !busy
  const ordinal = (index: number) => {
    const n = index + 1
    const suffix =
      n % 100 >= 11 && n % 100 <= 13
        ? 'th'
        : (['th', 'st', 'nd', 'rd'] as const)[n % 10] ?? 'th'
    return `${n}${suffix}`
  }
  return (
    <CardDisplay
      header={'Assignment rules'}
      help={pluginDocsHelp('crmSettings', { anchor: '#assignment-rules' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button
            variant="contained"
            disabled={!canEdit || atCap}
            onClick={() => setDrawerOpen(true)}
          >
            {'Add rule'}
          </Button>
        ),
      }}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Tried in order for every new contact captured on any site in the ' +
            'workspace; the first rule whose every condition holds assigns the ' +
            'owner. A contact no rule claims goes to the capturing site’s ' +
            'default owner, or stays unassigned.'}
        </Typography>
        {rules.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No rules yet. Add one to route new contacts by where they came from.'}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>{'Order'}</TableCell>
                <TableCell>{'When'}</TableCell>
                <TableCell>{'Assign to'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule, index) => {
                const described = describeAssignmentRule(rule, roster.nameOf)
                return (
                  <TableRow key={rule.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={0} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 32 }}>
                          {ordinal(index)}
                        </Typography>
                        <IconButton
                          size="small"
                          disabled={!canEdit || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <MdiIcon path={mdiArrowUp.path} size={0.7} />
                          <SrOnly>{`Move rule ${index + 1} up`}</SrOnly>
                        </IconButton>
                        <IconButton
                          size="small"
                          disabled={!canEdit || index === rules.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <MdiIcon path={mdiArrowDown.path} size={0.7} />
                          <SrOnly>{`Move rule ${index + 1} down`}</SrOnly>
                        </IconButton>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{described.when}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{described.assign}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ width: 56 }}>
                      <RowActionsMenu
                        label={`Rule ${index + 1}`}
                        items={[
                          {
                            key: 'delete',
                            label: 'Delete rule',
                            icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
                            destructive: true,
                            disabled: !canEdit,
                            onClick: () => remove(rule),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {atCap ? (
          <Typography variant="caption" color="text.secondary">
            {`A workspace keeps at most ${CRM_ASSIGNMENT_RULES_MAX} rules. Delete one to add another.`}
          </Typography>
        ) : null}
        <ManagersOnlyNote ready={ready} canManage={canManage} />
      </Stack>
      <AssignmentRuleDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        members={roster.members}
        membersLoading={roster.loading}
        poolSize={settings.pool.memberUids.length}
        existingIds={rules.map((rule) => rule.id)}
        onSubmit={handleAdd}
      />
    </CardDisplay>
  )
}
AssignmentRulesCard.displayName = 'AssignmentRulesCard'

/**
 * "Round robin" — the members handed records in turn (AGL-2618).
 *
 * The pool is the roster with a checkbox per member, and its ORDER is the
 * order members were checked: a member checked later joins the end of the
 * rotation, and unchecking removes them without disturbing the others. The
 * pointer — who got the last record — is the server's to move and is only
 * read here, as "next up", so an admin can see where the rotation stands
 * without being able to put a thumb on it.
 */
export function RoundRobinCard(props: AssignmentCardProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId, ready: scopeReady } = useOrgDataScope({ hostId })
  const { canManage, ready: roleReady } = useCanManageCrmSettings(orgId)
  const roster = useOrgMemberDirectory(orgId)
  const { pool } = useMemo(
    () => readCrmAssignmentSettings(org as Record<string, unknown> | undefined),
    [org],
  )
  const [busy, setBusy] = useState(false)

  const toggle = async (uid: string, inPool: boolean) => {
    if (!orgId || !canManage) return
    const next = inPool
      ? [...pool.memberUids.filter((entry) => entry !== uid), uid]
      : pool.memberUids.filter((entry) => entry !== uid)
    if (next.length > CRM_ROUND_ROBIN_POOL_MAX) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'orgs', orgId), {
        [CRM_ROUND_ROBIN_POOL_PATH]: next,
      })
      enqueueSnackbar(
        inPool
          ? `${roster.nameOf(uid)} joined the rotation`
          : `${roster.nameOf(uid)} left the rotation`,
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The pool could not be saved', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }

  const ready = scopeReady && roleReady
  const canEdit = ready && canManage && !busy && !roster.loading
  const order = roundRobinOrder(pool.memberUids, pool.lastAssignedUid)
  const nextUp = order[0]
  return (
    <CardDisplay
      header={'Round robin'}
      help={pluginDocsHelp('crmSettings', { anchor: '#round-robin' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'The members a round-robin rule, or an automation set to round ' +
            'robin, hands records to in turn. Each new record goes to the ' +
            'member after the last one who got a record, wrapping round.'}
        </Typography>
        {roster.loading ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading the team…'}
          </Typography>
        ) : roster.error ? (
          <Typography variant="body2" color="error">
            {roster.error}
          </Typography>
        ) : (
          <FormGroup>
            {roster.members.map((member) => (
              <FormControlLabel
                key={member.uid}
                control={
                  <Checkbox
                    size="small"
                    checked={pool.memberUids.includes(member.uid)}
                    disabled={!canEdit}
                    onChange={(event) => void toggle(member.uid, event.target.checked)}
                  />
                }
                label={member.label}
              />
            ))}
          </FormGroup>
        )}
        <Typography variant="caption" color="text.secondary">
          {pool.memberUids.length === 0
            ? 'Nobody is in the rotation; a round-robin rule is skipped until somebody is.'
            : `Rotation: ${pool.memberUids.map(roster.nameOf).join(' → ')}. Next up: ${roster.nameOf(nextUp)}.`}
        </Typography>
        <ManagersOnlyNote ready={ready} canManage={canManage} />
      </Stack>
    </CardDisplay>
  )
}
RoundRobinCard.displayName = 'RoundRobinCard'

/**
 * `/crm/settings` — what the CRM does on its own, for every site in the
 * workspace (AGL-2613).
 *
 * A stack of cards, one per concern, so a later setting arrives as a card
 * beside this one rather than a field inside it. Every card writes the org
 * document, because a CRM setting is a fact about how the business files
 * people and not about one site; the section is reached from a site's hub
 * only because that is where every CRM section is reached from. The one
 * per-site setting — the default owner — is the site's slot in an org-wide
 * map, and the card names the site it is for.
 */
export function CrmSettingsSection(props: CrmSettingsSectionProps) {
  const { hostId, org } = props
  return (
    <Stack spacing={3}>
      <AutoCreateCompaniesCard hostId={hostId} org={org} />
      <DefaultOwnerCard hostId={hostId} org={org} />
      <AssignmentRulesCard hostId={hostId} org={org} />
      <RoundRobinCard hostId={hostId} org={org} />
    </Stack>
  )
}
CrmSettingsSection.displayName = 'CrmSettingsSection'

export default CrmSettingsSection
