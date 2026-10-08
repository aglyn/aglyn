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

import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AppLink from './app-link'

export const SITE_LIVE_NOTICE_TITLE = 'Your site is live'
export const SITE_LIVE_NOTICE_BODY = 'Your pages are published, and anyone can visit your site now.'

export interface SiteLiveNoticeProps {
  /** The site's public address; without one the notice says it is live and offers only the pages. */
  liveUrl: string | null
  /** The console's page list for the site, where the pages are edited. */
  pagesHref: string | null
  /** The heading's level, for the page or dialog it sits in. */
  headingComponent?: 'h1' | 'h2' | 'h3'
}

/**
 * What a person sees the moment their site goes live: that it is live, the
 * address visitors use, and the two things to do next — look at it, or edit
 * its pages. Shared by every path that publishes a new site (the starter, the
 * guided AI start) so a site goes live in the same words whichever way it
 * was made.
 *
 * It exists because nothing said so. A starter site is published the moment
 * it is chosen, and a person who was never told read their analytics window
 * ("14 days") as a countdown to launch.
 */
export function SiteLiveNotice({ liveUrl, pagesHref, headingComponent = 'h2' }: SiteLiveNoticeProps) {
  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h5" component={headingComponent}>
          {SITE_LIVE_NOTICE_TITLE}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {SITE_LIVE_NOTICE_BODY}
        </Typography>
        {liveUrl ? (
          <Link href={liveUrl} target="_blank" rel="noopener noreferrer" variant="body1" sx={{ wordBreak: 'break-all' }}>
            {liveUrl.replace(/^https?:\/\//, '')}
          </Link>
        ) : null}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {liveUrl ? (
          // The live site, in a tab of its own: the console stays where it is.
          <Button variant="contained" size="large" component="a" href={liveUrl} target="_blank" rel="noopener noreferrer">
            {'View your site'}
          </Button>
        ) : null}
        {pagesHref ? (
          <Button variant={liveUrl ? 'outlined' : 'contained'} size="large" component={AppLink} href={pagesHref}>
            {'Edit your pages'}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

export default SiteLiveNotice
