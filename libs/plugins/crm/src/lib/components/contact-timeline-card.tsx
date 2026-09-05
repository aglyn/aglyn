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

import { CONTACT_SOURCE_LABELS, type ContactInteraction } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'

export interface ContactTimelineCardProps {
  /** This holder's captured interactions, in any order. */
  interactions: readonly ContactInteraction[]
}

/**
 * WHAT THE SITE RECORDED ABOUT THIS PERSON, newest first (AGL-2596).
 *
 * The captured interactions only — the form they submitted, the order they
 * placed, the booking they made — read off the viewing group's facet, so a
 * visit to a sibling site in another holder's group is not on it. The
 * activities a team logs by hand (calls, meetings, notes) are a different
 * collection with a reader of its own; this card is where they will be
 * merged in, which is why it is a card of its own rather than a list on the
 * page.
 *
 * Sorted here rather than trusted: the facet stores the timeline newest
 * first and caps it, but a merge of two doors' writes is the kind of thing
 * that can land one entry out of order, and a timeline that reads out of
 * order is worse than one that costs a sort.
 */
export function ContactTimelineCard(props: ContactTimelineCardProps) {
  const entries = [...props.interactions].sort((a, b) => b.atMs - a.atMs)
  return (
    <CardDisplay header={'Activity'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        {entries.map((interaction, index) => (
          <Stack key={`${interaction.atMs}-${index}`}>
            <Typography variant="body2">
              {interaction.summary ??
                CONTACT_SOURCE_LABELS[interaction.type] ??
                interaction.type}
            </Typography>
            {/*
              The entry point, beside the timestamp rather than in the
              summary above it. The summary is the sentence the door wrote;
              the page is a fact the door recorded, and appending it to the
              sentence would put the two on one line where a long path
              pushes out the thing the row is about.
             */}
            <Typography variant="caption" color="text.secondary">
              {interaction.path
                ? `${new Date(interaction.atMs).toLocaleString()} · ${interaction.path}`
                : new Date(interaction.atMs).toLocaleString()}
            </Typography>
          </Stack>
        ))}
        {!entries.length ? (
          <Typography variant="body2" color="text.secondary">
            {'No recorded activity.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ContactTimelineCard.displayName = 'ContactTimelineCard'

export default ContactTimelineCard
