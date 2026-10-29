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

import * as Aglyn from '@aglyn/aglyn'
import { formFileFieldLimits } from '@aglyn/aglyn/app-utils/forms'
import {
  checkVisitorUploadSelection,
  describeVisitorUploadTypes,
  formatVisitorUploadBytes,
  visitorUploadAccept,
  VISITOR_UPLOAD_MAX_BYTES,
  type VisitorUploadFileView,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import { sendVisitorUpload } from '@aglyn/aglyn/app-utils/visitor-upload-client'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { FORM_FILE_INPUT, formFileInputValue } from '../model/form-request'
import type { FormFileUploadProps } from './form-file-upload'
import { FormUploadContext } from './form-upload-context'

/** One file in the field: on its way, kept, or refused. */
interface PickedFile {
  key: string
  name: string
  size: number
  state: 'sending' | 'kept' | 'refused'
  error?: string
  file?: VisitorUploadFileView
}

const STILL_SENDING = 'Wait for your files to finish uploading.'

let sequence = 0

/**
 * The File upload field's body (AGL-4098): a button that picks files, each
 * file's progress while it goes up, Remove, and what the form sends — a
 * hidden `field:id` per kept file and, under the field's name, their names.
 * The names' input is a real one, invisible under the button, so a required
 * field with nothing attached stops the form like any required field, and a
 * field still uploading stops it with a sentence that says to wait.
 *
 * The upload itself is the shared visitor upload: a ticket from
 * `/api/forms/upload`, the bytes posted straight to storage, then the route
 * checks and keeps them. A browser cannot report the progress of a post to
 * another site's storage, so a file shows that it is on its way, then kept.
 */
const FormFileUploadBody = forwardRef<HTMLDivElement, FormFileUploadProps>((props, ref) => {
  const { name: rawName, label, helperText, required, kinds: rawKinds, maxFiles: rawMax, ...rest } = props
  const name = String(rawName ?? '').trim() || 'files'
  const { fileKinds, maxFiles } = formFileFieldLimits({ kinds: rawKinds, maxFiles: rawMax })
  const upload = useContext(FormUploadContext)
  const { hostId } = Aglyn.useSite()
  const siteFetch = Aglyn.useSiteFetch()
  const inputId = useId()
  const pickerRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<PickedFile[]>([])
  const [notice, setNotice] = useState('')

  const kept = picked.filter((entry) => entry.state === 'kept' && entry.file)
  const sending = picked.some((entry) => entry.state === 'sending')
  const answer = kept.map((entry) => entry.file?.name ?? entry.name).join(', ')
  const live = Boolean(upload?.live && upload.formId && hostId)

  // A field still uploading holds the form back, in the browser's own words.
  useEffect(() => {
    answerRef.current?.setCustomValidity(sending ? STILL_SENDING : '')
  }, [sending])

  // Every change is announced, as a typed answer is, to anything listening on the form.
  const announced = useRef(answer)
  useEffect(() => {
    if (announced.current === answer) return
    announced.current = answer
    answerRef.current?.dispatchEvent(new Event('change', { bubbles: true }))
  }, [answer])

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, any>> => {
      const response = await siteFetch('/api/forms/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, formId: upload?.formId, key: upload?.uploadKey(), field: name, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return { error: typeof payload?.error === 'string' ? payload.error : 'The file could not be sent. Try again.' }
      }
      return payload
    },
    [siteFetch, hostId, upload, name],
  )

  const sendOne = useCallback(
    async (key: string, file: File) => {
      const outcome = await sendVisitorUpload({
        file,
        requestTicket: (request) => post({ action: 'ticket', file: request }) as never,
        finalize: (ticket) => post({ action: 'finalize', ticket }) as never,
      })
      setPicked((current) =>
        current.map((entry) =>
          entry.key !== key
            ? entry
            : 'error' in outcome
              ? { ...entry, state: 'refused', error: outcome.error }
              : { ...entry, state: 'kept', file: outcome.file },
        ),
      )
    },
    [post],
  )

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!files.length) return
      const refused = checkVisitorUploadSelection(
        files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
        picked.filter((entry) => entry.state !== 'refused').length,
        maxFiles,
        fileKinds,
      )
      if (refused) return void setNotice(refused)
      setNotice('')
      const added = files.map((file) => ({ key: `file-${++sequence}`, name: file.name, size: file.size, state: 'sending' as const }))
      setPicked((current) => [...current.filter((entry) => entry.state !== 'refused'), ...added])
      added.forEach((entry, index) => void sendOne(entry.key, files[index]))
    },
    [picked, maxFiles, fileKinds, sendOne],
  )

  const onRemove = useCallback(
    (entry: PickedFile) => {
      setPicked((current) => current.filter((one) => one.key !== entry.key))
      if (entry.file) void post({ action: 'remove', fileId: entry.file.id }).catch(() => undefined)
    },
    [post],
  )

  const hint = useMemo(() => {
    const count = maxFiles === 1 ? 'One file' : `Up to ${maxFiles} files`
    return `${count}: ${describeVisitorUploadTypes(fileKinds)}, up to ${formatVisitorUploadBytes(VISITOR_UPLOAD_MAX_BYTES)} each.`
  }, [maxFiles, fileKinds])
  const full = picked.filter((entry) => entry.state !== 'refused').length >= maxFiles

  return (
    <FormControl ref={ref} fullWidth required={Boolean(required)} {...rest}>
      <FormLabel htmlFor={inputId}>{label || 'Files'}</FormLabel>
      {helperText ? <FormHelperText sx={{ mx: 0 }}>{helperText}</FormHelperText> : null}
      <Box sx={{ position: 'relative', mt: 1 }}>
        <Button
          variant="outlined"
          disabled={!live || full}
          onClick={() => pickerRef.current?.click()}
          aria-describedby={`${inputId}-hint`}
        >
          {picked.length ? 'Attach more files' : maxFiles === 1 ? 'Attach a file' : 'Attach files'}
        </Button>
        <input
          ref={pickerRef}
          id={inputId}
          type="file"
          hidden
          multiple={maxFiles > 1}
          accept={visitorUploadAccept(fileKinds)}
          onChange={onPick}
        />
        {/* The answer the form sends and the browser checks: the files' names. */}
        <Box
          component="input"
          ref={answerRef}
          type="text"
          name={name}
          value={answer}
          required={Boolean(required)}
          onChange={() => undefined}
          onInvalid={() => pickerRef.current?.focus()}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          sx={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: '1px', p: 0, border: 0, opacity: 0, pointerEvents: 'none' }}
        />
      </Box>
      <FormHelperText id={`${inputId}-hint`} sx={{ mx: 0 }}>
        {live ? hint : 'Files can be attached on the published site.'}
      </FormHelperText>
      {notice ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {notice}
        </Alert>
      ) : null}
      {picked.length ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {picked.map((entry) => (
            <Paper key={entry.key} variant="outlined" sx={{ p: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap title={entry.name}>
                    {entry.file?.name ?? entry.name}
                  </Typography>
                  <Typography variant="caption" color={entry.state === 'refused' ? 'error' : 'text.secondary'}>
                    {entry.state === 'sending'
                      ? `Uploading · ${formatVisitorUploadBytes(entry.size)}`
                      : entry.state === 'refused'
                        ? entry.error
                        : formatVisitorUploadBytes(entry.file?.size ?? entry.size)}
                  </Typography>
                  {entry.state === 'sending' ? (
                    <LinearProgress sx={{ mt: 0.5 }} aria-label={`Uploading ${entry.name}`} />
                  ) : null}
                </Box>
                <Button
                  size="small"
                  color="inherit"
                  disabled={entry.state === 'sending'}
                  onClick={() => onRemove(entry)}
                  aria-label={`Remove ${entry.name}`}
                >
                  {'Remove'}
                </Button>
              </Stack>
              {entry.file ? (
                <input type="hidden" name={FORM_FILE_INPUT} value={formFileInputValue(name, entry.file.id)} readOnly />
              ) : null}
            </Paper>
          ))}
        </Stack>
      ) : null}
    </FormControl>
  )
})
FormFileUploadBody.displayName = 'AglynFormFileUploadBody'

export default FormFileUploadBody
