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

/**
 * The owners' delivery as the risk notice recorded it (AGL-3441):
 * `delivery.owners` on `riskNotices/{id}`, carried by
 * `/api/admin/abuse-reports` as `riskNotice.ownersDelivery`.
 */
export interface RiskNoticeOwnerDelivery {
  recipients: number
  emailed: number
  emailFailed: number
  inApp: number
  emailSkipped: string | null
  digested: boolean
}

/**
 * What the owners were actually told about a risk row (AGL-3441), from the
 * notice's delivery record. The raise stamp alone reads "told" for a banned
 * owner whose every send was refused (AGL-3420), which is the one case where
 * staff most need to know nothing went out.
 */
export function ownerNoticeCaption(notice: {
  ownersNotifiedAtMs: number | null
  ownersDelivery: RiskNoticeOwnerDelivery | null
}): string {
  if (!notice.ownersNotifiedAtMs) {
    return 'Filed before owner notices existed: the workspace was not told about this row.'
  }
  const at = new Date(notice.ownersNotifiedAtMs).toLocaleString()
  const delivery = notice.ownersDelivery
  if (!delivery) {
    return `A notice to the workspace's owners and admins was raised on ${at}; what reached them could not be read from the notice.`
  }
  if (delivery.digested) {
    return `The notice raised on ${at} was folded into the owners' hourly summary rather than sent on its own.`
  }
  const inApp = delivery.inApp ? ' Only the in-app copy was written.' : ''
  if (delivery.emailed) {
    const refused = delivery.emailFailed
      ? `, ${delivery.emailFailed} refused`
      : ''
    return `The workspace's owners and admins were emailed on ${at} (${delivery.emailed} sent${refused}), in the risk notice's own words — never the evidence below.`
  }
  if (delivery.emailFailed) {
    const sends =
      delivery.emailFailed === 1 ? 'the one send was' : `all ${delivery.emailFailed} sends were`
    return `No email reached the workspace's owners or admins: on ${at} ${sends} refused — a ban, a suppression or a provider error.${inApp}`
  }
  return `The owners were not emailed on ${at}: ${delivery.emailSkipped ?? 'nothing was sent'}${inApp}`
}
