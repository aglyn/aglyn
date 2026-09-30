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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_STATUSES,
  crmMemberPickerLabel,
} from '@aglyn/aglyn'
import { hostIdsFromScope, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  Button,
  Checkbox,
  Drawer,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { OrgMemberOption } from '../hooks/use-org-member-directory'
import {
  CRM_SHARING_CRITERIA_FOR,
  CRM_SHARING_OBJECT_LABELS,
  CRM_SHARING_OBJECTS,
  type CrmShareAccess,
  type CrmSharingCriteria,
  type CrmSharingObject,
  type CrmSharingRule,
  type CrmSharingSite,
} from '../model/crm-sharing'

/** What the drawer hands back: the rule as `crm/sharing` `rule-save` reads it. */
export interface SharingRuleDraft {
  id?: string
  name: string
  object: CrmSharingObject
  enabled: boolean
  sourceHostIds: string[]
  criteria: CrmSharingCriteria
  targets: 'all' | string[]
  access: CrmShareAccess
}

export interface SharingRuleDrawerProps {
  open: boolean
  onClose: () => void
  /** The rule being edited, or `null` for a new one. */
  rule: CrmSharingRule | null
  sites: readonly CrmSharingSite[]
  members: readonly OrgMemberOption[]
  campaigns: readonly { value: string; label: string }[]
  busy: boolean
  onSubmit: (draft: SharingRuleDraft) => void
}

const splitList = (text: string) =>
  [...new Set(text.split(',').map((entry) => entry.trim()).filter(Boolean))].slice(0, 20)

/**
 * A sharing rule, three parts (AGL-3336): WHICH RECORDS (an object, the
 * sites that captured them, optional criteria), SHARED WITH (sites, or all
 * sites), and ACCESS (read-only unless edit is chosen).
 */
export function SharingRuleDrawer(props: SharingRuleDrawerProps) {
  const { open, onClose, rule, sites, members, campaigns, busy, onSubmit } = props
  const [name, setName] = useState('')
  const [object, setObject] = useState<CrmSharingObject>('leads')
  const [enabled, setEnabled] = useState(true)
  const [sourceHostIds, setSourceHostIds] = useState<string[]>([])
  const [leadSources, setLeadSources] = useState('')
  const [tags, setTags] = useState('')
  const [stages, setStages] = useState<string[]>([])
  const [ownerUids, setOwnerUids] = useState<string[]>([])
  const [campaignIds, setCampaignIds] = useState<string[]>([])
  const [allSites, setAllSites] = useState(true)
  const [targets, setTargets] = useState<string[]>([])
  const [access, setAccess] = useState<CrmShareAccess>('read')

  useEffect(() => {
    if (!open) return
    setName(rule?.name ?? '')
    setObject(rule?.object ?? 'leads')
    setEnabled(rule?.enabled ?? true)
    setSourceHostIds(rule?.sourceHostIds ?? [])
    setLeadSources((rule?.criteria.leadSources ?? []).join(', '))
    setTags((rule?.criteria.tags ?? []).join(', '))
    setStages(rule?.criteria.stages ?? [])
    setOwnerUids(rule?.criteria.ownerUids ?? [])
    setCampaignIds(rule?.criteria.campaignIds ?? [])
    setAllSites(rule ? rule.targets.includes(ORG_SCOPE_TOKEN) : true)
    setTargets(rule ? hostIdsFromScope(rule.targets) : [])
    setAccess(rule?.access ?? 'read')
  }, [open, rule])

  const offers = CRM_SHARING_CRITERIA_FOR[object]
  const stageOptions: { value: string; label: string }[] =
    object === 'leads'
      ? CRM_LEAD_STATUSES.map((value) => ({ value, label: CRM_LEAD_STATUS_LABELS[value] }))
      : object === 'contacts'
        ? CONTACT_LIFECYCLE_STAGES.map((value) => ({
            value,
            label: CONTACT_LIFECYCLE_STAGE_LABELS[value],
          }))
        : []
  const canSubmit =
    !busy && name.trim().length > 0 && (allSites || targets.length > 0)

  const submit = () => {
    if (!canSubmit) return
    const criteria: CrmSharingCriteria = {}
    if (offers.includes('leadSources') && splitList(leadSources).length) {
      criteria.leadSources = splitList(leadSources)
    }
    if (offers.includes('tags') && splitList(tags).length) {
      criteria.tags = splitList(tags).map((tag) => tag.toLowerCase())
    }
    if (stageOptions.length && stages.length) criteria.stages = stages
    if (offers.includes('ownerUids') && ownerUids.length) criteria.ownerUids = ownerUids
    if (offers.includes('campaignIds') && campaignIds.length) criteria.campaignIds = campaignIds
    onSubmit({
      ...(rule ? { id: rule.id } : {}),
      name: name.trim(),
      object,
      enabled,
      sourceHostIds,
      criteria,
      targets: allSites ? 'all' : targets,
      access,
    })
  }

  const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? id
  return (
    <Drawer anchor="right" open={open} onClose={busy ? undefined : onClose}>
      <Stack spacing={2} sx={{ width: 400, maxWidth: '100vw', p: 3 }}>
        <Typography variant="h6">{rule ? 'Edit sharing rule' : 'New sharing rule'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {'Shares every record the rule matches — the ones you already have, and every one ' +
            'captured or changed from now on. Sharing lets a site see and work a record; it ' +
            'never shares the person’s consent.'}
        </Typography>
        <TextField
          size="small"
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 120 } }}
          required
          fullWidth
        />
        <FormLabel>{'Which records'}</FormLabel>
        <TextField
          select
          size="small"
          label="Records"
          value={object}
          onChange={(event) => {
            setObject(event.target.value as CrmSharingObject)
            setStages([])
          }}
          disabled={Boolean(rule)}
          helperText={rule ? 'A rule keeps the kind of record it was made for.' : undefined}
          fullWidth
        >
          {CRM_SHARING_OBJECTS.map((option) => (
            <MenuItem key={option} value={option}>
              {CRM_SHARING_OBJECT_LABELS[option].many}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Captured on"
          value={sourceHostIds}
          onChange={(event) => {
            const value = event.target.value as unknown
            setSourceHostIds(Array.isArray(value) ? (value as string[]) : String(value).split(','))
          }}
          slotProps={{
            select: {
              multiple: true,
              displayEmpty: true,
              renderValue: (value) =>
                (value as string[]).length ? (value as string[]).map(siteName).join(', ') : 'Any site',
            },
            inputLabel: { shrink: true },
          }}
          helperText="The sites the record was captured or created on."
          fullWidth
        >
          {sites.map((site) => (
            <MenuItem key={site.id} value={site.id}>
              {site.name}
            </MenuItem>
          ))}
        </TextField>
        {offers.includes('leadSources') ? (
          <TextField
            size="small"
            label="Lead source"
            value={leadSources}
            onChange={(event) => setLeadSources(event.target.value)}
            helperText="Any of these, separated by commas. Blank for any source."
            fullWidth
          />
        ) : null}
        {offers.includes('tags') ? (
          <TextField
            size="small"
            label="Tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            helperText="Any of these, separated by commas. Blank for any tags."
            fullWidth
          />
        ) : null}
        {stageOptions.length ? (
          <TextField
            select
            size="small"
            label={object === 'leads' ? 'Status' : 'Lifecycle stage'}
            value={stages}
            onChange={(event) => {
              const value = event.target.value as unknown
              setStages(Array.isArray(value) ? (value as string[]) : String(value).split(','))
            }}
            slotProps={{
              select: {
                multiple: true,
                displayEmpty: true,
                renderValue: (value) =>
                  (value as string[]).length
                    ? (value as string[])
                        .map((id) => stageOptions.find((option) => option.value === id)?.label ?? id)
                        .join(', ')
                    : 'Any',
              },
              inputLabel: { shrink: true },
            }}
            fullWidth
          >
            {stageOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {offers.includes('campaignIds') && campaigns.length ? (
          <TextField
            select
            size="small"
            label="Campaign"
            value={campaignIds}
            onChange={(event) => {
              const value = event.target.value as unknown
              setCampaignIds(Array.isArray(value) ? (value as string[]) : String(value).split(','))
            }}
            slotProps={{
              select: {
                multiple: true,
                displayEmpty: true,
                renderValue: (value) =>
                  (value as string[]).length
                    ? (value as string[])
                        .map((id) => campaigns.find((option) => option.value === id)?.label ?? id)
                        .join(', ')
                    : 'Any',
              },
              inputLabel: { shrink: true },
            }}
            fullWidth
          >
            {campaigns.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          select
          size="small"
          label="Owner"
          value={ownerUids}
          onChange={(event) => {
            const value = event.target.value as unknown
            setOwnerUids(Array.isArray(value) ? (value as string[]) : String(value).split(','))
          }}
          slotProps={{
            select: {
              multiple: true,
              displayEmpty: true,
              renderValue: (value) =>
                (value as string[]).length
                  ? (value as string[])
                      .map((uid) => {
                        const member = members.find((entry) => entry.uid === uid)
                        return member ? crmMemberPickerLabel(member) : uid
                      })
                      .join(', ')
                  : 'Anyone',
            },
            inputLabel: { shrink: true },
          }}
          fullWidth
        >
          {members.map((member) => (
            <MenuItem key={member.uid} value={member.uid}>
              {crmMemberPickerLabel(member)}
            </MenuItem>
          ))}
        </TextField>
        <FormControl>
          <FormLabel>{'Shared with'}</FormLabel>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox checked={allSites} onChange={(event) => setAllSites(event.target.checked)} />
              }
              label="All sites, including sites added later"
            />
            {sites.map((site) => (
              <FormControlLabel
                key={site.id}
                control={
                  <Checkbox
                    checked={allSites || targets.includes(site.id)}
                    disabled={allSites}
                    onChange={(event) =>
                      setTargets((current) =>
                        event.target.checked
                          ? [...current, site.id]
                          : current.filter((id) => id !== site.id),
                      )
                    }
                  />
                }
                label={site.name}
              />
            ))}
          </FormGroup>
        </FormControl>
        <FormControl>
          <FormLabel>{'Access'}</FormLabel>
          <RadioGroup
            value={access}
            onChange={(event) => setAccess(event.target.value === 'edit' ? 'edit' : 'read')}
          >
            <FormControlLabel value="read" control={<Radio size="small" />} label="Read-only" />
            <FormControlLabel value="edit" control={<Radio size="small" />} label="Read and edit" />
          </RadioGroup>
        </FormControl>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
          label="On"
        />
        {!enabled ? (
          <FormHelperText>{'Off keeps the rule and takes away what it shared.'}</FormHelperText>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={!canSubmit} onClick={submit}>
            {rule ? 'Save rule' : 'Add rule'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  )
}
SharingRuleDrawer.displayName = 'SharingRuleDrawer'

export default SharingRuleDrawer
