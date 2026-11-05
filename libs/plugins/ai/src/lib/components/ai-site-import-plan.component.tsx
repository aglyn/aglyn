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

import { Card, CardContent, CardHeader, Chip, Divider, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useId } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import type { AiSiteImportState, AiSiteImportWave } from '../model/ai-site-import'
import { AI_SITE_IMPORT_PLAN_COPY_TEXT, aiSiteImportPicturesSwitchText, aiSiteImportPlanViewOf, aiSiteImportWhatsNew } from '../model/ai-site-import-view'

/** One line of the plan: a small label over what it says. */
function PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary" component="h3">
        {label}
      </Typography>
      {children}
    </Stack>
  )
}

/** A menu's entries or a footer's columns: each label, and the pages under it where it holds several. */
function PlanGroups({ groups }: { groups: ReadonlyArray<{ label: string; pages: string[] }> }) {
  return (
    <Stack spacing={1}>
      {groups.map((group) => (
        <Stack key={group.label} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
            {group.label}
          </Typography>
          {group.pages.length > 1 || group.pages[0] !== group.label
            ? group.pages.map((page) => <Chip key={page} label={page} size="small" variant="outlined" />)
            : null}
        </Stack>
      ))}
    </Stack>
  )
}

export interface AiSiteImportPlanField {
  addPage: boolean
  pictures: boolean
}

export interface AiSiteImportPlanPanelProps {
  job: Pick<AiJobSummary, 'items' | 'siteImport'>
  state: AiSiteImportState
  field: AiSiteImportPlanField
  /** Absent, the plan is read only: it was accepted, and what it switched is built. */
  onChange?: (field: AiSiteImportPlanField) => void
  disabled?: boolean
}

/**
 * "Your new site" (AGL-4152): what the site's plan makes of it, shown before
 * anything is built: what the site is, its menu, the header's main button, its
 * footer's columns, its one proposed page and whether a slot may take a generated
 * picture, each of those two with a switch. Drawn only for an import the flag
 * planned; every other import has no plan and never reaches it.
 */
export function AiSiteImportPlanPanel({ state, field, onChange, disabled }: AiSiteImportPlanPanelProps) {
  const view = aiSiteImportPlanViewOf(state)
  const id = useId()
  if (!view) return null
  const copy = AI_SITE_IMPORT_PLAN_COPY_TEXT
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardHeader title={copy.heading} subheader={view.what} slotProps={{ title: { variant: 'subtitle1', component: 'h2' }, subheader: { variant: 'body2' } }} />
      <Divider />
      <CardContent>
        <Stack spacing={2.5}>
          <PlanRow label={copy.menu}>
            <PlanGroups groups={view.menu} />
          </PlanRow>
          {view.cta ? (
            <PlanRow label={copy.cta}>
              <Typography variant="body2">{view.cta}</Typography>
            </PlanRow>
          ) : null}
          {view.footer.length ? (
            <PlanRow label={copy.footer}>
              <PlanGroups groups={view.footer} />
            </PlanRow>
          ) : null}
          {view.proposed ? (
            <Stack spacing={0.5}>
              {view.editable && onChange ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.addPage}
                      disabled={disabled}
                      onChange={(event) => onChange({ ...field, addPage: event.target.checked })}
                      slotProps={{ input: { 'aria-describedby': `${id}-page` } }}
                    />
                  }
                  label={`${copy.addPage}: ${view.proposed.title}`}
                />
              ) : (
                <PlanRow label="New page">
                  <Typography variant="body2">{`${view.proposed.title} (${view.proposed.address})`}</Typography>
                </PlanRow>
              )}
              <Stack id={`${id}-page`} spacing={0.5}>
                <Typography variant="body2" color="text.secondary">
                  {view.proposed.purpose}
                </Typography>
                {view.editable ? (
                  <Typography variant="body2" color="text.secondary">
                    {copy.addPageHelp}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
          ) : null}
          {view.editable && onChange ? (
            <Stack spacing={0.5}>
              <FormControlLabel
                control={
                  <Switch
                    checked={field.pictures}
                    disabled={disabled}
                    onChange={(event) => onChange({ ...field, pictures: event.target.checked })}
                    slotProps={{ input: { 'aria-describedby': `${id}-pictures` } }}
                  />
                }
                label={copy.pictures}
              />
              <Typography id={`${id}-pictures`} variant="body2" color="text.secondary">
                {aiSiteImportPicturesSwitchText(state)}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

/** A wave's "What's new" (AGL-4152): what its redesigns added, page by page. Nothing where they added nothing. */
export function AiSiteImportWhatsNewList({ state, wave }: { state: AiSiteImportState; wave: AiSiteImportWave }) {
  const lines = aiSiteImportWhatsNew(state, wave)
  if (!lines.length) return null
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardHeader title={AI_SITE_IMPORT_PLAN_COPY_TEXT.whatsNew} slotProps={{ title: { variant: 'subtitle1', component: 'h2' } }} />
      <Divider />
      <CardContent>
        <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {lines.map((line) => (
            <Stack component="li" key={line.page} spacing={0.25}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {line.page}
              </Typography>
              {line.lines.map((text) => (
                <Typography key={text} variant="body2" color="text.secondary">
                  {text}
                </Typography>
              ))}
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

export default AiSiteImportPlanPanel
