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

import type { SiteRuntimeProps } from '@aglyn/aglyn/plugin-manager/site-runtime'
import { usePageIdle } from '@aglyn/aglyn/app-utils/page-idle'
import { MenuItem, Paper, TextField, type Theme } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import {
  WEGLOT_BOOT_ELEMENT_ID,
  WEGLOT_LANGUAGE_STORAGE_KEY,
  WEGLOT_PAGE_PROP,
  WEGLOT_SWITCHER_TARGET_ID,
} from '../constants'
import {
  readWeglotSiteSettings,
  type WeglotSiteSettings,
} from '../model/weglot-settings'
import {
  buildWeglotBoot,
  loadWeglot,
  residentWeglot,
  type WeglotApi,
} from '../weglot-loader'

/**
 * Weglot on a published page (AGL-3700).
 *
 * Drawn by the tenant catch-all for every page of a site that switched the
 * plugin on, and nowhere else that matters: the Besigner canvas renders no
 * site runtime, and the console's document preview hands runtimes an empty
 * `page`, so with no `weglotIntegration` slice this renders nothing and loads
 * nothing. The slice is written only by the plugin's server enricher, which
 * checks the site switch, the plan and the stored settings first.
 *
 * Why the script loads when it does is the docblock of `weglot-loader.ts`.
 */
export function WeglotSiteRuntime({ page }: SiteRuntimeProps) {
  const settings = useMemo(
    () => readWeglotSiteSettings(page?.[WEGLOT_PAGE_PROP]),
    [page],
  )
  if (!settings) return null
  return <WeglotOnPage settings={settings} />
}

/** The fixed corner the merchant chose, a theme gutter in from the edges. */
const corner = (settings: WeglotSiteSettings) => {
  const gutter = (theme: Theme) => theme.spacing(2)
  return settings.switcherPosition === 'bottom-left'
    ? { bottom: gutter, left: gutter, right: 'auto' }
    : { bottom: gutter, right: gutter, left: 'auto' }
}

function WeglotOnPage({ settings }: { settings: WeglotSiteSettings }) {
  const boot = useMemo(() => buildWeglotBoot(settings), [settings])
  const idle = usePageIdle()
  useEffect(() => {
    if (idle) void loadWeglot(settings)
  }, [idle, settings])
  return (
    <>
      <script
        id={WEGLOT_BOOT_ELEMENT_ID}
        // Built from format-checked values and constants only, through
        // `inlineJson`. The tenant sends no `script-src` (AGL-1228).
        dangerouslySetInnerHTML={{ __html: boot }}
      />
      {settings.switcher === 'weglot' ? (
        // Weglot draws its own switcher in here once it has loaded.
        <Paper
          id={WEGLOT_SWITCHER_TARGET_ID}
          elevation={0}
          data-wg-notranslate=""
          sx={{
            position: 'fixed',
            ...corner(settings),
            zIndex: (theme) => theme.zIndex.speedDial,
            bgcolor: 'transparent',
          }}
        />
      ) : (
        <WeglotLanguageSwitcher settings={settings} />
      )}
    </>
  )
}

/** A language's name in that language — how a visitor looks for their own. */
export function languageAutonym(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    if (name && name.toLowerCase() !== code) {
      return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
    }
  } catch {
    // An engine without the code, or without `DisplayNames`.
  }
  return code.toUpperCase()
}

/**
 * The languages to offer: the site's own, then its targets — narrowed, once
 * Weglot has loaded, to the targets the Weglot project actually serves, so a
 * language the merchant typed here and never added in Weglot is not offered.
 */
export function offeredLanguages(
  settings: WeglotSiteSettings,
  weglot: WeglotApi | null,
): string[] {
  const served = weglot?.options?.languages
    ?.filter((language) => language?.enabled !== false)
    .map((language) => String(language?.language_to ?? '').toLowerCase())
    .filter(Boolean)
  const targets = served?.length
    ? settings.targetLanguages.filter((code) => served.includes(code))
    : settings.targetLanguages
  return [settings.sourceLanguage, ...targets]
}

function storedLanguage(settings: WeglotSiteSettings): string | null {
  try {
    const stored = window.localStorage.getItem(WEGLOT_LANGUAGE_STORAGE_KEY)
    return stored && settings.targetLanguages.includes(stored) ? stored : null
  } catch {
    return null
  }
}

/**
 * The themed switcher: the site's own theme, through MUI's basic elements.
 *
 * Client-only (it renders nothing until mounted), because which language is
 * current lives in the visitor's browser and the cached HTML cannot know it.
 * It works before Weglot has loaded: choosing a language loads Weglot at once
 * and then switches.
 */
export function WeglotLanguageSwitcher({
  settings,
}: {
  settings: WeglotSiteSettings
}) {
  const [mounted, setMounted] = useState(false)
  const [weglot, setWeglot] = useState<WeglotApi | null>(null)
  const [current, setCurrent] = useState(settings.sourceLanguage)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMounted(true)
    setCurrent(storedLanguage(settings) ?? settings.sourceLanguage)
    const resident = residentWeglot()
    if (resident?.initialized) setWeglot(resident)
  }, [settings])

  // Follow Weglot once it is here: the language it is showing, and any change
  // made through it (its link hooks, its auto-redirect).
  useEffect(() => {
    if (!weglot?.on) return
    const language = weglot.getCurrentLang?.()
    if (language) setCurrent(language)
    const onChange = (next: unknown) => {
      if (typeof next === 'string') setCurrent(next)
    }
    weglot.on('languageChanged', onChange)
    return () => {
      weglot.off?.('languageChanged', onChange)
    }
  }, [weglot])

  // The page-idle load (and the early one) happen in `WeglotOnPage`; this
  // only learns when that finished.
  const idle = usePageIdle()
  useEffect(() => {
    if (!idle || weglot) return
    let live = true
    void loadWeglot(settings).then((loaded) => {
      if (live && loaded?.initialized) setWeglot(loaded)
    })
    return () => {
      live = false
    }
  }, [idle, settings, weglot])

  const languages = offeredLanguages(settings, weglot)
  if (!mounted || languages.length < 2) return null

  const choose = async (code: string) => {
    if (code === current) return
    setBusy(true)
    try {
      const loaded = weglot ?? (await loadWeglot(settings))
      if (loaded?.switchTo) {
        if (!weglot && loaded.initialized) setWeglot(loaded)
        loaded.switchTo(code)
        setCurrent(code)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper
      elevation={3}
      // Weglot must not translate the names of the languages it offers.
      data-wg-notranslate=""
      sx={{
        position: 'fixed',
        ...corner(settings),
        zIndex: (theme) => theme.zIndex.speedDial,
        p: 0.5,
      }}
    >
      <TextField
        select
        size="small"
        label="Language"
        value={languages.includes(current) ? current : settings.sourceLanguage}
        disabled={busy}
        onChange={(event) => void choose(event.target.value)}
        sx={{ minWidth: 140 }}
      >
        {languages.map((code) => (
          <MenuItem key={code} value={code} lang={code}>
            {languageAutonym(code)}
          </MenuItem>
        ))}
      </TextField>
    </Paper>
  )
}
