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

import { isSearchDiscouraged } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface SearchIndexingCardProps {
  hostId: string
}

/**
 * Site-wide search indexing (AGL-1263): one switch that takes the whole site
 * out of search — `robots.txt` disallows everything, the sitemap empties, and
 * every page carries `noindex`.
 *
 * The staged-launch control. Before this, hiding a site meant setting each
 * screen to Unlisted one at a time, which is both tedious and leaky: a screen
 * published after the fact is indexable by default, so the site quietly
 * un-hides itself as it grows.
 *
 * Written with `updateDoc`, matching the maintenance switch it sits beside —
 * the host converter only strips `$id`, so no field is at risk from a partial
 * write here (AGL-1250). `deleteField()` on the way off rather than `false`:
 * "absent means index" is the invariant the tenant reads, and leaving a
 * lingering `false` behind would make the document assert something it does
 * not need to.
 */
export function SearchIndexingCard(props: SearchIndexingCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )

  const discouraged = isSearchDiscouraged(host)

  const handleChange = useCallback(
    async (enabled: boolean) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        'seo.discourageSearchEngines': enabled || deleteField(),
      })
      enqueueSnackbar(
        enabled
          ? 'Search engines discouraged — this site is now hidden from search'
          : 'Search engines allowed — this site can be indexed again',
        { variant: enabled ? 'warning' : 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header="Search engines"
      help={docsHelp('seo', {
        anchor: '#search-engine-visibility',
        excerpt:
          'Hide the whole site from search while you stage a launch, or ' +
          'hide single pages with their Unlisted visibility.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Published pages are offered to search engines by default. To ' +
            'hide one page rather than the site, set its visibility to ' +
            'Unlisted in Page Access.'}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              color="warning"
              checked={discouraged}
              onChange={(event) => void handleChange(event.target.checked)}
            />
          }
          label="Discourage search engines from indexing this site"
        />
        {/*
         * Shown only while it is ON, and worded as consequences rather than
         * settings. "Why is my site not on Google" is the support ticket this
         * switch creates, and the answer has to be legible from the place the
         * switch lives — not only from the banner that follows the author
         * around the console.
         */}
        {discouraged ? (
          <Alert severity="warning">
            {'This site is hidden from search. Its robots.txt refuses every ' +
              'crawler, its sitemap is empty, and every page asks not to be ' +
              'indexed. Visitors with a link can still reach it. Search ' +
              'engines may take days to re-index once you turn this off.'}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
SearchIndexingCard.displayName = 'SearchIndexingCard'

export default SearchIndexingCard
