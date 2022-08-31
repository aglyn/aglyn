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

// import {
//   getTenantPageStaticPaths,
//   getTenantPageStaticProps,
// } from '@aglyn/tenant-feature-instance'

export default function CatchAllPage(props) {
  console.log('!!!!!CatchAllPage')
  return <>{JSON.stringify(props, null, 2)}</>
}

export const getStaticPaths = async (context) => {
  console.log('!!!!!getStaticPaths props', context)
  return {
    paths: [
      { params: { host: 'aa', slug: ['bb', 'cc'] } },
      { params: { host: 'hh', slug: ['bb', 'cc'] } },
    ],
    fallback: false, // can also be true or 'blocking'
  }
  // return getTenantPageStaticPaths(context)
}

export const getStaticProps = async (context) => {
  console.log('!!!!!getStaticProps')
  return {
    props: { context },
    revalidate: 30, // never=false, always=1, since=SECONDS
  }
  // return getTenantPageStaticProps(context)
}
