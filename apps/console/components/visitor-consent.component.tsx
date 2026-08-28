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

import { CONSENT_OPT_OUT_TITLE } from '@aglyn/aglyn/app-utils/consent-banner-ui'
import {
  VISITOR_CONSENT_CHANGED_EVENT,
  VISITOR_CONSENT_OPEN_EVENT,
  type StoredVisitorConsent,
  type VisitorConsentPosture,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  decidePlatformConsent,
  platformAsksAboutAdvertising,
  platformRefusalStatus,
  readPlatformConsent,
  storePlatformConsent,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { LEGAL_REFERENCE_URLS, LEGAL_URLS } from '../constants/shared'

/**
 * The console's visitor-consent surfaces — the UI over the enforcement layer,
 * never the enforcement itself.
 *
 * Enforcement lives in `firebase-services.tsx`: the Firebase Analytics tag is
 * not created at all while the registered consent gate says no, so gtag.js is
 * never fetched, `window.gtag` never exists, and the shared `deliver()` has no
 * fallback to reach. That property holds whether or not this component ever
 * renders, which is the only arrangement worth having — a banner that appears
 * while data is already flowing is worse than no banner, because it documents
 * a choice the visitor never actually got.
 *
 * ## Two surfaces, and why they are not the same surface
 *
 * - **The prior-consent banner.** Shown only to a visitor the posture says
 *   must be ASKED FIRST — the UK, the EU/EEA, Switzerland, and anyone whose
 *   region cannot be determined — and only while they are undecided. It
 *   disappears the moment they answer and never comes back.
 *
 *   It is deliberately not gated on being signed out. The console's
 *   most-collected public page is `/signin`, where there is no account menu
 *   and no signed-in user, so a menu-only design would leave a European
 *   visitor there with no way to accept and no way to refuse. Leaving it up
 *   for signed-in visitors too costs nothing (it is gone as soon as they
 *   answer) and buys the property that no console route can present an
 *   undecided prior-consent visitor with nothing to click.
 *
 * - **The preferences panel.** The change-your-mind path in BOTH directions,
 *   with no trigger of its own. It opens on
 *   {@link VISITOR_CONSENT_OPEN_EVENT} — dispatched by the account menu's row
 *   — and on a click of any `#aglyn-consent` link. There is deliberately NO
 *   persistent on-screen pill here, unlike a published customer site: the
 *   console has an account menu, and that is where a signed-in person looks
 *   for their own settings.
 *
 * ## Checkbox state is DERIVED, never defaulted
 *
 * The switches read the resolved record, so they describe what is actually
 * happening to this visitor rather than a house preference:
 *
 * - Outside the prior-consent regions, resolution writes an `implied` record
 *   on the first visit and the analytics switch reads ON — correctly, because
 *   that visitor IS being measured and this control is their withdrawal path.
 * - Inside them, resolution writes nothing at all, so the switch reads OFF
 *   until they accept. A ticked box shown to someone who has not consented
 *   misrepresents their state, and it is the misrepresentation that matters
 *   most here.
 *
 * The same derivation covers a visitor with no stored record from before this
 * shipped. Nothing is backfilled: writing an `accepted` record for existing
 * users would fabricate a consent nobody gave, and in a prior-consent region
 * it would fabricate the one kind that is unlawful to assume.
 */

/** Open the console's privacy-choices panel from anywhere in the app. */
export function openVisitorConsentPanel(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(VISITOR_CONSENT_OPEN_EVENT))
  } catch {
    // A dispatch failure costs the click, never the page.
  }
}

interface ResolvedState {
  ready: boolean
  stored: StoredVisitorConsent | null
  posture: VisitorConsentPosture | null
  country: string | null
}

const INITIAL: ResolvedState = {
  ready: false,
  stored: null,
  posture: null,
  country: null,
}

export function VisitorConsent(): ReactElement | null {
  const [state, setState] = useState<ResolvedState>(INITIAL)
  const [panelOpen, setPanelOpen] = useState(false)
  const [analyticsOn, setAnalyticsOn] = useState(false)
  const [advertisingOn, setAdvertisingOn] = useState(false)
  const asksAboutAdvertising = platformAsksAboutAdvertising()
  // Read from a listener that must not re-subscribe when the panel opens, so
  // it is a ref rather than the state value in the effect's dependency list.
  const panelOpenRef = useRef(false)
  panelOpenRef.current = panelOpen

  useEffect(() => {
    let active = true

    /**
     * Adopt whatever the record now says. Called on resolution and on every
     * consent change, including one made in another tab of the same origin —
     * `storeVisitorConsent` dispatches on this window, and a re-read is
     * cheaper than reasoning about which writer moved it.
     */
    const adopt = (resolved?: ResolvedState) => {
      if (!active) return
      const stored = resolved ? resolved.stored : readPlatformConsent()
      setState((previous) =>
        resolved ? resolved : { ...previous, ready: true, stored },
      )
      // The switches describe the RECORD, which is the whole "derived, never
      // defaulted" rule. Skipped while the panel is open so a consent change
      // elsewhere cannot silently rewrite a choice someone is mid-way through
      // making.
      if (!panelOpenRef.current) {
        setAnalyticsOn(stored?.analytics === true)
        setAdvertisingOn(stored?.advertising === true)
      }
    }

    void decidePlatformConsent().then((resolved) =>
      adopt({ ready: true, ...resolved }),
    )

    const onChanged = () => adopt()
    const onOpen = () => {
      const current = readPlatformConsent()
      setAnalyticsOn(current?.analytics === true)
      setAdvertisingOn(current?.advertising === true)
      setPanelOpen(true)
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      const anchor = target?.closest?.('a[href]')
      if (
        anchor &&
        (anchor.getAttribute('href') ?? '').endsWith('#aglyn-consent')
      ) {
        event.preventDefault()
        onOpen()
      }
    }

    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, onChanged)
    window.addEventListener(VISITOR_CONSENT_OPEN_EVENT, onOpen)
    // Capture, so a handler that stops propagation cannot swallow the one
    // link a visitor has for reopening their own choices.
    document.addEventListener('click', onClick, true)
    return () => {
      active = false
      window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, onChanged)
      window.removeEventListener(VISITOR_CONSENT_OPEN_EVENT, onOpen)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  const refusal = platformRefusalStatus(state.stored, state.posture)

  const decide = (accepted: boolean, advertising = false) => {
    storePlatformConsent({
      status: accepted ? 'accepted' : refusal,
      country: state.country,
      // Passed through only. `storeVisitorConsent` re-derives it against the
      // status, so a refusal cannot carry a grant however this is called.
      advertising: asksAboutAdvertising && accepted && advertising,
    })
    setPanelOpen(false)
  }

  const askBanner = state.ready && !state.stored && state.posture === 'opt-in'

  const policyLinks = (
    <Typography variant="caption" color="text.secondary" component="div">
      {'Read the '}
      <Link href={LEGAL_URLS.PRIVACY} target="_blank" rel="noopener noreferrer">
        {'Privacy Policy'}
      </Link>
      {' and the '}
      <Link
        href={LEGAL_REFERENCE_URLS.COOKIES}
        target="_blank"
        rel="noopener noreferrer"
      >
        {'Cookie Policy'}
      </Link>
      {'.'}
    </Typography>
  )

  return (
    <>
      {askBanner ? (
        <Paper
          role="region"
          aria-label="Privacy choices"
          data-aglyn-consent-banner=""
          elevation={8}
          sx={{
            position: 'fixed',
            zIndex: 'snackbar',
            insetInline: 0,
            bottom: 0,
            mx: 'auto',
            p: 2,
            maxWidth: 720,
            borderRadius: 2,
            m: 2,
            border: 1,
            borderColor: 'divider',
            backgroundColor: 'surface.main',
            backgroundImage: 'none',
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">
                {'This console would like to use analytics (Google ' +
                  'Analytics) to understand how it is used. It does not run ' +
                  'unless you allow it — signing in and everything else here ' +
                  'works either way.'}
              </Typography>
              <Box sx={{ mt: 0.5 }}>{policyLinks}</Box>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button size="small" onClick={() => setPanelOpen(true)}>
                {'Preferences'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => decide(false)}
              >
                {'Decline'}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => decide(true, asksAboutAdvertising)}
              >
                {asksAboutAdvertising ? 'Allow all' : 'Allow'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Dialog
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        maxWidth="sm"
        fullWidth
        data-aglyn-consent-preferences=""
      >
        {/* The exact words are fixed by CCPA regs §7015 for a combined
            opt-out control, and the constant is imported rather than retyped
            so this surface cannot drift from the one on published sites. */}
        <DialogTitle>{CONSENT_OPT_OUT_TITLE}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2">
              {'Choose what this console may use. Strictly necessary ' +
                'features — signing in, keeping you signed in, and ' +
                'remembering this choice — are always on because the console ' +
                'cannot work without them.'}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={analyticsOn}
                  onChange={(event) => setAnalyticsOn(event.target.checked)}
                  slotProps={{ input: { 'aria-label': 'Analytics' } }}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{'Analytics'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {'Google Analytics — which pages are used and where ' +
                      'things go wrong.'}
                  </Typography>
                </Box>
              }
            />
            {asksAboutAdvertising ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={advertisingOn}
                    onChange={(event) =>
                      setAdvertisingOn(event.target.checked)
                    }
                    slotProps={{ input: { 'aria-label': 'Advertising' } }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{'Advertising'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {'Personalized ads and measuring how they perform.'}
                    </Typography>
                  </Box>
                }
              />
            ) : (
              /*
               * Stated rather than offered, because there is nothing here to
               * consent to: this surface declares ad storage, ad user data and
               * ad personalization DENIED in every region, loads no
               * advertising vendor's script, and has no Google Ads link. A
               * switch whose answer changes nothing is decoration, and
               * decoration is what teaches people to click past the controls
               * that do matter. `platformAsksAboutAdvertising` derives this
               * from the declaration itself, so the day an ad tag arrives the
               * switch appears with it.
               */
              <Typography variant="body2" color="text.secondary">
                {'Advertising is off for everyone here. This console loads ' +
                  'no advertising or retargeting tags, and tells Google to ' +
                  'deny ad storage, ad personalization and ad user data in ' +
                  'every region — so there is nothing to switch on.'}
              </Typography>
            )}
            {policyLinks}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => decide(false)}>{'Decline all'}</Button>
          <Button
            variant="contained"
            onClick={() => decide(analyticsOn, analyticsOn && advertisingOn)}
          >
            {'Save choices'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
VisitorConsent.displayName = 'VisitorConsent'
VisitorConsent.aglyn = true

export default VisitorConsent
