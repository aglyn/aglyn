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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useFirestoreDocData } from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Za-z]{2,4})?$/

/**
 * Site languages (AGL-164): the locale list screens can be translated
 * into, plus the default. Screens link to their translations from the
 * screens list; the Language Switcher element renders the links.
 * Business tier (`multilingual` flag).
 */
export function LanguagesCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { tenant } = useCurrentTenant()
  const { data: host } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )
  const [locales, setLocales] = useState('')
  const [defaultLocale, setDefaultLocale] = useState('')
  useEffect(() => {
    setLocales((host?.locales ?? []).join(', '))
    setDefaultLocale(host?.defaultLocale ?? host?.locales?.[0] ?? '')
  }, [host?.locales, host?.defaultLocale])

  const parsed = [
    ...new Set(
      locales
        .split(',')
        .map((value) => value.trim())
        .filter((value) => LOCALE_PATTERN.test(value)),
    ),
  ]

  const handleSave = useCallback(async () => {
    if (!hasEntitlement('multilingual', tenant)) {
      return void enqueueSnackbar(
        'Multilingual sites require a Business plan — see Billing',
        { variant: 'warning', persist: false },
      )
    }
    try {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        locales: parsed.length ? parsed : deleteField(),
        defaultLocale:
          parsed.length && parsed.includes(defaultLocale)
            ? defaultLocale
            : parsed.length
              ? parsed[0]
              : deleteField(),
      })
      enqueueSnackbar('Languages saved', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [tenant, firestore, hostId, parsed, defaultLocale, enqueueSnackbar])

  return (
    <CardDisplay header={'Languages'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'List the languages this site publishes in, then link each ' +
            "screen to its translations from the screens list (the globe " +
            'button). Add a Language Switcher element so visitors can ' +
            'change language.'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Languages"
            placeholder="en, es, fr"
            helperText="Comma-separated ISO codes"
            value={locales}
            onChange={(event) => setLocales(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            select
            label="Default"
            value={parsed.includes(defaultLocale) ? defaultLocale : ''}
            onChange={(event) => setDefaultLocale(event.target.value)}
            size="small"
            sx={{ minWidth: 110 }}
            disabled={!parsed.length}
          >
            {parsed.map((locale) => (
              <MenuItem key={locale} value={locale}>
                {locale}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={handleSave}
        >
          {'Save languages'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
LanguagesCard.displayName = 'LanguagesCard'

export default LanguagesCard
