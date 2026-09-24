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

import {
  embeddedFieldDisplay,
  embeddedFieldKind,
  embeddedFieldLabel,
  embeddedMetadataReadable,
  embeddedWritableKeys,
  MEDIA_EMBEDDED_CATALOG,
  MEDIA_EMBEDDED_GROUP_LABELS,
  MEDIA_EMBEDDED_METADATA_VERSION,
  type MediaEmbeddedCanonicalKey,
  type MediaEmbeddedField,
  type MediaEmbeddedMetadata,
} from '@aglyn/aglyn/app-utils/media-embedded-fields'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  embeddedDraftValue,
  embeddedPatchFromDrafts,
  groupEmbeddedFields,
  mediaStoredFacts,
} from './media-file-info-copy'

export interface MediaFileInfoProps {
  mediaId: string
  /** The media document as the drawer holds it. */
  media: Record<string, any>
  /** `{ orgId }` or `{ hostId }` — which library the asset lives in. */
  scopeBody: Record<string, string | undefined>
  user: unknown
  /**
   * The bytes changed under the asset — its digests, size, raw URL and
   * embedded record, as the write answered them. The drawer merges them
   * into what it holds so a replace from the same drawer is not a 409.
   */
  onFileChanged?: (update: Record<string, unknown>) => void
}

/** Whether a stored record describes the bytes the document names. */
const isCurrent = (record: unknown, sha: unknown) => {
  const value = record as Partial<MediaEmbeddedMetadata> | undefined
  return Boolean(
    value &&
      value.version === MEDIA_EMBEDDED_METADATA_VERSION &&
      Array.isArray(value.fields) &&
      (typeof sha !== 'string' || value.contentSha256 === sha),
  )
}

const FactRow = ({ label, children }: { label: string; children: string }) => (
  <>
    <Typography variant="caption" color="text.secondary" sx={{ pt: '2px' }}>
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{ wordBreak: 'break-word', whiteSpace: 'pre-line' }}
    >
      {children}
    </Typography>
  </>
)

const ROWS_SX = {
  display: 'grid',
  gridTemplateColumns: '104px 1fr',
  columnGap: 1.5,
  rowGap: 0.75,
  alignItems: 'start',
} as const

/**
 * The Details drawer's "File info" section (AGL-3331): what the platform
 * measured about the stored file, and what the file carries inside itself —
 * readable for every format with a reader, editable where the format can
 * take an edit without being re-encoded.
 *
 * An edit here is not a document field. It rewrites the FILE — the bytes
 * every page using the asset serves, and what anyone who downloads it gets —
 * so it saves on its own button with its own words, rather than riding the
 * drawer's Save beside the folder and the tags.
 */
export function MediaFileInfo(props: MediaFileInfoProps) {
  const { mediaId, media, scopeBody, user, onFileChanged } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const contentType = String(media?.['contentType'] ?? '')
  const readable = embeddedMetadataReadable(contentType)
  const [sha, setSha] = useState<string | undefined>(media?.['contentSha256'])
  const [record, setRecord] = useState<MediaEmbeddedMetadata | null | undefined>(
    () =>
      isCurrent(media?.['embeddedMetadata'], media?.['contentSha256'])
        ? (media['embeddedMetadata'] as MediaEmbeddedMetadata)
        : readable
          ? undefined
          : null,
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(user as any, '/api/media/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scopeBody, mediaId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw Object.assign(
          new Error(payload?.error ?? 'Reading the file failed'),
          { status: response.status },
        )
      }
      return payload
    },
    [user, scopeBody, mediaId],
  )

  // The drawer rebuilds `scopeBody` on every render, so `post` is a new
  // function each time; the read below must not restart on every keystroke
  // typed elsewhere in the drawer, so it reaches `post` through a ref.
  const postRef = useRef(post)
  postRef.current = post
  const loading = record === undefined
  const signedIn = Boolean(user)

  // The backfill: an asset with no current record is read the first time
  // its drawer opens, and the server keeps what it read.
  useEffect(() => {
    if (!loading || !signedIn) return
    let cancelled = false
    postRef
      .current({ action: 'read' })
      .then((payload) => {
        if (!cancelled) setRecord(payload?.embeddedMetadata ?? null)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error?.message ?? 'Reading the file failed')
        setRecord(null)
      })
    return () => {
      cancelled = true
    }
  }, [loading, signedIn, mediaId])

  const facts = useMemo(() => mediaStoredFacts(media), [media])
  const fields = useMemo(() => record?.fields ?? [], [record])
  const format = record?.format
  const canEdit = Boolean(record?.writable && format)
  const present = useMemo(() => new Set(fields.map((field) => field.key)), [fields])
  const addable = useMemo(
    () =>
      format
        ? embeddedWritableKeys(format).filter(
            (key) =>
              !present.has(key) &&
              !(key in drafts) &&
              !(MEDIA_EMBEDDED_CATALOG[key] as { removeOnly?: boolean })
                .removeOnly,
          )
        : [],
    [format, present, drafts],
  )
  const addedKeys = useMemo(
    () => Object.keys(drafts).filter((key) => !present.has(key)),
    [drafts, present],
  )
  const gps = fields.find((field) => field.key === 'gps')

  const startEditing = () => {
    setDrafts(
      Object.fromEntries(
        fields
          .filter((field) => field.editable)
          .map((field) => [field.key, embeddedDraftValue(field)]),
      ),
    )
    setRemoved(new Set())
    setEditing(true)
  }

  const write = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      const payload = await post({ action: 'write', patch, expectedSha256: sha })
      setRecord(payload.embeddedMetadata)
      setEditing(false)
      if (payload.unchanged) {
        enqueueSnackbar('Nothing in the file needed to change', {
          variant: 'info',
          persist: false,
        })
        return
      }
      setSha(payload.contentSha256)
      onFileChanged?.({
        contentSha256: payload.contentSha256,
        contentHash: payload.contentHash,
        sizeBytes: payload.sizeBytes,
        url: payload.url,
        embeddedMetadata: payload.embeddedMetadata,
      })
      enqueueSnackbar('Saved into the file', { variant: 'success', persist: false })
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Saving into the file failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }

  const saveEdits = () => {
    const patch = embeddedPatchFromDrafts(fields, drafts, removed)
    if (!Object.keys(patch).length) return setEditing(false)
    void write(patch)
  }

  const removeLocation = async () => {
    const proceed = await confirm({
      title: 'Remove the location from this file?',
      description:
        'The GPS position is erased from the file itself, so pages that ' +
        'show it and anyone who downloads it no longer get it. It cannot ' +
        'be put back afterwards.',
      confirmationText: 'Remove location',
    })
      .then(() => true)
      .catch(() => false)
    if (proceed) void write({ gps: null })
  }

  const renderEditor = (key: string, field?: MediaEmbeddedField) => {
    const kind = embeddedFieldKind(key)
    const label = field?.label ?? (format ? embeddedFieldLabel(key, format) : key)
    const value = drafts[key] ?? ''
    const set = (next: string) =>
      setDrafts((prev) => ({ ...prev, [key]: next }))
    const remove = (
      <Tooltip title={`Remove ${label} from the file`}>
        <IconButton
          size="small"
          aria-label={`Remove ${label}`}
          onClick={() => {
            if (field) setRemoved((prev) => new Set(prev).add(key))
            setDrafts((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
          }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    )
    if (kind === 'rating') {
      return (
        <Stack key={key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            fullWidth
            label={label}
            value={value}
            onChange={(event) => set(event.target.value)}
          >
            {['-1', '0', '1', '2', '3', '4', '5'].map((stars) => (
              <MenuItem key={stars} value={stars}>
                {embeddedFieldDisplay({ key: 'rating', value: stars })}
              </MenuItem>
            ))}
          </TextField>
          {remove}
        </Stack>
      )
    }
    return (
      <Stack key={key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label={label}
          value={value}
          onChange={(event) => set(event.target.value)}
          multiline={kind === 'list' || kind === 'longText'}
          minRows={kind === 'longText' ? 2 : 1}
          type={kind === 'date' ? 'datetime-local' : 'text'}
          slotProps={{
            inputLabel: kind === 'date' ? { shrink: true } : {},
            htmlInput: kind === 'date' ? { step: 1 } : {},
          }}
          helperText={kind === 'list' ? 'One per line' : undefined}
        />
        {remove}
      </Stack>
    )
  }

  if (!facts.length && !readable) return null

  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mb: 0.75 }}
      >
        {'File info'}
      </Typography>
      <Box sx={ROWS_SX}>
        {facts.map((fact) => (
          <FactRow key={fact.label} label={fact.label}>
            {fact.value}
          </FactRow>
        ))}
      </Box>

      {record === undefined ? (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {'Reading the details inside the file…'}
          </Typography>
          <LinearProgress sx={{ mt: 0.5 }} />
        </Box>
      ) : null}
      {loadError ? (
        <Typography variant="caption" color="error" component="div" sx={{ mt: 1.5 }}>
          {loadError}
        </Typography>
      ) : null}

      {record ? (
        <Box sx={{ mt: 2 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}
          >
            <Typography variant="caption" color="text.secondary" component="div">
              {'Inside the file'}
            </Typography>
            {canEdit && !editing ? (
              <Button
                size="small"
                startIcon={<EditOutlinedIcon fontSize="small" />}
                onClick={startEditing}
                disabled={saving}
              >
                {fields.length ? 'Edit' : 'Add details'}
              </Button>
            ) : null}
          </Stack>

          {!fields.length && !editing ? (
            <Typography variant="body2" color="text.secondary">
              {'This file carries no details of its own.'}
            </Typography>
          ) : null}

          {editing ? (
            <Stack spacing={1.25}>
              {fields.map((field) =>
                field.editable && !removed.has(field.key) ? (
                  renderEditor(field.key, field)
                ) : removed.has(field.key) ? null : field.key === 'gps' ? (
                  <Stack
                    key={field.key}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Box sx={ROWS_SX}>
                      <FactRow label={field.label}>
                        {embeddedFieldDisplay(field)}
                      </FactRow>
                    </Box>
                    <Tooltip title="Remove the location from the file">
                      <IconButton
                        size="small"
                        aria-label="Remove location"
                        onClick={() =>
                          setRemoved((prev) => new Set(prev).add(field.key))
                        }
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ) : (
                  <Box key={field.key} sx={ROWS_SX}>
                    <FactRow label={field.label}>
                      {embeddedFieldDisplay(field)}
                    </FactRow>
                  </Box>
                ),
              )}
              {addedKeys.map((key) => renderEditor(key))}
              {addable.length ? (
                <>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={(event) => setAddAnchor(event.currentTarget)}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {'Add a field'}
                  </Button>
                  <Menu
                    anchorEl={addAnchor}
                    open={Boolean(addAnchor)}
                    onClose={() => setAddAnchor(null)}
                  >
                    {addable.map((key: MediaEmbeddedCanonicalKey) => (
                      <MenuItem
                        key={key}
                        onClick={() => {
                          setDrafts((prev) => ({ ...prev, [key]: '' }))
                          setAddAnchor(null)
                        }}
                      >
                        {format ? embeddedFieldLabel(key, format) : key}
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                {'Saved into the file itself: every page that uses it serves ' +
                  'the updated file, and downloads include the change.'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  {'Cancel'}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={saveEdits}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save to file'}
                </Button>
              </Stack>
            </Stack>
          ) : (
            groupEmbeddedFields(fields).map(({ group, fields: grouped }) => (
              <Box key={group} sx={{ mb: 1.5 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  component="div"
                  sx={{ lineHeight: 2 }}
                >
                  {MEDIA_EMBEDDED_GROUP_LABELS[group]}
                </Typography>
                <Box sx={ROWS_SX}>
                  {grouped.map((field) => (
                    <FactRow key={field.key} label={field.label}>
                      {embeddedFieldDisplay(field)}
                    </FactRow>
                  ))}
                </Box>
              </Box>
            ))
          )}

          {!editing && gps && gps.editable ? (
            <Button
              size="small"
              color="warning"
              onClick={() => void removeLocation()}
              disabled={saving}
            >
              {'Remove location from file'}
            </Button>
          ) : null}
          {record.readOnlyReason ? (
            <Typography variant="caption" color="text.secondary" component="div">
              {record.readOnlyReason}
            </Typography>
          ) : null}
          {record.truncated ? (
            <Typography variant="caption" color="text.secondary" component="div">
              {'Some long values are shortened here and cannot be edited ' +
                'from this panel.'}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

export default MediaFileInfo
