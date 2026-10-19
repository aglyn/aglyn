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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Box, Button, Chip, Collapse, Divider, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { useSiteCareCall } from './site-care-api'
import SiteCareHistoryList, { type SiteCareHistoryEntry } from './site-care-history-list.component'

interface OwnerProject {
  projectId: string
  title: string
  scope: string[]
  split: string
  status: string
  statusLabel: string
  invoices: Array<{ seq: number; line: string; number: string | null; payUrl: string | null }>
  history: SiteCareHistoryEntry[]
}

export interface SiteCareProjectsBillingCardProps {
  orgId: string
}

/**
 * Projects on Billing (AGL-3970): each flat-quoted project our team billed
 * this workspace — what it covers, the price and how it is split, where it
 * stands, each invoice with its pay link while unpaid — and everything
 * recorded about it, in plain words. The invoices themselves are also in the
 * billing history with every other charge. Draws nothing for a workspace
 * that never had a project.
 */
export function SiteCareProjectsBillingCard({ orgId }: SiteCareProjectsBillingCardProps) {
  const call = useSiteCareCall()
  const callRef = useRef(call)
  callRef.current = call
  const [projects, setProjects] = useState<OwnerProject[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let active = true
    void callRef
      .current<{ projects: OwnerProject[] }>(`/api/site-care/requests?orgId=${encodeURIComponent(orgId)}&view=projects`)
      .then((answer) => {
        if (!active) return
        if (answer.ok) {
          setProjects(answer.body.projects ?? [])
          setFailed(null)
        } else if (answer.status) {
          setFailed(answer.body.error ?? 'Projects could not be read')
        }
      })
    return () => {
      active = false
    }
  }, [orgId])

  if (!failed && (!projects || projects.length === 0)) return null

  return (
    <Box id="site-care-projects">
      <CardDisplay
        header="Projects"
        help={docsHelp('addOns', { anchor: '#site-care-projects' })}
        subheader="Work our team quoted you as one flat price: a new page, a redesign, brand work."
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {failed ? <Alert severity="warning">{failed}</Alert> : null}
          {(projects ?? []).map((project, index) => (
            <Stack key={project.projectId} spacing={1}>
              {index ? <Divider /> : null}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
                  {project.title}
                </Typography>
                <Chip size="small" label={project.statusLabel} color={project.status === 'paid' ? 'success' : 'default'} />
              </Stack>
              <Typography variant="body2">{project.split}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {project.scope.map((line) => (
                  <Typography key={line} component="li" variant="body2" color="text.secondary">
                    {line}
                  </Typography>
                ))}
              </Box>
              {project.invoices.map((invoice) => (
                <Stack key={invoice.seq} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {invoice.number ? `${invoice.line} · invoice ${invoice.number}` : invoice.line}
                  </Typography>
                  {invoice.payUrl ? (
                    <Button size="small" variant="contained" component="a" href={invoice.payUrl} target="_blank" rel="noopener noreferrer">
                      {'Pay'}
                    </Button>
                  ) : null}
                </Stack>
              ))}
              {project.history.length ? (
                <Box>
                  <Button
                    size="small"
                    onClick={() => setOpen((state) => ({ ...state, [project.projectId]: !state[project.projectId] }))}
                  >
                    {open[project.projectId] ? 'Hide what we recorded' : 'Everything we recorded'}
                  </Button>
                  <Collapse in={Boolean(open[project.projectId])} unmountOnExit>
                    <SiteCareHistoryList rows={project.history} />
                  </Collapse>
                </Box>
              ) : null}
            </Stack>
          ))}
        </Stack>
      </CardDisplay>
    </Box>
  )
}

SiteCareProjectsBillingCard.displayName = 'SiteCareProjectsBillingCard'

export default SiteCareProjectsBillingCard
