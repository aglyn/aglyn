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
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { type ChangeEvent, useId } from 'react'

/** The ways a shared resource can be shared. */
export type SiteSharingMode = 'all' | 'selected' | 'allExcept'

/**
 * What a person has picked. The shape `sharingFromChoice` takes, restated here
 * because this lib may not depend on `@aglyn/aglyn`.
 */
export type SiteSharingValue =
  | { mode: 'all' }
  | { mode: 'selected'; hostIds: readonly string[] }
  | { mode: 'allExcept'; exceptHostIds: readonly string[] }

export interface SiteSharingSite {
  id: string
  name: string
}

export interface SiteSharingFieldProps {
  /** Null while nobody has chosen: the resource stores no sharing at all. */
  value: SiteSharingValue | null
  onChange: (next: SiteSharingValue) => void
  /** The workspace's sites this member can name. */
  sites: readonly SiteSharingSite[]
  /** False while `sites` is still being read. */
  sitesReady: boolean
  /** The choices this resource offers. Every one by default. */
  modes?: readonly SiteSharingMode[]
  /**
   * The most sites this resource can reach, for one whose stored fields multiply
   * by site. Past it, "All sites except…" is switched off with the reason.
   */
  maxIncluded?: number | null
  label?: string
  readOnly?: boolean
  /** Why it is read-only. Shown when it is. */
  readOnlyReason?: string
  /** Why the caller cannot save this choice, from `sharingFromChoice`. */
  problem?: string | null
}

const EVERY_MODE: readonly SiteSharingMode[] = ['all', 'selected', 'allExcept']

/** A radio's words, and the sentence under them: what it does, or why it is off. */
function ModeLabel(props: { title: string; detail?: string | null }) {
  return (
    <Stack>
      <Typography variant="body2">{props.title}</Typography>
      {props.detail ? (
        <Typography variant="caption" color="text.secondary">
          {props.detail}
        </Typography>
      ) : null}
    </Stack>
  )
}

/**
 * Who a shared resource is shared with: All sites, the sites you choose, or all
 * sites except the ones you leave out (AGL-4047).
 *
 * Radios and a list of checkboxes that are all on screen, never a dropdown: who
 * can see something should read at a glance, and the sites left out are the part
 * people came to check.
 *
 * DELIBERATELY PRESENTATIONAL. It takes the sites and hands back a choice. What a
 * choice writes, and whether it can be, is `sharingFromChoice` in `@aglyn/aglyn`,
 * for the caller and again for the route that writes it. So this holds no wording
 * for a refusal it could disagree with: the caller passes `problem`. What it does
 * itself is keep two choices out of reach that are never right, and say why: a
 * workspace with one site has nothing to leave out, and the last site in can't be
 * left out too.
 *
 * Moving between the modes carries the picks across: chosen sites become "all
 * except the others", and back. Moving from All sites starts with nothing left
 * out, which the caller refuses until something is.
 *
 * NOT IN THE BARREL (AGL-1290). Console-only; import by subpath:
 * `@aglyn/shared-ui-jsx/components/site-sharing-field.component`.
 */
export function SiteSharingField(props: SiteSharingFieldProps) {
  const {
    value,
    onChange,
    sites,
    sitesReady,
    modes = EVERY_MODE,
    maxIncluded = null,
    label = 'Shared with',
    readOnly = false,
    readOnlyReason,
    problem,
  } = props
  const labelId = useId()
  const siteIds = sites.map((site) => site.id)

  const onlyOneSite = sitesReady && sites.length < 2
  const pastLimit = sitesReady && maxIncluded != null && sites.length > maxIncluded
  const exceptOffReason = !sitesReady
    ? 'Reading this workspace’s sites…'
    : onlyOneSite
      ? 'This workspace has one site, so there is nothing to leave out.'
      : pastLimit
        ? `This works up to ${maxIncluded} sites, and this workspace has ${sites.length}. Choose the sites instead.`
        : null

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const mode = event.target.value as SiteSharingMode
    if (mode === 'all') return onChange({ mode: 'all' })
    if (mode === 'selected') {
      return onChange({
        mode: 'selected',
        hostIds:
          value?.mode === 'allExcept'
            ? siteIds.filter((id) => !value.exceptHostIds.includes(id))
            : [],
      })
    }
    return onChange({
      mode: 'allExcept',
      exceptHostIds:
        value?.mode === 'selected'
          ? siteIds.filter((id) => !value.hostIds.includes(id))
          : [],
    })
  }

  // The list a mode acts on, each site's box meaning the same thing throughout.
  const picked: readonly string[] =
    value?.mode === 'selected'
      ? value.hostIds
      : value?.mode === 'allExcept'
        ? value.exceptHostIds
        : []
  // Sites on this choice the member cannot name stay on it, and are counted.
  const unnamed = picked.filter((id) => !siteIds.includes(id)).length
  // Leaving out every site this member can name, with no other site known to stay.
  const lastSiteIn = value?.mode === 'allExcept' ? siteIds.filter((id) => !picked.includes(id)) : []
  const lastSiteLocked = lastSiteIn.length === 1

  const toggle = (hostId: string) => () => {
    const next = picked.includes(hostId) ? picked.filter((id) => id !== hostId) : [...picked, hostId]
    onChange(value?.mode === 'allExcept' ? { mode: 'allExcept', exceptHostIds: next } : { mode: 'selected', hostIds: next })
  }

  const listed = value?.mode === 'selected' || value?.mode === 'allExcept'

  return (
    <FormControl component="fieldset" disabled={readOnly} error={Boolean(problem)} sx={{ gap: 0.5 }}>
      <FormLabel id={labelId} component="legend" sx={{ typography: 'caption' }}>
        {label}
      </FormLabel>
      {readOnly && readOnlyReason ? <FormHelperText>{readOnlyReason}</FormHelperText> : null}
      <RadioGroup aria-labelledby={labelId} value={value?.mode ?? null} onChange={choose}>
        {modes.includes('all') ? (
          <FormControlLabel value="all" control={<Radio size="small" />} label={<ModeLabel title="All sites" />} />
        ) : null}
        {modes.includes('selected') ? (
          <FormControlLabel
            value="selected"
            control={<Radio size="small" />}
            label={<ModeLabel title="Selected sites" detail="A new site doesn’t get this until you add it." />}
          />
        ) : null}
        {modes.includes('allExcept') ? (
          <FormControlLabel
            value="allExcept"
            // The current choice stays on: nobody is told they can't have what they have.
            disabled={readOnly || (Boolean(exceptOffReason) && value?.mode !== 'allExcept')}
            control={<Radio size="small" />}
            label={<ModeLabel title="All sites except…" detail={exceptOffReason ?? 'A new site gets this automatically.'} />}
          />
        ) : null}
      </RadioGroup>
      {listed ? (
        <Stack spacing={0.5} sx={{ pl: 3.5 }}>
          <Typography variant="caption" color="text.secondary">
            {value?.mode === 'allExcept' ? 'Sites to leave out' : 'Sites to share with'}
          </Typography>
          {!sitesReady ? (
            <Typography variant="body2" color="text.secondary">
              {'Reading this workspace’s sites…'}
            </Typography>
          ) : (
            <FormGroup
              sx={{
                flexWrap: 'nowrap',
                maxHeight: (theme) => theme.spacing(30),
                overflowY: 'auto',
              }}
            >
              {sites.map((site) => {
                const locked = lastSiteLocked && lastSiteIn[0] === site.id
                return (
                  <FormControlLabel
                    key={site.id}
                    disabled={readOnly || locked}
                    control={
                      <Checkbox size="small" checked={picked.includes(site.id)} onChange={toggle(site.id)} />
                    }
                    label={
                      <ModeLabel
                        title={site.name}
                        detail={locked ? 'At least one site has to stay in.' : null}
                      />
                    }
                  />
                )
              })}
            </FormGroup>
          )}
          {unnamed > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {`Also ${value?.mode === 'allExcept' ? 'left out' : 'shared with'}: ${unnamed === 1 ? '1 site' : `${unnamed} sites`} you don’t have access to.`}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
      {problem ? <FormHelperText>{problem}</FormHelperText> : null}
    </FormControl>
  )
}
SiteSharingField.displayName = 'SiteSharingField'

export default SiteSharingField
