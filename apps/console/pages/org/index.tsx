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

import type { GetServerSideProps } from 'next'
import { buildRoute, Route } from '../../constants/route-links'

/**
 * /org has no content of its own — without this page the path would fall
 * through to the [hostId] catch-all as a phantom host (AGL-236).
 */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: buildRoute(Route.MANAGE_TEAM), permanent: false },
})

const OrgIndex = () => null
OrgIndex.displayName = 'Page:OrgIndex'
export default OrgIndex
