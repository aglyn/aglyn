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

import type { ConsolePluginOrgHost } from '@aglyn/aglyn'
import {
  Box,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { ListedConsentGroup } from './consent-group-editing'
import { MAX_CONSENT_GROUP_HOSTS } from './consent-groups-api'

/** Past this many sites the list gets a filter, so a long one stays usable. */
const FILTER_FROM = 10

export interface ConsentGroupSitePickerProps {
  /** Every site the organization has. */
  sites: readonly ConsolePluginOrgHost[]
  /** The groups the org declares now. */
  groups: readonly ListedConsentGroup[]
  /** The group being edited, whose own sites carry no badge; `null` for a new one. */
  groupId: string | null
  selected: readonly string[]
  onChange: (hostIds: string[]) => void
  /** What is wrong with the selection, said under the list. */
  error?: string
  /** Sites the route refused by id, marked where they are listed. */
  refusedHostIds?: ReadonlySet<string>
  disabled?: boolean
}

/**
 * The sites a consent group names.
 *
 * A site can be one sender with only one set of siblings, so a site already
 * in another group says which — "In Acme" — and, once ticked, what ticking it
 * does: "Moves from Acme". The move is legitimate, and the review spells out
 * what it costs the group it leaves; the badge is there so nobody makes it
 * without seeing it.
 *
 * A site the group names that the org no longer lists is still shown, ticked
 * and marked, so it can be unticked rather than silently carried into the
 * next declaration.
 */
export function ConsentGroupSitePicker(props: ConsentGroupSitePickerProps) {
  const {
    sites,
    groups,
    groupId,
    selected,
    onChange,
    error,
    refusedHostIds,
    disabled,
  } = props
  const [filter, setFilter] = useState('')

  /** The group each site belongs to now, other than the one being edited. */
  const memberOf = useMemo(() => {
    const found = new Map<string, ListedConsentGroup>()
    for (const group of groups) {
      if (group.id === groupId) continue
      for (const hostId of group.hostIds) found.set(hostId, group)
    }
    return found
  }, [groups, groupId])

  const rows = useMemo(() => {
    const listed = sites.map((site) => ({
      id: site.id,
      name: site.name || site.subdomain || site.id,
      missing: false,
    }))
    const known = new Set(listed.map((site) => site.id))
    const own = groups.find((group) => group.id === groupId)?.hostIds ?? []
    const orphans = own
      .filter((hostId) => !known.has(hostId))
      .map((hostId) => ({ id: hostId, name: hostId, missing: true }))
    return [...listed, ...orphans].sort((a, b) => a.name.localeCompare(b.name))
  }, [sites, groups, groupId])

  const chosen = useMemo(() => new Set(selected), [selected])
  const full = chosen.size >= MAX_CONSENT_GROUP_HOSTS
  const needle = filter.trim().toLocaleLowerCase()
  const visible = needle
    ? rows.filter(
        (row) => chosen.has(row.id) || row.name.toLocaleLowerCase().includes(needle),
      )
    : rows

  const toggle = (hostId: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(hostId)
    else next.delete(hostId)
    onChange([...next].sort())
  }

  return (
    <FormControl component="fieldset" error={Boolean(error)} disabled={disabled} fullWidth>
      <FormLabel component="legend">{'Sites'}</FormLabel>
      <FormHelperText sx={{ mx: 0 }}>
        {`Choose at least two sites and at most ${MAX_CONSENT_GROUP_HOSTS}. ` +
          'A site can be in only one consent group.'}
      </FormHelperText>
      {rows.length > FILTER_FROM ? (
        <TextField
          size="small"
          label="Find a site"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          sx={{ mt: 1, maxWidth: 320 }}
        />
      ) : null}
      <Box
        sx={{
          mt: 1,
          maxHeight: 320,
          overflowY: 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.5,
          py: 0.5,
        }}
      >
        {visible.map((row) => {
          const checked = chosen.has(row.id)
          const other = memberOf.get(row.id)
          return (
            <Stack
              key={row.id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    disabled={disabled || (!checked && full)}
                    onChange={(event) => toggle(row.id, event.target.checked)}
                  />
                }
                label={row.name}
                sx={{ mr: 0 }}
              />
              {other ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color={checked ? 'warning' : 'default'}
                  label={checked ? `Moves from ${other.name}` : `In ${other.name}`}
                />
              ) : null}
              {row.missing ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  label="Not in your organization"
                />
              ) : null}
              {refusedHostIds?.has(row.id) ? (
                <Chip size="small" color="error" variant="outlined" label="Can’t be added" />
              ) : null}
            </Stack>
          )
        })}
        {!visible.length ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            {rows.length ? 'No site matches.' : 'Your organization has no sites yet.'}
          </Typography>
        ) : null}
      </Box>
      <FormHelperText sx={{ mx: 0 }}>
        {error ??
          (full
            ? `That’s the most one group can include (${MAX_CONSENT_GROUP_HOSTS}).`
            : `${chosen.size} selected`)}
      </FormHelperText>
    </FormControl>
  )
}
ConsentGroupSitePicker.displayName = 'ConsentGroupSitePicker'

export default ConsentGroupSitePicker
