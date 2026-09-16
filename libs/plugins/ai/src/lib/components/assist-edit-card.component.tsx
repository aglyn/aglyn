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

import type { EditorSession } from '@aglyn/aglyn/plugin-manager/editor-sessions'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  Collapse,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import {
  describeAssistEditDiff,
  type AssistEditDocumentKind,
  type AssistEditProposal,
} from '../model/assist-edit'

/**
 * The edit card (AGL-2906): a level-3 proposal as the author decides on it.
 *
 * It says what would change — the counts, and what validation left out —
 * and offers exactly one way forward for the editor as it stands:
 *
 *  - on the document the proposal was made for, on a version the live site
 *    does not serve: **Apply as draft**, which the panel carries out through
 *    the canvas's own mutators as one undoable, unsaved change;
 *  - on the version the live site serves: **Make a new version**, the
 *    editor's own flow, after which the same card offers Apply there;
 *  - anywhere else: nothing to press but **No thanks**.
 *
 * The card makes no request and holds no write of its own: its buttons call
 * back into the panel, which applies through the canvas and reports nothing
 * but the counts.
 */

const DOCUMENT_NOUNS: Readonly<Record<AssistEditDocumentKind, string>> = {
  screen: 'page',
  component: 'component',
  layout: 'layout',
}

export interface AssistEditCardProps {
  proposal: AssistEditProposal
  /** The product's name as this org reads it. */
  brand: string
  /** The open editor, or `undefined` when none is open. */
  session: EditorSession | undefined
  /** Why the last attempt to apply was refused, when it was. */
  failure?: string | null
  onApply: () => void
  onCreateVersion: () => void
  onDismiss: () => void
}

export function AssistEditCard(props: AssistEditCardProps) {
  const { proposal, brand, session, failure, onApply, onCreateVersion, onDismiss } = props
  const [showDropped, setShowDropped] = useState(false)
  const noun = DOCUMENT_NOUNS[proposal.target.kind] ?? 'document'
  const onDocument = Boolean(
    session &&
      session.documentKind === proposal.target.kind &&
      session.documentId === proposal.target.documentId,
  )
  const live = onDocument && Boolean(session?.isLiveVersion())
  const changes = describeAssistEditDiff(proposal.diff)

  return (
    <Paper
      variant="outlined"
      sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}
    >
      <Typography variant="subtitle2">Proposed change</Typography>
      {proposal.summary ? (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {proposal.summary}
        </Typography>
      ) : null}
      {changes.length > 0 && (
        <Stack component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
          {changes.map((line) => (
            <Typography key={line} component="li" variant="caption">
              {line}
            </Typography>
          ))}
        </Stack>
      )}
      {proposal.dropped.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          <Link
            component="button"
            type="button"
            variant="caption"
            underline="hover"
            onClick={() => setShowDropped((prior) => !prior)}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
          >
            {`Left out (${proposal.dropped.length})`}
            <MdiIcon
              path={showDropped ? mdiChevronUp.path : mdiChevronDown.path}
              sx={{ fontSize: 14 }}
            />
          </Link>
          <Collapse in={showDropped} unmountOnExit>
            <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
              {proposal.dropped.map((reason, index) => (
                <Typography
                  key={index}
                  component="li"
                  variant="caption"
                  color="text.secondary"
                >
                  {reason}
                </Typography>
              ))}
            </Stack>
          </Collapse>
        </Box>
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1 }}
      >
        {!onDocument
          ? `Open this ${noun} in the Besigner to apply the change.`
          : live
            ? `This is the version your live site shows. Make a new version first — the change is applied there, and the live ${noun} stays as it is.`
            : `${brand} Assist changes nothing until you apply. Applying adds these changes to the open canvas as unsaved edits: undo takes them back, and nothing is saved or published until you save.`}
      </Typography>
      {failure ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {failure}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        {onDocument && !live ? (
          <Button variant="contained" size="small" onClick={onApply}>
            Apply as draft
          </Button>
        ) : null}
        {onDocument && live && session?.createVersion ? (
          <Button variant="contained" size="small" onClick={onCreateVersion}>
            Make a new version
          </Button>
        ) : null}
        <Button size="small" color="inherit" onClick={onDismiss}>
          No thanks
        </Button>
      </Stack>
    </Paper>
  )
}

export default AssistEditCard
