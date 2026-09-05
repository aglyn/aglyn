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
  CRM_AUTO_CREATE_COMPANIES_PATH,
  orgAutoCreatesCompanies,
  type OrgRole,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'

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

/**
 * `/crm/settings` — what the CRM does on its own, for every site in the
 * workspace (AGL-2613).
 *
 * A stack of cards, one per concern, so a later setting arrives as a card
 * beside this one rather than a field inside it. Every card writes the org
 * document, because a CRM setting is a fact about how the business files
 * people and not about one site; the section is reached from a site's hub
 * only because that is where every CRM section is reached from.
 */
export function CrmSettingsSection(props: CrmSettingsSectionProps) {
  const { hostId, org } = props
  return (
    <Stack spacing={3}>
      <AutoCreateCompaniesCard hostId={hostId} org={org} />
    </Stack>
  )
}
CrmSettingsSection.displayName = 'CrmSettingsSection'

export default CrmSettingsSection
