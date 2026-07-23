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
import { Alert, Chip, Stack, Typography } from '@mui/material'
import { TENANT_EMAIL_GROUPS } from '../constants/tenant-email-catalog'

/**
 * Read-only reference of the transactional emails a site sends to its own
 * end-users, grouped by the feature (plugin) that owns each (AGL-769).
 *
 * Informational only — the copy for these lives in the plugin or is authored
 * in that plugin's own UI, not here. This is deliberately separate from the
 * platform system-email catalog (mail Aglyn sends about the account): a site
 * owner asked "what does my site email my customers?", and nothing answered.
 */
export function SiteEmailsCard() {
  return (
    <CardDisplay
      header={'Emails this site sends'}
      subheader={
        'The transactional emails your site sends to your own customers. ' +
        'A group applies only when that feature is enabled on this site.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {TENANT_EMAIL_GROUPS.map((group) => (
          <Stack key={group.pluginId} spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">{group.plugin}</Typography>
              <Chip
                size="small"
                variant="outlined"
                label={`${group.emails.length} email${
                  group.emails.length === 1 ? '' : 's'
                }`}
              />
            </Stack>
            {group.emails.map((email) => (
              <Stack
                key={email.name}
                spacing={0.25}
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  pb: 1,
                  '&:last-of-type': { borderBottom: 0, pb: 0 },
                }}
              >
                <Typography variant="body2">{email.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {email.description}
                  {email.authoredIn ? ` Edited in ${email.authoredIn}.` : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ))}
        <Alert severity="info">
          {'These are sent by your site, on your behalf. The account emails ' +
            'Aglyn itself sends you — invites, receipts, security — are ' +
            'managed by Aglyn, not here.'}
        </Alert>
      </Stack>
    </CardDisplay>
  )
}
SiteEmailsCard.displayName = 'SiteEmailsCard'

export default SiteEmailsCard
