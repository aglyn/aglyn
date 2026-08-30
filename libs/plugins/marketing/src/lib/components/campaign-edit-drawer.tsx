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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'

/** One option in the list or topic picker. */
export interface CampaignEditOption {
  value: string
  label: string
}

/** What the drawer collects — the container's whole editable surface. */
export interface CampaignEditValues {
  name: string
  startAtMs: number | null
  endAtMs: number | null
  listIds: string[]
  topicId: string
}

export interface CampaignEditDrawerProps {
  open: boolean
  onClose: () => void
  /** The campaign as stored, for the fields to open on. */
  campaign: {
    name?: string
    startAtMs?: number | null
    endAtMs?: number | null
    listIds?: string[]
    topicId?: string
  } | null
  /** The org's email lists, which this campaign may be aimed at. */
  lists: CampaignEditOption[]
  /** The org's active topics — the stream its emails open on. */
  topics: CampaignEditOption[]
  busy?: boolean
  /** A refusal from the write, shown where the form still is. */
  error?: string | null
  onSubmit: (values: CampaignEditValues) => void
}

/**
 * The `YYYY-MM-DD` a `date` input wants, from epoch ms.
 *
 * UTC, matching the writer: the create drawer stores `Date.parse('2026-03-01')`,
 * which is UTC midnight, so reading it back in local time shows the previous
 * day to everyone west of Greenwich — a campaign that changed its own start
 * date by being opened.
 */
function dayInputValue(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const at = new Date(ms)
  return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, 10)
}

/** Epoch ms for a `YYYY-MM-DD` a `date` input produced, or null for empty. */
function dayInputMs(value: string): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * EDITING ONE CAMPAIGN, IN A DRAWER ON THE CAMPAIGN'S OWN PAGE.
 *
 * A drawer and not a form above the campaigns table: a record is edited on
 * its own surface in this console, and a list with a form on top of it is
 * the shape the whole surface was routed to stop.
 *
 * ## Everything a container holds is editable, and that is the whole point
 *
 * A campaign is a name, a window, the lists it is aimed at and the stream its
 * emails open on. None of it describes mail that has already been delivered —
 * that lives on the SENDS, which record their own subject, audience and topic
 * at send time and are never rewritten. So unlike an email, where only the
 * console-only display name stays editable after it goes out, a campaign has
 * no field that could come to disagree with somebody's inbox.
 *
 * Changing the topic is the one that reads as though it might. It does not:
 * the topic here is what the composer's picker OPENS ON, and each send
 * records the topic it actually went out under. Re-pointing a campaign
 * changes the default for the next email written in it and nothing about the
 * ones already sent.
 */
export function CampaignEditDrawer(props: CampaignEditDrawerProps) {
  const { open, onClose, campaign, lists, topics, busy, error, onSubmit } =
    props

  const [name, setName] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [listIds, setListIds] = useState<string[]>([])
  const [topicId, setTopicId] = useState('')

  /*
   * Re-seeded whenever the drawer opens rather than held from the last time.
   * The campaign arrives asynchronously and can change under a closed drawer,
   * so seeding once at mount would open it on a stale name.
   */
  useEffect(() => {
    if (!open) return
    setName(String(campaign?.name ?? ''))
    setStartAt(dayInputValue(campaign?.startAtMs))
    setEndAt(dayInputValue(campaign?.endAtMs))
    setListIds((campaign?.listIds ?? []).map(String))
    setTopicId(String(campaign?.topicId ?? ''))
  }, [open, campaign])

  const startAtMs = dayInputMs(startAt)
  const endAtMs = dayInputMs(endAt)
  /*
   * Refused in the form rather than stored and rendered, exactly as the
   * create drawer refuses it: a campaign that ends before it starts is a
   * window no state in `campaignWindowState` describes, so it would draw as
   * "Ended" from the day it was made.
   */
  const backwards = startAtMs !== null && endAtMs !== null && endAtMs < startAtMs
  const submittable = name.trim().length > 0 && !backwards && !busy

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {'Edit campaign'}
          </Typography>
        </>
      }
      appBarRight={
        <Button variant="outlined" color="inherit" onClick={onClose}>
          {'Cancel'}
        </Button>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            helperText="What you call this campaign in the console"
            fullWidth
          />
          <TextField
            type="date"
            label="Starts"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
            helperText="When the campaign window opens"
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            type="date"
            label="Ends"
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
            helperText="Leave empty for an open-ended campaign"
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            select
            label="Lists"
            value={listIds}
            onChange={(event) =>
              setListIds(
                // A multiple select hands back an array; the typing on the
                // change event does not know that.
                (event.target.value as unknown as string[]).map(String),
              )
            }
            // A campaign with no list is legitimate: its emails can go to
            // leads, to site members, or to a segment.
            helperText="The lists this campaign is aimed at"
            slotProps={{
              select: {
                multiple: true,
                renderValue: (selected: unknown) => (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {(selected as string[]).map((id) => (
                      <Chip
                        key={id}
                        size="small"
                        label={
                          lists.find((list) => list.value === id)?.label ?? id
                        }
                      />
                    ))}
                  </Stack>
                ),
              },
            }}
            fullWidth
          >
            {lists.map((list) => (
              <MenuItem key={list.value} value={list.value}>
                {list.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Topic"
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
            helperText="The stream its emails open on — each one can change it"
            fullWidth
          >
            {/*
              An explicit "no default" option rather than only the topics.
              A campaign is allowed to carry none — the send resolves the
              org's default when the composer names nothing — and a select
              with no way back to empty makes the first choice permanent.
             */}
            <MenuItem value="">{'No default — each email chooses'}</MenuItem>
            {topics.map((topic) => (
              <MenuItem key={topic.value} value={topic.value}>
                {topic.label}
              </MenuItem>
            ))}
          </TextField>
          {backwards ? (
            <Alert severity="warning">
              {'The end date is before the start date.'}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Button
            variant="contained"
            disabled={!submittable}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                startAtMs,
                endAtMs,
                listIds,
                topicId,
              })
            }
          >
            {busy ? 'Saving…' : 'Save campaign'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
CampaignEditDrawer.displayName = 'CampaignEditDrawer'

export default CampaignEditDrawer
