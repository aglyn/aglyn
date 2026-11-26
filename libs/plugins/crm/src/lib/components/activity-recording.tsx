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
  CALL_RECORDING_CONSENT_STATEMENT,
  CRM_ACTIVITY_MEDIA_IDS_MAX,
  CRM_ACTIVITY_TRANSCRIPT_MAX,
  CRM_CALL_RECORDINGS_FOLDER_PATH,
  formatMediaRef,
  MediaUploadError,
  normalizeCrmActivityMediaIds,
  resolveMediaSrc,
  useMediaPicker,
} from '@aglyn/aglyn'
import {
  mdiClose,
  mdiFileMusicOutline,
  mdiFolderMusicOutline,
  mdiTextBoxOutline,
  mdiTrayArrowDown,
  mdiTrayArrowUp,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, type Firestore, getDoc } from 'firebase/firestore'
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/*
 * CALL RECORDINGS ON AN ACTIVITY.
 *
 * A call or a meeting carries its recording as organization-library media
 * ids — the same reference a record's Files card stores — so the file lives
 * in the library (CRM / Calls), private, and the activity names it. The
 * player resolves each id at read time: a private file through a signed,
 * expiring link the console mints for a member who may see it, a public one
 * through the CDN route.
 */

/** What one recording is known by once its media document has been read. */
export interface ActivityRecording {
  mediaId: string
  fileName: string
  contentType: string
  isPrivate: boolean
  /** The address the audio plays from, or undefined while signing or when it cannot be read. */
  src?: string
  /** The file could not be read: gone from the library, or not this reader's to see. */
  missing?: boolean
}

/** One playback speed the player offers. */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

/** A signed link for a private org asset, from the console's `/api/media/sign`. */
async function signPrivateMedia(
  user: Parameters<typeof authorizedFetch>[0],
  orgId: string,
  mediaId: string,
): Promise<string | undefined> {
  const response = await authorizedFetch(user, '/api/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId, mediaId }),
  })
  if (!response.ok) return undefined
  const payload = (await response.json().catch(() => ({}))) as { url?: unknown }
  return typeof payload.url === 'string' ? payload.url : undefined
}

/**
 * The recordings an activity names, read from the organization's library.
 *
 * One `getDoc` per recording, bounded by {@link CRM_ACTIVITY_MEDIA_IDS_MAX}
 * and paid only when the row is opened. A recording the library no longer
 * holds is still listed, as missing, the way a record's files are.
 */
export function useActivityRecordings(
  firestore: Firestore,
  orgId: string | null | undefined,
  mediaIds: unknown,
  enabled = true,
): ActivityRecording[] | null {
  const { data: user } = useUser()
  // Read through a ref, keyed by uid: the user object's identity changes on
  // renders that change nothing about who is signed in, and an effect keyed
  // by it would read every recording again on each one.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? ''
  const ids = useMemo(() => normalizeCrmActivityMediaIds(mediaIds), [mediaIds])
  const key = ids.join('\n')
  const [rows, setRows] = useState<ActivityRecording[] | null>(null)

  useEffect(() => {
    if (!enabled || !orgId) return undefined
    const wanted = key ? key.split('\n') : []
    if (!wanted.length) {
      setRows((current) => (current && current.length === 0 ? current : []))
      return undefined
    }
    let live = true
    void Promise.all(
      wanted.map(async (mediaId): Promise<ActivityRecording> => {
        try {
          const snapshot = await getDoc(doc(firestore, 'orgs', orgId, 'media', mediaId))
          if (!snapshot.exists()) {
            return { mediaId, fileName: '', contentType: '', isPrivate: false, missing: true }
          }
          const data = (snapshot.data() ?? {}) as Record<string, unknown>
          const isPrivate = data['private'] === true
          const signer = userRef.current
          const src = isPrivate
            ? signer
              ? await signPrivateMedia(signer, orgId, mediaId)
              : undefined
            : resolveMediaSrc(formatMediaRef(`org:${orgId}`, mediaId) ?? undefined)
          return {
            mediaId,
            fileName: String(data['fileName'] ?? ''),
            contentType: String(data['contentType'] ?? ''),
            isPrivate,
            src,
            missing: !src,
          }
        } catch {
          return { mediaId, fileName: '', contentType: '', isPrivate: false, missing: true }
        }
      }),
    ).then((resolved) => {
      if (live) setRows(resolved)
    })
    return () => {
      live = false
    }
  }, [firestore, orgId, key, enabled, uid])

  return rows
}

/**
 * One recording: the browser's own audio controls (play, pause, scrub,
 * volume), a speed menu, and a download.
 */
export function ActivityRecordingPlayer(props: { recording: ActivityRecording }) {
  const { recording } = props
  const audio = useRef<HTMLAudioElement | null>(null)
  const [speed, setSpeed] = useState<number>(1)
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed])
  const name = recording.fileName || recording.mediaId
  if (recording.missing || !recording.src) {
    return (
      <Typography variant="caption" color="text.secondary" data-testid="activity-recording-missing">
        {`${name}: this recording is no longer in the library, or you cannot play it.`}
      </Typography>
    )
  }
  return (
    <Stack spacing={0.5} data-testid="activity-recording">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <MdiIcon path={mdiFileMusicOutline.path} size={0.8} sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {name}
        </Typography>
        <TextField
          select
          size="small"
          label="Speed"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value) || 1)}
          sx={{ width: 96 }}
          slotProps={{ htmlInput: { 'aria-label': `Playback speed for ${name}` } }}
        >
          {SPEEDS.map((value) => (
            <MenuItem key={value} value={value}>
              {`${value}×`}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="Download">
          <IconButton
            size="small"
            component="a"
            href={recording.src}
            download={recording.fileName || true}
            aria-label={`Download ${name}`}
          >
            <MdiIcon path={mdiTrayArrowDown.path} size={0.8} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        component="audio"
        ref={audio}
        controls
        preload="metadata"
        src={recording.src}
        onLoadedMetadata={() => {
          if (audio.current) audio.current.playbackRate = speed
        }}
        sx={{ width: '100%' }}
      />
    </Stack>
  )
}
ActivityRecordingPlayer.displayName = 'ActivityRecordingPlayer'

/** An activity's transcript, closed until asked for: a 25-minute call is pages of text. */
export function ActivityTranscript(props: { transcript: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Stack spacing={0.5}>
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        startIcon={<MdiIcon path={mdiTextBoxOutline.path} size={0.8} />}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide transcript' : 'Show transcript'}
      </Button>
      {open ? (
        <Typography
          variant="body2"
          data-testid="activity-transcript"
          sx={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 360,
            overflowY: 'auto',
            p: 1,
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          {props.transcript}
        </Typography>
      ) : null}
    </Stack>
  )
}
ActivityTranscript.displayName = 'ActivityTranscript'

/** What an opened activity row shows under its body: the players and the transcript. */
export function ActivityRecordingsBlock(props: {
  firestore: Firestore
  orgId: string | null | undefined
  mediaIds: unknown
  transcript?: unknown
}) {
  const recordings = useActivityRecordings(props.firestore, props.orgId, props.mediaIds)
  const transcript = typeof props.transcript === 'string' ? props.transcript.trim() : ''
  const hasIds = normalizeCrmActivityMediaIds(props.mediaIds).length > 0
  if (!hasIds && !transcript) return null
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {hasIds && recordings === null ? (
        <Typography variant="caption" color="text.secondary">
          {'Reading the recording…'}
        </Typography>
      ) : null}
      {(recordings ?? []).map((recording) => (
        <ActivityRecordingPlayer key={recording.mediaId} recording={recording} />
      ))}
      {transcript ? <ActivityTranscript transcript={transcript} /> : null}
    </Stack>
  )
}
ActivityRecordingsBlock.displayName = 'ActivityRecordingsBlock'

/** A `.txt` read as text, refused when it is not plain text. */
export async function readTranscriptFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (!(file.type === 'text/plain' || name.endsWith('.txt'))) {
    throw new MediaUploadError('A transcript is a plain-text (.txt) file.')
  }
  return (await file.text()).slice(0, CRM_ACTIVITY_TRANSCRIPT_MAX)
}

export interface ActivityRecordingFieldsProps {
  firestore: Firestore
  orgId: string | null | undefined
  mediaIds: readonly string[]
  onMediaIdsChange: (next: string[]) => void
  transcript: string
  onTranscriptChange: (next: string) => void
  disabled?: boolean
  /** Tells the dialog an upload is running, so it does not save half a recording. */
  onBusyChange?: (busy: boolean) => void
}

/**
 * The Recording section of the log-activity dialog: upload a recording
 * (pick or drop), or choose one already in the library; and a transcript,
 * typed, pasted, or loaded from a `.txt`.
 *
 * An upload asks its uploader to confirm {@link CALL_RECORDING_CONSENT_STATEMENT}
 * first, and the server refuses audio without the answer; the answer is
 * stored on the file with who gave it and when. The file goes to the
 * organization's library, private, in CRM / Calls.
 */
export function ActivityRecordingFields(props: ActivityRecordingFieldsProps) {
  const {
    firestore,
    orgId,
    mediaIds,
    onMediaIdsChange,
    transcript,
    onTranscriptChange,
    disabled,
    onBusyChange,
  } = props
  const { pickMedia, uploadMedia } = useMediaPicker()
  const [consent, setConsent] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const transcriptInput = useRef<HTMLInputElement | null>(null)
  const recordings = useActivityRecordings(firestore, orgId, mediaIds)
  const full = mediaIds.length >= CRM_ACTIVITY_MEDIA_IDS_MAX

  useEffect(() => {
    onBusyChange?.(uploading !== null)
  }, [uploading, onBusyChange])

  const add = useCallback(
    (mediaId: string) => {
      if (mediaIds.includes(mediaId)) return
      onMediaIdsChange(normalizeCrmActivityMediaIds([...mediaIds, mediaId]))
    },
    [mediaIds, onMediaIdsChange],
  )

  const upload = useCallback(
    async (file: File | undefined) => {
      if (!file || !uploadMedia || disabled || uploading) return
      setError(null)
      if (full) {
        setError(`An activity holds at most ${CRM_ACTIVITY_MEDIA_IDS_MAX} recordings.`)
        return
      }
      if (!consent) {
        setError('Confirm that everyone on the call knew it was being recorded first.')
        return
      }
      setUploading(file.name)
      try {
        const picked = await uploadMedia(file, {
          folderPath: CRM_CALL_RECORDINGS_FOLDER_PATH,
          private: true,
          purpose: 'callRecording',
          confirmed: true,
          kind: 'audio',
        })
        if (picked.mediaId) add(picked.mediaId)
      } catch (caught) {
        setError(
          caught instanceof MediaUploadError
            ? caught.message
            : `Upload failed for "${file.name}" — try again.`,
        )
      } finally {
        setUploading(null)
      }
    },
    [uploadMedia, disabled, uploading, full, consent, add],
  )

  const choose = useCallback(async () => {
    if (!pickMedia || disabled) return
    setError(null)
    const picked = await pickMedia({ kind: 'audio', allowPrivate: true })
    if (!picked?.mediaId) return
    if (full) {
      setError(`An activity holds at most ${CRM_ACTIVITY_MEDIA_IDS_MAX} recordings.`)
      return
    }
    add(picked.mediaId)
  }, [pickMedia, disabled, full, add])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      void upload(event.dataTransfer.files?.[0])
    },
    [upload],
  )

  const loadTranscript = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)
      try {
        onTranscriptChange(await readTranscriptFile(file))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The transcript could not be read.')
      }
    },
    [onTranscriptChange],
  )

  const names = new Map((recordings ?? []).map((row) => [row.mediaId, row.fileName]))

  return (
    <Stack spacing={1} data-testid="activity-recording-fields">
      <Typography variant="subtitle2">{'Recording'}</Typography>
      {mediaIds.map((mediaId) => (
        <Stack key={mediaId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <MdiIcon path={mdiFileMusicOutline.path} size={0.8} sx={{ color: 'text.secondary' }} />
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {names.get(mediaId) || mediaId}
          </Typography>
          <IconButton
            size="small"
            aria-label={`Remove ${names.get(mediaId) || 'recording'}`}
            disabled={disabled || uploading !== null}
            onClick={() => onMediaIdsChange(mediaIds.filter((id) => id !== mediaId))}
          >
            <MdiIcon path={mdiClose.path} size={0.8} />
          </IconButton>
        </Stack>
      ))}
      {full ? null : (
        <Box
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="activity-recording-drop"
          sx={{
            border: 1,
            borderStyle: 'dashed',
            borderColor: dragging ? 'primary.main' : 'divider',
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={disabled}
                />
              }
              label={<Typography variant="body2">{CALL_RECORDING_CONSENT_STATEMENT}</Typography>}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MdiIcon path={mdiTrayArrowUp.path} size={0.8} />}
                disabled={!uploadMedia || disabled || uploading !== null}
                onClick={() => fileInput.current?.click()}
              >
                {'Upload recording'}
              </Button>
              <Button
                size="small"
                startIcon={<MdiIcon path={mdiFolderMusicOutline.path} size={0.8} />}
                disabled={!pickMedia || disabled || uploading !== null}
                onClick={() => void choose()}
              >
                {'Choose from library'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {'Drop an MP3, M4A, WAV, AAC or OGG file here, up to 50 MB. It is kept private in your media library, under CRM / Calls.'}
            </Typography>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg"
              data-testid="activity-recording-input"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void upload(file)
              }}
            />
          </Stack>
        </Box>
      )}
      {uploading ? (
        <Stack spacing={0.5}>
          <Typography variant="caption">{`Uploading "${uploading}"…`}</Typography>
          <LinearProgress />
        </Stack>
      ) : null}
      {!uploadMedia ? (
        <Alert severity="info">{'Uploading is not available on this surface.'}</Alert>
      ) : null}
      {error ? <Alert severity="warning">{error}</Alert> : null}
      <TextField
        size="small"
        label="Transcript"
        placeholder="Paste what was said, or load a .txt"
        value={transcript}
        onChange={(event) => onTranscriptChange(event.target.value)}
        multiline
        minRows={2}
        maxRows={10}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: CRM_ACTIVITY_TRANSCRIPT_MAX } }}
      />
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<MdiIcon path={mdiTextBoxOutline.path} size={0.8} />}
          disabled={disabled}
          onClick={() => transcriptInput.current?.click()}
        >
          {'Load transcript (.txt)'}
        </Button>
        <input
          ref={transcriptInput}
          type="file"
          hidden
          accept=".txt,text/plain"
          data-testid="activity-transcript-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void loadTranscript(file)
          }}
        />
      </Stack>
    </Stack>
  )
}
ActivityRecordingFields.displayName = 'ActivityRecordingFields'
