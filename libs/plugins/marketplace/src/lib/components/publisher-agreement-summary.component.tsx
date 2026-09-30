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
  PUBLISHER_AGREEMENT_POINTS,
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
} from '../model/publisher-agreement'
import { Link, Stack, Typography } from '@mui/material'

/**
 * What the agreement commits a publisher to, and where to read all of it
 * (AGL-1077).
 *
 * One rendering for both places the agreement is accepted — the Publisher
 * Profile card and the dialog a refused action opens (AGL-3407) — so the two
 * can never show a publisher different terms for the same acceptance.
 *
 * @param documentUrl the page to link, from `publisherAgreementPresentation`
 *   and never from the constant: while the document is unpublished that
 *   helper hands back null and there is nothing here to click. A link to a
 *   404 above an Accept button is how a publisher ends up having "read" a
 *   document that was never served (AGL-1660).
 */
export function PublisherAgreementSummary(props: {
  documentUrl: string | null
}) {
  const { documentUrl } = props
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {'In summary — this is not the agreement, it is what tends to ' +
          'surprise people later:'}
      </Typography>
      <Stack spacing={1} component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
        {PUBLISHER_AGREEMENT_POINTS.map((point) => (
          <Stack key={point.id} spacing={0.25} component="li">
            <Typography variant="body2">{point.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {point.detail}
            </Typography>
          </Stack>
        ))}
      </Stack>
      {documentUrl ? (
        <Typography variant="body2">
          <Link
            href={documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            underline="always"
          >
            {`Read the full ${PUBLISHER_AGREEMENT_TITLE}`}
          </Link>
          {` (version ${PUBLISHER_AGREEMENT_VERSION})`}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {`Version ${PUBLISHER_AGREEMENT_VERSION} has no published page ` +
            'yet, so there is no full text to link to.'}
        </Typography>
      )}
    </Stack>
  )
}

PublisherAgreementSummary.displayName = 'PublisherAgreementSummary'

export default PublisherAgreementSummary
