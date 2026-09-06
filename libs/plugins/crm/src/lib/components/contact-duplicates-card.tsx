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

import { type ConsentGroup, contactDisplayName, pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { crmRoutes } from '../model/crm-routes'
import {
  CONTACT_DUPLICATES_LIMIT,
  DUPLICATE_REASON_LABELS,
  type DuplicateReason,
  duplicateNameKey,
  likelyDuplicateReasons,
} from '../model/contact-duplicates'
import type { ContactPick } from './contact-merge-dialog'

export interface ContactDuplicatesCardProps {
  /** The record whose page this is. */
  current: ContactPick
  /** `['orgs', orgId]` — where the contacts live. */
  scope: readonly [string, string]
  consentGroup: ConsentGroup
  /** What this viewer may list — the query's `array-contains-any`. */
  visibleTo: readonly string[]
  /** The hub's own path, for the link to a candidate's page. */
  basePath: string
  /** Opens the merge dialog with the candidate picked. */
  onMerge: (candidate: ContactPick) => void
}

interface Candidate extends ContactPick {
  reasons: DuplicateReason[]
}

/**
 * LIKELY DUPLICATES (AGL-2625) — on ask, never on mount.
 *
 * One bounded read when the button is pressed: the contacts this viewer may
 * list that carry the same normalized name, on the `(visibleTo, nameLower)`
 * index the list's own search uses. The rule — same name AND a shared phone
 * or company — is applied to that page, so a record with a different name
 * is never offered; a reader who knows two differently-named records are
 * one person merges them from the overflow menu instead.
 *
 * A button rather than a listener because the question costs a page of
 * PII, and most record pages are opened by somebody who did not ask it.
 */
export function ContactDuplicatesCard(props: ContactDuplicatesCardProps) {
  const { current, scope, consentGroup, visibleTo, basePath, onMerge } = props
  const firestore = useFirestore()
  const routes = crmRoutes(basePath)
  const groupId = consentGroup.groupId
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameKey = duplicateNameKey(current.doc, groupId)

  const find = useCallback(async () => {
    if (searching || !nameKey) return
    setSearching(true)
    setError(null)
    try {
      const found = await getDocs(
        query(
          collection(firestore, scope[0], scope[1], 'contacts'),
          where('visibleTo', 'array-contains-any', [...visibleTo]),
          where('nameLower', '==', nameKey),
          limit(CONTACT_DUPLICATES_LIMIT),
        ),
      )
      setCandidates(
        found.docs
          .map((snapshot) => ({ id: snapshot.id, doc: snapshot.data() }))
          .map((pick) => ({
            ...pick,
            reasons: likelyDuplicateReasons(current, pick, groupId),
          }))
          .filter((pick) => pick.reasons.length > 0),
      )
    } catch (findError) {
      console.error(findError)
      setCandidates(null)
      setError('The duplicates could not be looked for.')
    } finally {
      setSearching(false)
    }
  }, [searching, nameKey, firestore, scope, visibleTo, current, groupId])

  return (
    <CardDisplay
      header="Likely duplicates"
      subheader="Other records with this name and the same phone or company."
      help={pluginDocsHelp('contactRecord', { anchor: '#likely-duplicates' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="outlined"
            onClick={() => void find()}
            disabled={searching || !nameKey}
          >
            {searching ? 'Looking…' : 'Find likely duplicates'}
          </Button>
        ),
      }}
    >
      {!nameKey ? (
        <Typography variant="body2" color="text.secondary">
          {'Give this contact a name first — duplicates are found by name.'}
        </Typography>
      ) : error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : candidates === null ? (
        <Typography variant="body2" color="text.secondary">
          {'Not looked for yet. A record with a different name can still be ' +
            'merged from the menu above.'}
        </Typography>
      ) : candidates.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No likely duplicates among the contacts you can see.'}
        </Typography>
      ) : (
        <List dense disablePadding aria-label="Likely duplicates">
          {candidates.map((candidate) => (
            <ListItem
              key={candidate.id}
              disableGutters
              secondaryAction={
                <Button size="small" onClick={() => onMerge(candidate)}>
                  {'Merge into this record'}
                </Button>
              }
            >
              <ListItemText
                primary={
                  <AppLink href={routes.contact(candidate.id)} color="inherit" underline="hover">
                    {contactDisplayName(candidate.doc, groupId) ||
                      String(candidate.doc['email'] ?? candidate.id)}
                  </AppLink>
                }
                secondary={
                  <Stack
                    component="span"
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                  >
                    <span>{String(candidate.doc['email'] ?? '')}</span>
                    {candidate.reasons.map((reason) => (
                      <Chip
                        key={reason}
                        size="small"
                        variant="outlined"
                        label={DUPLICATE_REASON_LABELS[reason]}
                      />
                    ))}
                  </Stack>
                }
                slotProps={{ secondary: { component: 'div' } }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </CardDisplay>
  )
}
ContactDuplicatesCard.displayName = 'ContactDuplicatesCard'

export default ContactDuplicatesCard
