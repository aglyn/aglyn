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
import type { SiteChatCapability } from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  normalizeSiteChatSettings,
  SITE_CHAT_CHIPS_MAX,
  SITE_CHAT_MAX_PATHS,
  type SiteChatConversationSummary,
  type SiteChatSettings,
  type SiteChatSettingsAnswer,
} from '../model/site-chat'
import { useSiteChatApi, type SiteChatApi, type SiteChatConversation } from './site-chat-api'

export interface SiteChatCardProps {
  hostId: string
  /** Test seam: the API; the routes by default. */
  api?: SiteChatApi
}

interface Draft extends Omit<SiteChatSettings, 'paths' | 'chips' | 'monthlyCreditCap'> {
  pathsText: string
  chipsText: string
  capText: string
}

const toDraft = (settings: SiteChatSettings): Draft => {
  const { paths, chips, monthlyCreditCap, ...rest } = settings
  return {
    ...rest,
    pathsText: paths.join('\n'),
    chipsText: chips.join('\n'),
    capText: monthlyCreditCap === null ? '' : String(monthlyCreditCap),
  }
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)

const fromDraft = (draft: Draft): SiteChatSettings => {
  const { pathsText, chipsText, capText, ...rest } = draft
  return {
    ...rest,
    paths: lines(pathsText),
    chips: lines(chipsText),
    monthlyCreditCap: capText.trim() === '' ? null : Number(capText),
  }
}

const when = (ms: number) => (ms ? new Date(ms).toLocaleString() : '')

function ConversationsDialog({ api, open, onClose }: { api: SiteChatApi; open: boolean; onClose: () => void }) {
  const [list, setList] = useState<SiteChatConversationSummary[] | null>(null)
  const [chosen, setChosen] = useState<SiteChatConversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setChosen(null)
    api
      .conversations()
      .then(setList)
      .catch((cause: Error) => setError(cause.message))
  }, [api, open])
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{chosen ? 'Conversation' : 'Conversations'}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {chosen ? (
          <Stack spacing={1.5}>
            {chosen.handOff?.email ? (
              <Alert severity="info">
                {`Wants a reply: ${chosen.handOff.email}. “${chosen.handOff.question ?? ''}”`}
              </Alert>
            ) : null}
            {chosen.turns.map((turn, index) => (
              <Stack key={index} spacing={0.25}>
                <Typography variant="caption" color="text.secondary">
                  {`${turn.role === 'visitor' ? 'Visitor' : 'AI chat'} · ${when(turn.at)}`}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                  {turn.text}
                </Typography>
                {turn.proposal ? (
                  <Typography variant="caption" color="text.secondary">{`Offered: ${turn.proposal.title}`}</Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        ) : list === null ? null : list.length ? (
          <List dense disablePadding>
            {list.map((conversation) => (
              <ListItemButton
                key={conversation.id}
                onClick={() =>
                  api
                    .conversation(conversation.id)
                    .then(setChosen)
                    .catch((cause: Error) => setError(cause.message))
                }
              >
                <ListItemText
                  primary={conversation.firstQuestion || 'A conversation'}
                  secondary={[
                    when(conversation.updatedAt),
                    `${conversation.turns} ${conversation.turns === 1 ? 'question' : 'questions'}`,
                    conversation.member?.name ? `Member: ${conversation.member.name}` : '',
                    conversation.handedOff ? 'Wants a reply' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No conversations yet.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {chosen ? <Button onClick={() => setChosen(null)}>Back</Button> : null}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * AI CHAT (AGL-4250): Aglyn AI answering visitors on this site's own pages.
 * The owner turns it on, writes its greeting, suggested questions and
 * opening message, chooses what it may do and where it shows, and may cap
 * what it spends; the card shows this month's figures and the visitors'
 * conversations. Only a site admin changes it; every member can read it.
 */
export function SiteChatCard(props: SiteChatCardProps) {
  const routeApi = useSiteChatApi(props.hostId)
  const api = props.api ?? routeApi
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<SiteChatSettingsAnswer | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [conversationsOpen, setConversationsOpen] = useState(false)

  useEffect(() => {
    let live = true
    api
      .read()
      .then((answer) => {
        if (!live || !answer) return
        setState(answer)
        setDraft(toDraft(answer.settings))
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
    () => Boolean(draft && state && JSON.stringify(fromDraft(draft)) !== JSON.stringify(state.settings)),
    [draft, state],
  )

  const save = useCallback(async () => {
    if (!draft) return
    const checked = normalizeSiteChatSettings(fromDraft(draft))
    if ('error' in checked) {
      setError(checked.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const answer = await api.save(checked.settings)
      setState((current) => (current ? { ...current, settings: answer.settings } : current))
      setDraft(toDraft(answer.settings))
      enqueueSnackbar(
        answer.refreshed ? 'Saved. Your live pages are updated.' : 'Saved. Your live pages update within the hour.',
        { variant: 'success', persist: false },
      )
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }, [api, draft, enqueueSnackbar])

  // A workspace the feature is not released to sees nothing (the route 404s).
  if (!loaded || (!state && !error)) return null
  if (!state || !draft) return error ? <Alert severity="error">{error}</Alert> : null
  const disabled = !state.canManage || saving
  const toggleCapability = (capability: SiteChatCapability, on: boolean) =>
    patch({
      capabilities: on
        ? [...new Set([...draft.capabilities, capability])]
        : draft.capabilities.filter((entry) => entry !== capability),
    })
  const month = state.month
  return (
    <CardDisplay
      variant="outlined"
      header="AI chat"
      help={pluginDocsHelp('aiSiteChat', {
        anchor: '#set-up-the-chat',
        excerpt: 'An AI chat answering your visitors from your own pages and products, with cards they confirm.',
      })}
      subheader="Answer visitors from your own pages, products and listings."
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => setConversationsOpen(true)}>
              Conversations
            </Button>
            {state.canManage ? (
              <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void save()}>
                Save
              </Button>
            ) : null}
          </Stack>
        ),
      }}
    >
      <Stack spacing={2}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {!state.onPlan ? (
          <Alert severity="info">The AI chat is included from the Starter plan up.</Alert>
        ) : null}
        {!state.canManage ? (
          <Alert severity="info">
            Setting up the AI chat takes the "Manage site settings" permission, which site admins hold by default.
          </Alert>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={draft.enabled}
              disabled={disabled || !state.onPlan}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
          }
          label="Show the AI chat on this site"
        />
        <TextField
          label="Greeting"
          value={draft.greeting}
          disabled={disabled}
          onChange={(event) => patch({ greeting: event.target.value })}
          helperText="The first line a visitor sees when they open the chat."
        />
        <TextField
          label="Suggested questions"
          value={draft.chipsText}
          disabled={disabled}
          onChange={(event) => patch({ chipsText: event.target.value })}
          multiline
          minRows={2}
          helperText={`One per line, up to ${SITE_CHAT_CHIPS_MAX}, such as “What are your hours?”`}
        />
        <TextField
          label="Opening message"
          value={draft.openingMessage}
          disabled={disabled}
          onChange={(event) => patch({ openingMessage: event.target.value })}
          multiline
          minRows={2}
          helperText="Optional. Shown beside the chat button once per visitor, a few seconds after they arrive."
        />
        <FormControl disabled={disabled} component="fieldset">
          <FormLabel component="legend">What the chat may do</FormLabel>
          <FormGroup>
            <FormControlLabel control={<Checkbox checked disabled />} label="Answer questions" />
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.capabilities.includes('cart')}
                  onChange={(event) => toggleCapability('cart', event.target.checked)}
                />
              }
              label="Offer products to add to the cart"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.capabilities.includes('book')}
                  onChange={(event) => toggleCapability('book', event.target.checked)}
                />
              }
              label="Offer booking times and check dates for stays"
            />
          </FormGroup>
          <FormHelperText>The visitor always confirms with their own press. The chat never pays or books by itself.</FormHelperText>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              checked={draft.handOff}
              disabled={disabled}
              onChange={(event) => patch({ handOff: event.target.checked })}
            />
          }
          label="Offer to pass a visitor to your team when the chat cannot help"
        />
        <FormControl disabled={disabled}>
          <FormLabel id="site-chat-pages">Pages</FormLabel>
          <RadioGroup
            aria-labelledby="site-chat-pages"
            value={draft.pages}
            onChange={(event) => patch({ pages: event.target.value as Draft['pages'] })}
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
            helperText={`One per line, such as /contact. End with /* for a whole section, such as /shop/*. Up to ${SITE_CHAT_MAX_PATHS}.`}
          />
        ) : null}
        <FormControl disabled={disabled}>
          <FormLabel id="site-chat-position">Chat button</FormLabel>
          <RadioGroup
            row
            aria-labelledby="site-chat-position"
            value={draft.position}
            onChange={(event) => patch({ position: event.target.value as Draft['position'] })}
          >
            <FormControlLabel value="right" control={<Radio />} label="Bottom right" />
            <FormControlLabel value="left" control={<Radio />} label="Bottom left" />
          </RadioGroup>
        </FormControl>
        <TextField
          label="Monthly cap (credits)"
          value={draft.capText}
          disabled={disabled}
          onChange={(event) => patch({ capText: event.target.value.replace(/[^\d]/g, '') })}
          helperText={`Leave empty for your plan's site-chat allotment, ${state.planCredits.toLocaleString()} credits a month.`}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
        />
        {month ? (
          <Typography variant="body2" color="text.secondary">
            {`This month: ${month.questions.toLocaleString()} questions in ${month.conversations.toLocaleString()} conversations, ${month.proposals.toLocaleString()} cards offered to add or book, ${month.credits.toLocaleString()} of ${state.ceiling.toLocaleString()} credits used.`}
          </Typography>
        ) : null}
      </Stack>
      <ConversationsDialog api={api} open={conversationsOpen} onClose={() => setConversationsOpen(false)} />
    </CardDisplay>
  )
}

export default SiteChatCard
