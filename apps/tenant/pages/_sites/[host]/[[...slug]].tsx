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

import getTenantPageStaticPaths from '../../../utils/get-tenant-page-static-paths'
import getTenantPageStaticProps from '../../../utils/get-tenant-page-static-props'

export const getStaticProps = async (context) => {
  console.log('!!!!!getStaticProps', context)

  // return {
  //   props: { params: context.params },
  //   revalidate: 30, // never=false, always=1, since=SECONDS
  // }
  return getTenantPageStaticProps(context)
}

export const getStaticPaths = async (context) => {
  console.log('!!!!!getStaticPaths props', context)
  // return {
  //   paths: [],
  //   fallback: 'blocking', // can also be true or 'blocking'
  // }
  return getTenantPageStaticPaths(context)
}

export default function CatchAllPage(props) {
  console.log('!!!!!CatchAllPage')
  return <>{JSON.stringify(props, null, 2)}</>
}
