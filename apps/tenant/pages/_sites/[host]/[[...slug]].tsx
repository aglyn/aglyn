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

import * as Aglyn from '@aglyn/aglyn'
import { AglynNodeRenderer } from '@aglyn/aglyn-node-renderer'
import '@aglyn/aglyn-plugin-mui'
import type {
  AglynHost,
  AglynScreen,
  AglynScreenVersion,
} from '@aglyn/core-data-foundation'
import type { GetStaticPaths, GetStaticProps } from 'next/types'
import type { ParsedUrlQuery } from 'querystring'
import { useMemo } from 'react'
import getHost from '../../../utils/get-host'
import getScreen from '../../../utils/get-screen'
import getScreenVersion from '../../../utils/get-screen-version'

interface StaticPathsCtx extends ParsedUrlQuery {}

interface Props {
  data: {
    host?: AglynHost
    screen?: {
      data?: AglynScreen
      version?: AglynScreenVersion
    }
  }
  nodes: Record<Aglyn.NodeId, Aglyn.NodeSchema>
}

export const getStaticPaths: GetStaticPaths<StaticPathsCtx> = async (ctx) => {
  console.log('!!!!!getStaticPaths ctx', ctx)
  return {
    paths: [],
    fallback: 'blocking', // ISR server-render if static cache is not available
  }
}

export const getStaticProps: GetStaticProps<Props> = async (context) => {
  console.debug('!!!!!getStaticProps', context)

  const { params } = context

  try {
    const host = params.host as string
    const hostRes = await getHost({
      host: host,
    })
    console.debug('hostRes', hostRes)

    if (hostRes.error || !hostRes.host) {
      return {
        notFound: true,
        revalidate: false, // never=false, always=1, since=SECONDS
      }
    }

    const hostId = hostRes.host.$id
    const screenEntry = Object.entries(hostRes.host.screens || {}).find(
      ([screenId, slug]) => {
        const currentPath = (params.slug as string[]).join('/')
        return slug === currentPath || slug === `/${currentPath || ''}`
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
    const screenRes = await getScreen({ hostId, screenId })
    console.debug('screenRes', screenRes)

    if (screenRes.error || !screenRes.screen) {
      return {
        notFound: true,
        revalidate: false, // never=false, always=1, since=SECONDS
      }
    }

    const versionRes = await getScreenVersion({
      hostId,
      screenId: screenId,
      versionId: screenRes.screen.versionId,
    })
    console.debug('versionRes', versionRes)
    const nodes = versionRes.version.nodes
    const isNested = Array.isArray(nodes)
    const denormalized = !isNested
      ? (nodes as unknown as Record<Aglyn.NodeId, Aglyn.NodeSchema>)
      : Aglyn.screen.denormalizeNodes(
          [
            {
              $id: Aglyn.NODE_ROOT_ID,
              componentId: 'div',
              nodes: [...nodes],
            },
          ],
          null,
        )
    Aglyn.screen.setNodes(denormalized)

    const props = {
      data: JSON.parse(
        JSON.stringify({
          host: hostRes.host,
          screen: {
            data: screenRes.screen,
            version: versionRes.version,
          },
        }),
      ),
      nodes: denormalized,
    }

    return {
      props: props,
      revalidate: false, // never=false, always=1, since=SECONDS
    }
  } catch (e) {
    console.error(e)
    return {
      // props: {},
      notFound: true,
    }
  }
}

export default function CatchAllPage(props: Props) {
  // const props = { data: exampleData }
  const nodes = props.nodes
  //

  console.log('!!!!!CatchAllPage', props)

  const rendered = useMemo(() => {
    return Aglyn.emitter.emit(Aglyn.AglynEvent.NODE_SET_ITEMS, { nodes: nodes })
  }, [nodes])

  return (
    <>
      <AglynNodeRenderer nodeId={Aglyn.NODE_ROOT_ID} />
    </>
  )
}
//
// const exampleData = {
//   host: {
//     projectId: 'ath-adams-brothers',
//     screens: {
//       'TyE-9na1Ku': 'about',
//     },
//     subdomain: 'adams-brothers',
//     tenantId: '-atN0g5dZgoDp4rfMaO_',
//     displayName: 'Adams Brothers',
//     seo: {
//       separator: '|',
//       description:
//         'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis mattis rutrum diam, maximus tincidunt mi viverra a.',
//       entity: {
//         type: '1',
//         logo: 'https://console.aglyn.io/_static/_pwa/icons/icon-256.png',
//         name: 'Brothers Co.',
//       },
//       title: 'Vestibulum quis feugiat lacus',
//       favicon: 'https://aglyn.io/favicon.ico',
//     },
//     cname: null,
//     projectNumber: 349050441620,
//   },
//   screen: {
//     data: {
//       slug: 'about',
//       description: 'The site about page',
//       visibility: 2,
//       updatedAt: {
//         _seconds: 1653736120,
//         _nanoseconds: 116000000,
//       },
//       createdAt: {
//         _seconds: 1653736120,
//         _nanoseconds: 116000000,
//       },
//       hostId: '-MtN17_cpfPPLwWjE6z4',
//       versionRef: {
//         _firestore: {
//           projectId: 'aglyn-main',
//         },
//         _path: {
//           segments: ['screens', 'TyE-9na1Ku', 'versions', 'xBnkO4KyZC'],
//         },
//         _converter: {},
//       },
//       versionId: 'xBnkO4KyZC',
//       displayName: 'About Page',
//       status: 4,
//       $id: 'TyE-9na1Ku',
//     },
//     version: {
//       updatedAt: {
//         _seconds: 1661592447,
//         _nanoseconds: 356000000,
//       },
//       screenId: 'TyE-9na1Ku',
//       nodes: [
//         {
//           componentId: 'app-bar',
//           bundleId: 'mui',
//           props: {
//             position: 'fixed',
//           },
//           elements: [
//             {
//               componentId: 'toolbar',
//               bundleId: 'mui',
//               $id: 'SQN-Pslbub',
//               elements: [
//                 {
//                   componentId: 'container',
//                   bundleId: 'mui',
//                   props: {
//                     disableGutters: false,
//                     fixed: false,
//                     maxWidth: 'md',
//                   },
//                   $id: 'Kdv8iloBmJ',
//                   elements: [
//                     {
//                       componentId: 'typography',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'h5',
//                         children: 'DuploCloud',
//                         component: 'div',
//                         gutterBottom: false,
//                       },
//                       $id: 'pdUIJUT902',
//                       elements: [],
//                       parentId: 'Kdv8iloBmJ',
//                     },
//                   ],
//                   parentId: 'SQN-Pslbub',
//                 },
//               ],
//               parentId: '-uxb_XxCKm',
//               props: {
//                 disableGutters: true,
//               },
//               sx: {},
//             },
//           ],
//           $id: '-uxb_XxCKm',
//           parentId: '_@_',
//           nodes: [],
//         },
//         {
//           componentId: 'container',
//           bundleId: 'mui',
//           props: {
//             maxWidth: 'md',
//           },
//           $id: 'c9VVN89fx1',
//           elements: [
//             {
//               componentId: 'stack',
//               bundleId: 'mui',
//               props: {},
//               sx: {
//                 flexDirection: 'row',
//                 alignItems: 'normal',
//                 flexWrap: 'wrap',
//                 gap: '10px',
//               },
//               $id: 'GcU9xioWyx',
//               elements: [
//                 {
//                   componentId: 'sample-element-4',
//                   props: {
//                     children: 'Sample Element 4',
//                   },
//                   $id: 'VFW--MkQsX',
//                   elements: [
//                     {
//                       $id: 'tKpTaQIIS4',
//                       componentId: 'sample-element',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'DpVPgHI-nN',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'tKpTaQIIS4',
//                           elements: [],
//                         },
//                         {
//                           $id: 'xZHOFU3r9V',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'tKpTaQIIS4',
//                           elements: [],
//                         },
//                         {
//                           $id: 'HjRz9dJDfN',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'tKpTaQIIS4',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'VFW--MkQsX',
//                     },
//                     {
//                       $id: 'RIvixkoTao',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'Hx6IIQLYUJ',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'RIvixkoTao',
//                           elements: [],
//                         },
//                         {
//                           $id: 'aQhxZKUQsb',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'RIvixkoTao',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'VFW--MkQsX',
//                     },
//                     {
//                       $id: '_O2CNnC1pV',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'cS1lvSfcF9',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '_O2CNnC1pV',
//                           elements: [],
//                           sx: {
//                             color: 'rgb(255, 0, 0)',
//                           },
//                         },
//                         {
//                           $id: 'gcSqBzThsK',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '_O2CNnC1pV',
//                           elements: [],
//                         },
//                         {
//                           $id: 'h0HxiSr8ff',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '_O2CNnC1pV',
//                           elements: [],
//                         },
//                         {
//                           $id: 'TwlkFifBos',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '_O2CNnC1pV',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'VFW--MkQsX',
//                     },
//                   ],
//                   parentId: 'GcU9xioWyx',
//                   sx: {
//                     flexBasis: 'calc(33.3333% - 5px)',
//                   },
//                 },
//                 {
//                   componentId: 'sample-element-4',
//                   props: {
//                     children: 'Sample Element 4',
//                   },
//                   $id: 'dbXNJeOe9X',
//                   elements: [
//                     {
//                       $id: 'sample-element-1',
//                       componentId: 'sample-element',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'sample-element-11',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-1',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-21',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-1',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-31',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-1',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       $id: 'sample-element-2',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'sample-element-23',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-2',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-33',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-2',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       $id: 'sample-element-3',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'sample-element-14',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-24',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-34',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'sample-element-13',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'DjN99GbZ1l',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'LAx_7MXv4f',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'q-iGlGzFze',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'ChYfnEHyke',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'sample-element-3',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'uIFTP_9H6R',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'vKe5A_A9rZ',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'TTrxD4NgJ-',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '3krjgMeukQ',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'D4M3tHrWvU',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'Isgs-WzMJ0',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'XM_ECeBSwk',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'E53yJCXGmC',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'QbIwUypRz8',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '15fStWoHxy',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'y3Z2fSDNQB',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'CkJRw_PqE5',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'jRVFfYwPEh',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'jn7Wjh4rJT',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'jlvgO0z8a3',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'ZsE-KjY_CN',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '88NwpbiagD',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'KBefhHclDT',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'SwK6fU4Hh_',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'nP6PkFLkKY',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'QOQ9oraIEE',
//                       elements: [],
//                       parentId: 'dbXNJeOe9X',
//                     },
//                   ],
//                   parentId: 'GcU9xioWyx',
//                   sx: {
//                     flexBasis: 'calc(33.3333% - 10px)',
//                   },
//                 },
//                 {
//                   componentId: 'sample-element-4',
//                   props: {
//                     children: 'Sample Element 4',
//                   },
//                   $id: 'JI0MC_w0x8',
//                   elements: [
//                     {
//                       $id: 'w4V9650Zs6',
//                       componentId: 'sample-element',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'uNYGNgAkOa',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'w4V9650Zs6',
//                           elements: [],
//                         },
//                         {
//                           $id: 'jr7lyFz0Ow',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'w4V9650Zs6',
//                           elements: [],
//                         },
//                         {
//                           $id: 'QYc5C9ChMb',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'w4V9650Zs6',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       $id: 'pfEs-zEofk',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: '9I1ymgpJo2',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'pfEs-zEofk',
//                           elements: [],
//                         },
//                         {
//                           $id: '8UjOXFGKTI',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'pfEs-zEofk',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       $id: '-f_NVBf9AA',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'iWoiRAVGOr',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: 'eb4vXbuFPv',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: 'acBxjPqKAE',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: '6CnNUGDIPF',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: '1CDV3UstZV',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: 'tYMeMzk1_6',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: 'ydQG9ns_s6',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                         {
//                           $id: 'v1LrmwM516',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '-f_NVBf9AA',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '0Tnj8BVsgn',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '8T1uOqFvr9',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'wVRgA8W0PV',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'V-F4LXshZc',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'RGbNZySaZP',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'R2ttxkTSoH',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'fd6F9AZjl3',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'juQw721iM5',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'Ksavdu-Bp1',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '2M8zbiJS87',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '7piMGr6gxe',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '7QjqWi_UXD',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '9uCKmVppR5',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'VAXoCRdDn7',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'yUHM9fo3P_',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'RxX1EdqbBj',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'hIWP6P_9K-',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'dFnShw4ZhT',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: '2KfcFdBgpr',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'qe2fgiXpUX',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                     {
//                       componentId: 'button',
//                       bundleId: 'mui',
//                       props: {
//                         variant: 'outlined',
//                         children: 'Click Me',
//                         fullWidth: false,
//                         disabled: false,
//                       },
//                       $id: 'usYvXxFPKd',
//                       elements: [],
//                       parentId: 'JI0MC_w0x8',
//                     },
//                   ],
//                   parentId: 'GcU9xioWyx',
//                   sx: {
//                     flexBasis: 'calc(33.3333% - 5px)',
//                   },
//                 },
//                 {
//                   componentId: 'sample-element-4',
//                   props: {
//                     children: 'Sample Element 4',
//                   },
//                   $id: 'WGw_Ob_nmm',
//                   elements: [
//                     {
//                       $id: '021VTIX5f3',
//                       componentId: 'sample-element',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'w4jcRdnKRK',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '021VTIX5f3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'KU_6ycCHEf',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '021VTIX5f3',
//                           elements: [],
//                         },
//                         {
//                           $id: 'LNloM08M9H',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '021VTIX5f3',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'WGw_Ob_nmm',
//                     },
//                     {
//                       $id: '8PHx7xa5ic',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: '8KyiY3QYhJ',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '8PHx7xa5ic',
//                           elements: [],
//                         },
//                         {
//                           $id: 'W09zfKS3bh',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: '8PHx7xa5ic',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'WGw_Ob_nmm',
//                     },
//                     {
//                       $id: 'fL_BZBegP6',
//                       componentId: 'sample-element-4',
//                       props: {},
//                       elements: [
//                         {
//                           $id: 'P7Z5ESY4cs',
//                           componentId: 'sample-element-1',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'fL_BZBegP6',
//                           elements: [],
//                           sx: {
//                             color: 'rgb(255, 0, 0)',
//                           },
//                         },
//                         {
//                           $id: 'I-lkPUObax',
//                           componentId: 'sample-element-2',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'fL_BZBegP6',
//                           elements: [],
//                         },
//                         {
//                           $id: 'e3SulFsbdY',
//                           componentId: 'sample-element-3',
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'fL_BZBegP6',
//                           elements: [],
//                         },
//                         {
//                           $id: 'aU3FVeRw1I',
//                           componentId: 'sample-element-1',
//                           sx: {
//                             fontWeight: 'fontWeightBold',
//                           },
//                           props: {
//                             children: 'hello',
//                           },
//                           parentId: 'fL_BZBegP6',
//                           elements: [],
//                         },
//                       ],
//                       parentId: 'WGw_Ob_nmm',
//                     },
//                   ],
//                   parentId: 'GcU9xioWyx',
//                   sx: {
//                     flexBasis: '50%',
//                   },
//                 },
//               ],
//               parentId: 'c9VVN89fx1',
//             },
//           ],
//           parentId: '_@_',
//           sx: {
//             paddingTop: '72px',
//             paddingBottom: '72px',
//           },
//           nodes: [],
//         },
//       ],
//       createdAt: {
//         _seconds: 1653736120,
//         _nanoseconds: 116000000,
//       },
//       $id: 'xBnkO4KyZC',
//     },
//   },
// }
