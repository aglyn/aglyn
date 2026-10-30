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

import { MenuItem, TextField } from '@mui/material'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'

export interface CrmSitePickerProps {
  /**
   * The site the surface is mounted under. Under a site the picker renders
   * NOTHING — the site is known — so a drawer mounts this unconditionally
   * and only the organization-level reader ever sees a field.
   */
  hostId: string | null
  /** The field's label; "Site" unless the form has a reason to say more. */
  label?: string
  /** What the pick decides, said under the field. */
  helperText?: string
  disabled?: boolean
  /**
   * The org's records belong to every site, so the site is only the SOURCE a
   * record came from (`useCrmScope`'s `createNeedsSite` is false): the field
   * reads "Source site", is not required, and offers **None** first. In an
   * org that keeps each site's records apart the site decides who may see
   * the record and the field stays required.
   */
  optional?: boolean
  /**
   * A choice that is no site at all — the organization itself (AGL-2637).
   * Offered under the sites when given, and then the field renders even
   * for an org with one site, because there is a choice to make. `picked`
   * says the form holds that choice; picking a site clears it. Only a task
   * offers this: every other CRM record is a fact about a person some site
   * met, and is captured BY that site.
   */
  noSite?: {
    label: string
    /** What the choice decides, said under the field while it is picked. */
    helperText?: string
    picked: boolean
    onPick: (picked: boolean) => void
  }
}

/**
 * The select's value for the no-site choice. Never a site's id, which is a
 * Firestore document id and cannot begin with an underscore-and-word the
 * console minted itself.
 */
const NO_SITE_VALUE = '__organization'

/**
 * THE SITE A CREATE IS CAPTURED BY, at the organization level (AGL-2630).
 *
 * Every CRM record names the site that created it: its `hostId`, the
 * `visibleTo` that decides who may read it, and — for a contact — the
 * consent group whose facet holds the profile and whose name the consent
 * checkbox records a basis for. Under a site all three follow from the
 * URL. At `/[orgSlug]/crm` nothing does, so every create and import drawer
 * mounted there asks, with this field, and holds its submit until it is
 * answered. The REST API asks the same question as `consentSiteId`; this is
 * that parameter with a list attached.
 *
 * The pick is REMEMBERED for the session (`useCrmOrgMount`), so a reader
 * filing ten records for one brand picks once; an org with exactly one
 * site never sees the field, because there is nothing to choose. Nothing
 * else is picked silently — a wrong guess files a person under a brand
 * that never met them, which is exactly the disclosure the per-site model
 * exists to prevent.
 *
 * In an org whose records belong to every site ({@link CrmSitePickerProps.optional})
 * the field is the record's SOURCE, not its scope: optional, **None** first,
 * and a record from no site is stamped for the whole org.
 *
 * Rendered as a select rather than an autocomplete: an org has at
 * most thirty sites in a consent group and rarely more than a handful at
 * all, and a required field with a fixed list should look like one.
 *
 * With a {@link CrmSitePickerProps.noSite} choice the field is a question
 * even for an org with one site — the site, or the organization — and the
 * no-site pick is the FORM's, not the session's: the remembered site stays
 * what the next contact or deal defaults to.
 */
export function CrmSitePicker(props: CrmSitePickerProps) {
  const { hostId, optional = false, helperText, disabled, noSite } = props
  const label = props.label ?? (optional ? 'Source site' : 'Site')
  const mount = useCrmOrgMount()
  // Under a site, or with one site and nothing else to choose, there is no
  // question.
  if (
    hostId ||
    !mount ||
    (!noSite && mount.hostsReady && mount.hosts.length === 1)
  ) {
    return null
  }
  const picked = noSite?.picked ? NO_SITE_VALUE : (mount.createHostId ?? '')
  return (
    <TextField
      select
      required={!optional}
      size="small"
      label={label}
      value={picked}
      onChange={(event) => {
        const next = String(event.target.value)
        if (next === NO_SITE_VALUE) {
          noSite?.onPick(true)
          return
        }
        noSite?.onPick(false)
        mount.setCreateHostId(next || null)
      }}
      disabled={disabled || !mount.hostsReady}
      helperText={
        !mount.hostsReady
          ? 'Loading your sites…'
          : noSite?.picked
            ? (noSite.helperText ?? helperText)
            : optional
              ? (helperText ??
                'Where it came from, if anywhere. Every site in the organization ' +
                  'can see it either way.')
              : mount.hosts.length === 0 && !noSite
                ? 'This organization has no sites yet, so nothing can be filed.'
                : (helperText ??
                  'The site this record belongs to — it decides which of your ' +
                    'sites may see it.')
      }
      slotProps={{ inputLabel: { shrink: true } }}
    >
      {optional && !noSite ? <MenuItem value="">{'None'}</MenuItem> : null}
      {mount.hosts.map((host) => (
        <MenuItem key={host.id} value={host.id}>
          {host.name}
        </MenuItem>
      ))}
      {noSite ? <MenuItem value={NO_SITE_VALUE}>{noSite.label}</MenuItem> : null}
    </TextField>
  )
}
CrmSitePicker.displayName = 'CrmSitePicker'

export default CrmSitePicker
