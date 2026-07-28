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
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import {
  describeChange,
  summarizeValue,
  type ArtifactChange,
} from '../model'
import type { ArtifactUpdatePreview } from '../hooks/use-artifact-update'

/**
 * "What will this update do to my copy?" answered before anything is written
 * (AGL-1018).
 *
 * The dialog exists because the alternative is an Update button that silently
 * overwrites customised content. So the ordering here is the point: what the
 * publisher changed that is safe to take, what stays because this workspace
 * edited it, and — last, and never pre-selected — the fields both sides
 * changed, where taking the publisher's value means losing an edit.
 *
 * Applying without reading anything is safe by construction: every conflict
 * defaults to keeping the workspace's value.
 */
export interface ArtifactUpdateDialogProps {
  open: boolean
  onClose: () => void
  /** The listing's name, for the title. Not `displayName` — that name collides
   * with the React component static and arrives undefined. */
  artifactName: string
  preview: ArtifactUpdatePreview | null
  loading: boolean
  onApplyMerge: (takePaths: string[], confirmDestructive: boolean) => void
  onApplyCopy: () => void
}

/** One diff row: what it is, what you have, what they ship. */
function ChangeRow({
  change,
  action,
}: {
  change: ArtifactChange
  action?: React.ReactNode
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start', py: 0.5 }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
        >
          {describeChange(change)}
        </Typography>
        {/* Values, summarised. A diff row that dumps a serialised node is
            unreadable exactly when it matters most. */}
        {!change.added && !change.removed ? (
          <Typography variant="caption" color="text.secondary">
            {`yours: ${summarizeValue(change.current)} · theirs: ${summarizeValue(
              change.incoming,
            )}`}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Stack>
  )
}

function Section({
  title,
  caption,
  changes,
  children,
}: {
  title: string
  caption: string
  changes: ArtifactChange[]
  children?: React.ReactNode
}) {
  if (!changes.length && !children) return null
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Chip size="small" label={changes.length} />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
      {children ??
        changes.map((change) => (
          <ChangeRow key={change.path} change={change} />
        ))}
    </Stack>
  )
}

export function ArtifactUpdateDialog({
  open,
  onClose,
  artifactName,
  preview,
  loading,
  onApplyMerge,
  onApplyCopy,
}: ArtifactUpdateDialogProps) {
  /** Conflicting paths the user chose to hand to the publisher. */
  const [take, setTake] = useState<string[]>([])
  const [confirmDestructive, setConfirmDestructive] = useState(false)
  // A fresh preview is a fresh decision — carrying ticks across two different
  // updates would apply a choice to a field the user never looked at.
  useEffect(() => {
    setTake([])
    setConfirmDestructive(false)
  }, [preview])

  const schema = preview?.schema
  const destructive = Boolean(schema && !schema.additiveOnly)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{`Update ${artifactName}`}</DialogTitle>
      <DialogContent dividers>
        {loading || !preview ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {preview.installedVersion
                ? `You have v${preview.installedVersion}; v${preview.availableVersion} is available.`
                : `v${preview.availableVersion} is available.`}
            </Typography>

            {/* No base, or a type that cannot be merged. Saying which, in the
                publisher's own terms, beats a disabled button with no reason. */}
            {!preview.mergeable ? (
              <Alert severity="info">{preview.reason}</Alert>
            ) : preview.identical ? (
              <Alert severity="success">
                {'Your copy already matches the new version — nothing to take.'}
              </Alert>
            ) : null}

            {schema ? (
              <Alert severity={destructive ? 'warning' : 'info'}>
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    {`${schema.added.length} field(s) added, ${schema.removed.length} removed, ${schema.retyped.length} retyped.`}
                  </Typography>
                  <Typography variant="body2">
                    {destructive
                      ? `This dataset holds ${schema.recordCount} record(s). Removing or ` +
                        'retyping a field changes how their existing values read.'
                      : 'Additive only — nothing already stored is reinterpreted.'}
                  </Typography>
                </Stack>
              </Alert>
            ) : null}

            {preview.mergeable ? (
              <>
                <Section
                  title="Safe to take"
                  caption="Changed by the publisher, untouched here. Applied when you update."
                  changes={preview.safe}
                />
                <Divider />
                <Section
                  title="Your changes, kept"
                  caption="Edited here and not upstream. The update leaves these alone."
                  changes={preview.kept}
                />
                {preview.conflicts.length ? (
                  <>
                    <Divider />
                    <Section
                      title="Changed on both sides"
                      caption="Both you and the publisher changed these. Yours is kept unless you tick it."
                      changes={preview.conflicts}
                    >
                      {preview.conflicts.map((change) => (
                        <ChangeRow
                          key={change.path}
                          change={change}
                          action={
                            <FormControlLabel
                              control={
                                <Checkbox
                                  size="small"
                                  checked={take.includes(change.path)}
                                  onChange={(event) =>
                                    setTake((current) =>
                                      event.target.checked
                                        ? [...current, change.path]
                                        : current.filter(
                                            (path) => path !== change.path,
                                          ),
                                    )
                                  }
                                />
                              }
                              label="Take theirs"
                              slotProps={{ typography: { variant: 'caption' } }}
                              sx={{ mr: 0, whiteSpace: 'nowrap' }}
                            />
                          }
                        />
                      ))}
                    </Section>
                  </>
                ) : null}
                {preview.unchanged ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${preview.unchanged} field(s) identical in both versions.`}
                  </Typography>
                ) : null}
              </>
            ) : null}

            {destructive ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={confirmDestructive}
                    onChange={(event) =>
                      setConfirmDestructive(event.target.checked)
                    }
                  />
                }
                label={`I understand this affects ${schema?.recordCount} existing record(s)`}
                slotProps={{ typography: { variant: 'body2' } }}
              />
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        {/* Always available, and the only option when there is no base: it
            risks nothing, because the customised copy is detached rather than
            replaced. */}
        <Button onClick={onApplyCopy} disabled={loading || !preview}>
          {'Install as a new copy'}
        </Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={
            loading ||
            !preview?.mergeable ||
            preview.identical ||
            (destructive && !confirmDestructive)
          }
          onClick={() => onApplyMerge(take, confirmDestructive)}
        >
          {take.length
            ? `Apply (${take.length} taken from publisher)`
            : 'Apply safe changes'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ArtifactUpdateDialog
