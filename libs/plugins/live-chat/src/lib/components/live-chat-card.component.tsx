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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LIVE_CHAT_MAX_PATHS } from '../constants'
import {
  LIVE_CHAT_PROVIDER_ORDER,
  LIVE_CHAT_PROVIDERS,
  type LiveChatProviderId,
} from '../model/providers'
import {
  normalizeLiveChatSettings,
  type LiveChatPages,
  type LiveChatPosition,
  type LiveChatSettings,
} from '../model/settings'
import { useLiveChatApi, type LiveChatApi } from './live-chat-api'

/** What the `hostSettings` zone hands a widget. */
export interface LiveChatCardProps {
  hostId: string
  /** Test seam: the API; the route by default. */
  api?: LiveChatApi
}

interface Draft extends Omit<LiveChatSettings, 'paths'> {
  /** The page list as typed: one address per line. */
  pathsText: string
}

const toDraft = (settings: LiveChatSettings): Draft => {
  const { paths, ...rest } = settings
  return { ...rest, pathsText: paths.join('\n') }
}

const fromDraft = (draft: Draft): LiveChatSettings => {
  const { pathsText, ...rest } = draft
  return {
    ...rest,
    paths: pathsText
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  }
}

/**
 * LIVE CHAT (AGL-3698): the merchant's own Tidio or LiveChat account on this
 * site's pages. The merchant brings the public identifier their vendor's
 * install code carries; the card checks it, picks the pages, and saves
 * through the plugin's route, which refreshes the live pages. Only a site
 * admin changes it; every member can see how it is set.
 */
export function LiveChatCard(props: LiveChatCardProps) {
  const routeApi = useLiveChatApi(props.hostId)
  const api = props.api ?? routeApi
  const { enqueueSnackbar } = useSnackbar()
  const [canManage, setCanManage] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<LiveChatSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    api
      .read()
      .then((state) => {
        if (!live) return
        setSaved(state.settings)
        setDraft(toDraft(state.settings))
        setCanManage(state.canManage)
      })
      .catch((cause: Error) => live && setError(cause.message))
      .finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [api])

  const patch = useCallback((change: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...change } : current))
  }, [])

  const dirty = useMemo(
    () => Boolean(draft && saved && JSON.stringify(fromDraft(draft)) !== JSON.stringify(saved)),
    [draft, saved],
  )

  const save = useCallback(async () => {
    if (!draft) return
    const checked = normalizeLiveChatSettings(fromDraft(draft))
    if ('error' in checked) {
      setError(checked.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const answer = await api.save(checked.settings)
      setSaved(answer.settings)
      setDraft(toDraft(answer.settings))
      enqueueSnackbar(
        answer.refreshed
          ? 'Saved. Your live pages are updated.'
          : 'Saved. Your live pages update within the hour.',
        { variant: 'success', persist: false },
      )
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }, [api, draft, enqueueSnackbar])

  if (!loaded) return null
  if (!draft) {
    return error ? <Alert severity="error">{error}</Alert> : null
  }
  const provider = LIVE_CHAT_PROVIDERS[draft.provider]
  const disabled = !canManage || saving

  return (
    <CardDisplay
      variant="outlined"
      header="Live chat"
      help={pluginDocsHelp('liveChat', {
        anchor: '#set-up-live-chat',
        excerpt:
          'Your own Tidio or LiveChat account on this site: the key from its install code, the pages it shows on, and how it loads.',
      })}
      subheader="Chat with visitors through your own Tidio or LiveChat account."
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: canManage ? (
          <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </Button>
        ) : undefined,
      }}
    >
      <Stack spacing={2}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {!canManage ? (
          <Alert severity="info">Live chat is set up by a site admin.</Alert>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={draft.enabled}
              disabled={disabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
          }
          label="Show the chat on this site"
        />
        <TextField
          select
          label="Chat service"
          value={draft.provider}
          disabled={disabled}
          onChange={(event) => patch({ provider: event.target.value as LiveChatProviderId, publicKey: '' })}
        >
          {LIVE_CHAT_PROVIDER_ORDER.map((id) => (
            <MenuItem key={id} value={id}>
              {LIVE_CHAT_PROVIDERS[id].label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={provider.keyLabel}
          value={draft.publicKey}
          disabled={disabled}
          onChange={(event) => patch({ publicKey: event.target.value })}
          helperText={provider.keyHelp}
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false, maxLength: 4000 } }}
        />
        <FormControl disabled={disabled}>
          <FormLabel id="live-chat-pages">Pages</FormLabel>
          <RadioGroup
            aria-labelledby="live-chat-pages"
            value={draft.pages}
            onChange={(event) => patch({ pages: event.target.value as LiveChatPages })}
          >
            <FormControlLabel value="all" control={<Radio />} label="Every page" />
            <FormControlLabel value="only" control={<Radio />} label="Only these pages" />
            <FormControlLabel value="except" control={<Radio />} label="Every page except these" />
          </RadioGroup>
        </FormControl>
        {draft.pages !== 'all' ? (
          <TextField
            label="Page addresses"
            value={draft.pathsText}
            disabled={disabled}
            onChange={(event) => patch({ pathsText: event.target.value })}
            multiline
            minRows={3}
            helperText={`One per line, such as /contact. End with /* for a whole section, such as /shop/*. Up to ${LIVE_CHAT_MAX_PATHS}.`}
          />
        ) : null}
        <FormControl disabled={disabled}>
          <FormLabel id="live-chat-position">Chat button</FormLabel>
          <RadioGroup
            row
            aria-labelledby="live-chat-position"
            value={draft.position}
            onChange={(event) => patch({ position: event.target.value as LiveChatPosition })}
          >
            <FormControlLabel value="right" control={<Radio />} label="Bottom right" />
            <FormControlLabel value="left" control={<Radio />} label="Bottom left" />
          </RadioGroup>
          <FormHelperText>{`Match the side you chose in ${provider.label}.`}</FormHelperText>
        </FormControl>
        <FormControl disabled={disabled}>
          <FormControlLabel
            control={
              <Switch
                checked={draft.loadWithPage}
                onChange={(event) => patch({ loadWithPage: event.target.checked })}
              />
            }
            label="Load the chat with the page"
          />
          <FormHelperText>
            {`Off, ${provider.label} loads only when a visitor presses the chat button, so it never slows your pages. On, it also loads once the page has finished loading, for visitors who allowed analytics, so ${provider.label}'s own greetings and visitor list work before anyone presses it.`}
          </FormHelperText>
        </FormControl>
      </Stack>
    </CardDisplay>
  )
}

export default LiveChatCard
