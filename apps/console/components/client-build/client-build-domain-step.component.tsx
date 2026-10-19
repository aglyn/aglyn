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
  domainPriceText,
  normalizeClientBuildDomainName,
  type ClientBuildDomain,
} from '@aglyn/aglyn/app-utils/client-build'
import type { PluginDomainSearchResult } from '@aglyn/aglyn/plugin-manager/plugin-domain-search'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'

/** How long typing must pause before a search is asked (the route also throttles). */
export const DOMAIN_SEARCH_DELAY_MS = 500

/** The shortest query searched. */
const QUERY_MIN = 2

type Mode = ClientBuildDomain['choice']

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; results: PluginDomainSearchResult[] }
  | { status: 'error'; message: string }

export interface ClientBuildDomainStepProps {
  orgId: string
  /** Whether a domain search is offered in this deployment. */
  searchable: boolean
  /** What the step was last answered with, to open on. */
  value: ClientBuildDomain | null
  /** A first query: the business name, which is usually where a search starts. */
  suggestedQuery: string
  busy?: boolean
  onContinue: (domain: ClientBuildDomain) => void
  onBack: () => void
}

/**
 * The Domain step of a client build (Zach, 2026-10-19).
 *
 * Search as you type, with each name's first-year and renewal price side by
 * side; or keep the free address for now; or record a domain the owner
 * already has. A pick is NOT bought here: it rides the bundle link, so the
 * owner buys it on their own phone after subscribing, with their own
 * registrant details and their own tick on the terms.
 *
 * The search is offered only when a provider is registered
 * (`core.domain-search`); without one the step offers the other two.
 */
export function ClientBuildDomainStep(props: ClientBuildDomainStepProps) {
  const {
    orgId,
    searchable,
    value,
    suggestedQuery,
    busy = false,
    onContinue,
    onBack,
  } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [mode, setMode] = useState<Mode>(value?.choice ?? 'free')
  const [query, setQuery] = useState(() =>
    value?.choice === 'register' ? value.name : slugQuery(suggestedQuery),
  )
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [picked, setPicked] = useState<PluginDomainSearchResult | null>(() =>
    value?.choice === 'register'
      ? {
          name: value.name,
          available: true,
          firstYearUsd: value.firstYearUsd,
          renewalUsd: value.renewalUsd,
        }
      : null,
  )
  const [own, setOwn] = useState(value?.choice === 'own' ? value.name : '')
  const [ownTouched, setOwnTouched] = useState(false)
  // A provider that answered "not set up here" takes the search away.
  const [searchGone, setSearchGone] = useState(false)
  const canSearch = searchable && !searchGone

  useEffect(() => {
    if (mode !== 'register' || !canSearch) return
    const trimmed = query.trim().toLowerCase()
    if (trimmed.length < QUERY_MIN) return void setSearch({ status: 'idle' })
    let active = true
    setSearch({ status: 'searching' })
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await authorizedFetch(
            userRef.current,
            '/api/admin/client-build',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orgId,
                action: 'search-domains',
                query: trimmed,
              }),
            },
          )
          const payload = (await response.json().catch(() => ({}))) as {
            results?: PluginDomainSearchResult[]
            error?: string
            unavailable?: boolean
          }
          if (!active) return
          if (payload.unavailable) {
            setSearchGone(true)
            setMode('free')
            return
          }
          if (!response.ok) {
            setSearch({
              status: 'error',
              message: payload.error ?? 'The search failed. Try again.',
            })
            return
          }
          setSearch({ status: 'done', results: payload.results ?? [] })
        } catch {
          if (active)
            setSearch({
              status: 'error',
              message: 'The search failed. Try again.',
            })
        }
      })()
    }, DOMAIN_SEARCH_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [mode, canSearch, query, orgId])

  const ownName = normalizeClientBuildDomainName(own)
  const ownError = ownTouched && !ownName
  const answer: ClientBuildDomain | null =
    mode === 'free'
      ? { choice: 'free' }
      : mode === 'own'
        ? ownName
          ? { choice: 'own', name: ownName }
          : null
        : picked
          ? {
              choice: 'register',
              name: picked.name,
              firstYearUsd: picked.firstYearUsd,
              renewalUsd: picked.renewalUsd,
            }
          : null

  return (
    <Stack spacing={2}>
      <RadioGroup
        value={mode}
        onChange={(event) => setMode(event.target.value as Mode)}
        aria-label="The website's domain"
      >
        <FormControlLabel
          value="free"
          control={<Radio />}
          label="Use the free address for now"
        />
        {canSearch ? (
          <FormControlLabel
            value="register"
            control={<Radio />}
            label="Find a domain to buy"
          />
        ) : null}
        <FormControlLabel
          value="own"
          control={<Radio />}
          label="They already have a domain"
        />
      </RadioGroup>

      {mode === 'free' ? (
        <Typography variant="body2" color="text.secondary">
          {
            'The site goes live on its free address. A domain can be added any time from Setup.'
          }
        </Typography>
      ) : null}

      {mode === 'register' && canSearch ? (
        <Stack spacing={1.5}>
          <TextField
            fullWidth
            label="Search for a domain"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            slotProps={{
              htmlInput: {
                autoCapitalize: 'none',
                spellCheck: false,
                inputMode: 'url',
              },
              input: {
                endAdornment:
                  search.status === 'searching' ? (
                    <InputAdornment position="end">
                      <CircularProgress size={18} aria-label="Searching…" />
                    </InputAdornment>
                  ) : undefined,
              },
            }}
          />
          {search.status === 'error' ? (
            <Alert severity="warning">{search.message}</Alert>
          ) : null}
          {search.status === 'done' && search.results.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No names found. Try another word.'}
            </Typography>
          ) : null}
          {search.status === 'done' && search.results.length > 0 ? (
            <List disablePadding aria-label="Domains found">
              {search.results.map((result) => {
                const chosen = picked?.name === result.name
                return (
                  <ListItem
                    key={result.name}
                    disableGutters
                    divider
                    secondaryAction={
                      result.available ? (
                        <Button
                          size="small"
                          variant={chosen ? 'contained' : 'outlined'}
                          onClick={() => setPicked(result)}
                          aria-pressed={chosen}
                          aria-label={`Pick ${result.name}`}
                        >
                          {chosen ? 'Picked' : 'Pick'}
                        </Button>
                      ) : (
                        <Chip size="small" label="Taken" />
                      )
                    }
                    sx={{ pr: 11 }}
                  >
                    <ListItemText
                      primary={result.name}
                      secondary={
                        result.available
                          ? domainPriceText(result)
                          : 'Not available'
                      }
                      slotProps={{
                        primary: { sx: { wordBreak: 'break-all' } },
                      }}
                    />
                  </ListItem>
                )
              })}
            </List>
          ) : null}
          {picked ? (
            <Alert severity="success">
              {`${picked.name}: ${domainPriceText(picked)}.`}
            </Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {'Nothing is bought here. The owner buys the domain on their own phone after they ' +
              'subscribe, from the hand-off link, with their own details.'}
          </Typography>
        </Stack>
      ) : null}

      {mode === 'own' ? (
        <Stack spacing={1.5}>
          <TextField
            fullWidth
            label="Their domain"
            placeholder="example.com"
            value={own}
            onChange={(event) => setOwn(event.target.value)}
            onBlur={() => setOwnTouched(true)}
            error={ownError}
            helperText={ownError ? 'Type a domain like example.com' : ' '}
            slotProps={{
              htmlInput: {
                autoCapitalize: 'none',
                spellCheck: false,
                inputMode: 'url',
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {"Connecting it needs the owner's login at their domain provider. Do it with them on " +
              'their phone, or give them the records from Setup → Domain.'}
          </Typography>
        </Stack>
      ) : null}

      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between' }}
      >
        <Button onClick={onBack} disabled={busy}>
          {'Back'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !answer}
          onClick={() => {
            setOwnTouched(true)
            if (answer) onContinue(answer)
          }}
        >
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </Stack>
    </Stack>
  )
}
ClientBuildDomainStep.displayName = 'ClientBuildDomainStep'

/** A business name as a first search: "Harbor Plumbing LLC" → "harborplumbing". */
function slugQuery(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|co|ltd)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40)
}

export default ClientBuildDomainStep
