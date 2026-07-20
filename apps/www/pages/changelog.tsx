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

import { APP_WWW, BRAND_NAMES } from '@aglyn/shared-data-enums'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { GetStaticProps } from 'next'
import { mainNavigation } from '../const'
import {
  type ChangelogEntry,
  changelogEntries,
  formatChangelogDate,
} from '../data/changelog'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'

interface ChangelogIndexProps {
  entries: ChangelogEntry[]
}

/** Changelog index (AGL-614): a dated timeline of product updates. */
function ChangelogIndex({ entries }: ChangelogIndexProps) {
  return (
    <MainLayout
      title={`Changelog — ${APP_WWW.TITLE}`}
      centerNavigationItems={mainNavigation}
      productName={BRAND_NAMES.WWW}
    >
      <Container maxWidth={'md'} gutterY>
        <Stack spacing={1} sx={{ py: 4 }}>
          <Typography variant="overline" color="text.secondary">
            {'Changelog'}
          </Typography>
          <Typography variant="h3" component="h1">
            {'What’s new in Aglyn'}
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {'The latest features and improvements, newest first.'}
          </Typography>
        </Stack>

        <Stack spacing={0} divider={<Divider flexItem />}>
          {entries.map((entry) => (
            <Stack
              key={entry.slug}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 1, sm: 4 }}
              sx={{ py: 4 }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: { sm: 140 }, pt: { sm: 0.5 } }}
              >
                {formatChangelogDate(entry.date)}
              </Typography>
              <Stack spacing={1} sx={{ flexGrow: 1 }}>
                <AppLink
                  href={`/changelog/${entry.slug}`}
                  sx={{ textDecoration: 'none' }}
                >
                  <Typography variant="h5" component="h2">
                    {entry.title}
                  </Typography>
                </AppLink>
                <Typography variant="body1" color="text.secondary">
                  {entry.summary}
                </Typography>
                <AppLink href={`/changelog/${entry.slug}`}>
                  {'Read more'}
                </AppLink>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Container>
      <SiteFooterView />
    </MainLayout>
  )
}

export const getStaticProps: GetStaticProps<ChangelogIndexProps> = async () => ({
  props: { entries: changelogEntries() },
})

export default ChangelogIndex
