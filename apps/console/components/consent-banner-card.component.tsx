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
  hostConsentRequired,
  isConsentToolDisabled,
  resolveGaMeasurementId,
  resolveHostConsentMode,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface ConsentBannerCardProps {
  hostId: string
}

/**
 * Visitor consent tool (AGL-1498): whether — and HOW — this site asks
 * visitors before loading the analytics its owner configured. Sits directly
 * under the GA field it governs, so configuring tracking and choosing the
 * consent posture happen in the same glance (the posture is the host's
 * ACTIVE choice, per Zach 2026-08-13 — not a platform default buried in a
 * doc).
 *
 * The tool is active by default and self-scoping — consent UI only ever
 * renders on a site that actually uses a gated feature (today: a Google
 * Analytics id), so with no analytics this card changes nothing visible.
 * A host that never touches the mode gets GEO-CONDITIONAL (the preselected
 * option below and the stored-absent behavior — they agree by construction).
 *
 * Its own card rather than a field in the SEO form for the same reason the
 * search-indexing switch is (AGL-1263): the form refuses to submit until
 * title and description validate, and re-enabling a consent banner must
 * never be blocked by someone's half-edited SEO copy.
 *
 * Written with `updateDoc` + dotted paths, matching that card — the host
 * converter only strips `$id`, so no field is at risk from a partial write
 * (AGL-1250). The tool switch uses `deleteField()` on the way back on:
 * "absent means active" is the invariant the tenant reads, and the only
 * safe default — a schema slip must fail toward asking, never toward
 * silently tracking. The MODE writes an explicit value both ways: the
 * choice is the datum.
 */
export function ConsentBannerCard(props: ConsentBannerCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )

  const disabled = isConsentToolDisabled(host)
  const mode = resolveHostConsentMode(host)
  const hasGa = Boolean(resolveGaMeasurementId(host))
  const machineryLive = hostConsentRequired(host)

  const handleToggle = useCallback(
    async (active: boolean) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        'consent.disabled': active ? deleteField() : true,
      })
      enqueueSnackbar(
        active
          ? 'Consent tool on — visitor tracking follows your consent mode'
          : 'Consent tool off — analytics loads for every visitor, unasked',
        { variant: active ? 'success' : 'warning', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const handleMode = useCallback(
    async (nextMode: string) => {
      const value = nextMode === 'strict' ? 'strict' : 'geo'
      await updateDoc(doc(firestore, 'hosts', hostId), {
        'consent.mode': value,
      })
      enqueueSnackbar(
        value === 'strict'
          ? 'Opt-in everywhere — every visitor is asked before analytics loads'
          : 'Geo-conditional — visitors are asked only where the law requires it',
        { variant: 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header="Cookie consent"
      help={docsHelp('cookieConsent', { anchor: '#how-it-works' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Controls whether and how visitors are asked before Google ' +
            'Analytics loads. Consent UI appears only if this site uses a ' +
            'feature that needs consent — with no analytics configured, ' +
            'visitors see nothing.'}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={!disabled}
              onChange={(event) => void handleToggle(event.target.checked)}
            />
          }
          label="Ask visitors for consent before loading analytics"
        />
        {!disabled ? (
          <FormControl>
            <FormLabel id={`consent-mode-${hostId}`}>Consent mode</FormLabel>
            <RadioGroup
              aria-labelledby={`consent-mode-${hostId}`}
              value={mode}
              onChange={(event) => void handleMode(event.target.value)}
            >
              <FormControlLabel
                value="geo"
                control={<Radio />}
                label={
                  <span>
                    {'Geo-conditional (recommended) — '}
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                    >
                      {'visitors in prior-consent regions (EU, UK) and ' +
                        'unknown regions see a consent banner first; ' +
                        'visitors elsewhere (e.g. the US) are tracked from ' +
                        'their first visit, with a persistent "Privacy ' +
                        'choices" control to opt out'}
                    </Typography>
                  </span>
                }
              />
              <FormControlLabel
                value="strict"
                control={<Radio />}
                label={
                  <span>
                    {'Opt-in everywhere — '}
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                    >
                      {'every visitor, everywhere, is asked before ' +
                        'analytics loads'}
                    </Typography>
                  </span>
                }
              />
            </RadioGroup>
          </FormControl>
        ) : null}
        {/*
         * Status, worded as consequences. The dangerous combination is
         * GA-configured + tool off: tracking every visitor without asking is
         * exactly the exposure this card exists to prevent, so it gets the
         * warning; everything else is a quiet statement of fact.
         */}
        {hasGa && disabled ? (
          <Alert severity="warning">
            {'Google Analytics is configured and the consent tool is off: ' +
              'the tag loads for every visitor without being asked. Only ' +
              'keep this off if you run your own consent solution — you ' +
              'remain responsible for the consent your visitors’ ' +
              'jurisdictions require.'}
          </Alert>
        ) : null}
        {machineryLive ? (
          <Alert severity="info">
            {mode === 'strict'
              ? 'Live: every visitor sees the consent banner before Google ' +
                'Analytics loads. Visitors sending the Global Privacy ' +
                'Control signal are opted out automatically.'
              : 'Live: EU/UK and unknown-region visitors see the consent ' +
                'banner; visitors elsewhere are tracked from first visit ' +
                'and recorded as implied consent. For those visitors the ' +
                'persistent "Privacy choices" control (shown on every ' +
                'page) is the opt-out — it cannot be removed by a ' +
                'template. Global Privacy Control is honored as an ' +
                'automatic opt-out.'}
          </Alert>
        ) : null}
        {!hasGa && !disabled ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing on this site currently needs consent, so no consent ' +
              'UI is shown. Configure a Google Analytics ID above and your ' +
              'consent mode takes effect automatically.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
ConsentBannerCard.displayName = 'ConsentBannerCard'

export default ConsentBannerCard
