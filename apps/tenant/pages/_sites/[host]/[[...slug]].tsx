/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type {
  AglynHost,
  AglynScreen,
  AglynScreenVersion,
} from '@aglyn/core-data-foundation'
import type { GetStaticPaths, GetStaticProps, PreviewData } from 'next/types'
import type { ParsedUrlQuery } from 'querystring'
import { useEffect } from 'react'
import getHost from '../../../utils/get-host'
import getScreen from '../../../utils/get-screen'
import getScreenVersion from '../../../utils/get-screen-version'

type StaticPreviewData = PreviewData

interface StaticPathsCtx extends ParsedUrlQuery {}

interface Props {
  host?: AglynHost
  screen?: {
    data?: AglynScreen
    version?: AglynScreenVersion
  }
}

export const getStaticPaths: GetStaticPaths<StaticPathsCtx> = async (ctx) => {
  console.log('!!!!!getStaticPaths ctx', ctx)
  return {
    paths: [],
    fallback: 'blocking', // ISR server-render if static cache is not available
  }
}

export const getStaticProps: GetStaticProps<
  Props,
  StaticPathsCtx,
  StaticPreviewData
> = async (context) => {
  console.debug('!!!!!getStaticProps', context)

  const { params } = context

  try {
    const hostRes = await getHost(params.host as string)
    console.debug('hostRes', hostRes)

    if (hostRes.error || !hostRes.host) {
      return {
        notFound: true,
        revalidate: false, // never=false, always=1, since=SECONDS
      }
    }

    const screenEntry = Object.entries(hostRes.host.screens || {}).find(
      ([screenId, slug]) => {
        return slug === (params.slug as string[]).join('/')
      },
    )
    console.debug('screenEntry', screenEntry)

    if (!Array.isArray(screenEntry)) {
      return {
        notFound: true,
        revalidate: false, // never=false, always=1, since=SECONDS
      }
    }

    const screenId = screenEntry[0]
    const screenRes = await getScreen(screenId)
    console.debug('screenRes', screenRes)

    if (screenRes.error || !screenRes.screen) {
      return {
        notFound: true,
        revalidate: false, // never=false, always=1, since=SECONDS
      }
    }

    const versionRes = await getScreenVersion(
      screenId,
      screenRes.screen.versionId,
    )
    console.debug('versionRes', versionRes)

    return {
      props: JSON.parse(
        JSON.stringify({
          host: hostRes.host,
          screen: {
            data: screenRes.screen,
            version: versionRes.version,
          },
        }),
      ),
      revalidate: false, // never=false, always=1, since=SECONDS
    }
  } catch (e) {
    console.error(e)
  }
}

export default function CatchAllPage(props: Props) {
  console.log('!!!!!CatchAllPage')

  useEffect(() => {
    // console.log('Aglynn', globalThis.Aglynn, Aglyn)
    // if (typeof Aglyn !== 'undefined') {
    //   Aglyn.Aglynn?.canvas.setElements({
    //     type: Array.isArray(props.screen.version) ? 'normal' : 'denormal',
    //     elements: props.screen.version,
    //   })
    // }
  })

  return (
    <>
      <pre>{JSON.stringify(props, null, 2)}</pre>
    </>
  )
}
