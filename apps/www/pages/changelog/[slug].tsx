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
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { GetStaticPaths, GetStaticProps } from 'next'
import Head from 'next/head'
import ChangelogFigure from '../../components/ChangelogFigure'
import { mainNavigation } from '../../const'
import {
  CHANGELOG_ENTRIES,
  type ChangelogEntry,
  changelogEntry,
  formatChangelogDate,
} from '../../data/changelog'
import MainLayout from '../../layouts/MainLayout'
import SiteFooterView from '../../views/SiteFooterView'

interface ChangelogEntryProps {
  entry: ChangelogEntry
}

/** A single changelog entry (AGL-614). */
function ChangelogEntryPage({ entry }: ChangelogEntryProps) {
  return (
    <MainLayout
      title={`${entry.title} — Changelog — ${APP_WWW.TITLE}`}
      centerNavigationItems={mainNavigation}
      productName={BRAND_NAMES.WWW}
    >
      <Head>
        <meta name="description" content={entry.summary} />
        <meta property="og:title" content={entry.title} />
        <meta property="og:description" content={entry.summary} />
        <meta property="og:type" content="article" />
        <meta property="article:published_time" content={entry.date} />
      </Head>
      <Container maxWidth={'md'} gutterY>
        <Stack spacing={1} sx={{ pt: 4 }}>
          <AppLink href="/changelog" sx={{ fontSize: '0.875rem' }}>
            {'← Changelog'}
          </AppLink>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {formatChangelogDate(entry.date)}
          </Typography>
          <Typography variant="h3" component="h1">
            {entry.title}
          </Typography>
          <Typography variant="h6" color="text.secondary">
            {entry.summary}
          </Typography>
        </Stack>

        <Stack spacing={3} sx={{ py: 4 }}>
          {entry.sections.map((section, index) => (
            <Stack key={index} spacing={1.5}>
              {section.heading ? (
                <Typography variant="h5" component="h2">
                  {section.heading}
                </Typography>
              ) : null}
              {section.body.map((paragraph, pIndex) => (
                <Typography key={pIndex} variant="body1">
                  {paragraph}
                </Typography>
              ))}
              {section.image ? (
                <ChangelogFigure image={section.image} />
              ) : null}
            </Stack>
          ))}
        </Stack>
      </Container>
      <SiteFooterView />
    </MainLayout>
  )
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: CHANGELOG_ENTRIES.map((entry) => ({ params: { slug: entry.slug } })),
  fallback: false,
})

export const getStaticProps: GetStaticProps<
  ChangelogEntryProps,
  { slug: string }
> = async ({ params }) => {
  const entry = params ? changelogEntry(params.slug) : undefined
  if (!entry) return { notFound: true }
  return { props: { entry } }
}

export default ChangelogEntryPage
