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

import * as Aglyn from '@aglyn/aglyn/server'
import type { SitePageEnricher } from '@aglyn/aglyn/server'
import getVariables from '@aglyn/tenant-runtime/get-variables'
import * as MarketingModel from '../model'
import { getClientAutomations, type ClientAutomation } from './get-client-automations'
import { getScreenExperiments, type ScreenExperiment } from './get-screen-experiments'
import getOverlays from './get-overlays'

/**
 * Marketing contributions to a rendered site page (AGL-418), relocated
 * verbatim from the tenant loader: overlays (announcement bar + popup with
 * server-resolved binding tokens, AGL-195/196/251), site-event automations
 * (AGL-256/257), and screen/section experiments (AGL-253). Every block is
 * entitlement-gated on the owning org's plan exactly as before; the shapes
 * written here are the wire contract the tenant page runtime consumes.
 */
export const marketingSitePageEnricher: SitePageEnricher = async ({
  hostId,
  host,
  org,
  path,
  screenId,
  screen,
}) => {
  // Marketing overlays (AGL-195/196/247): marketingOverlays-gated on the
  // effective plan (plan-less = free = no overlays); binding tokens
  // resolve server-side so the client ships plain text.
  const overlaysEntitled = Aglyn.resolveOrgEntitlements(org).features
    .marketingOverlays
  const contentHash = (value: string) => {
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0
    }
    return Math.abs(hash).toString(36)
  }
  // Marketing hub overlays (AGL-251): scheduled/targeted overlay docs
  // win over the legacy single announcementBar/popup host fields.
  const overlayPath = `/${path.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  const overlayDocs = overlaysEntitled ? await getOverlays({ hostId }) : []
  const activeOverlays = MarketingModel.resolveActiveOverlays(overlayDocs, {
    path: overlayPath,
  })
  const barConfig: Aglyn.HostAnnouncementBar | undefined = activeOverlays.bar
    ? { enabled: true, ...activeOverlays.bar.bar }
    : ((host as any)?.announcementBar as
        | Aglyn.HostAnnouncementBar
        | undefined)
  const popupConfig: Aglyn.HostPopup | undefined = activeOverlays.popup
    ? {
        enabled: true,
        ...activeOverlays.popup.popup,
        ...(activeOverlays.popup.startAtMs
          ? { startAtMs: activeOverlays.popup.startAtMs }
          : {}),
        ...(activeOverlays.popup.endAtMs
          ? { endAtMs: activeOverlays.popup.endAtMs }
          : {}),
      }
    : ((host as any)?.popup as Aglyn.HostPopup | undefined)
  const overlayVariables =
    overlaysEntitled &&
    ((barConfig?.enabled && barConfig.text) ||
      (popupConfig?.enabled && popupConfig.body))
      ? await getVariables({ hostId })
      : {}
  let announcementBar: Record<string, unknown> | null = null
  if (overlaysEntitled && barConfig?.enabled && barConfig.text) {
    const text = Aglyn.resolveBindings(barConfig.text, overlayVariables)
    announcementBar = {
      text,
      ...(barConfig.href ? { href: barConfig.href } : {}),
      ...(barConfig.backgroundColor
        ? { backgroundColor: barConfig.backgroundColor }
        : {}),
      ...(barConfig.textColor ? { textColor: barConfig.textColor } : {}),
      dismissible: barConfig.dismissible !== false,
      contentHash: contentHash(text),
      ...(activeOverlays.bar?.$id
        ? { overlayId: activeOverlays.bar.$id }
        : {}),
    }
  }
  let popup: Record<string, unknown> | null = null
  if (overlaysEntitled && popupConfig?.enabled && popupConfig.body) {
    const body = Aglyn.resolveBindings(popupConfig.body, overlayVariables)
    const headline = popupConfig.headline
      ? Aglyn.resolveBindings(popupConfig.headline, overlayVariables)
      : undefined
    popup = {
      ...(headline ? { headline } : {}),
      body,
      ...(popupConfig.imageUrl ? { imageUrl: popupConfig.imageUrl } : {}),
      ...(popupConfig.ctaLabel ? { ctaLabel: popupConfig.ctaLabel } : {}),
      ...(popupConfig.ctaHref ? { ctaHref: popupConfig.ctaHref } : {}),
      trigger: popupConfig.trigger ?? 'delay',
      triggerValue: Number(popupConfig.triggerValue ?? 3),
      frequencyDays: Math.max(1, Number(popupConfig.frequencyDays ?? 7)),
      ...(popupConfig.collectEmail ? { collectEmail: true } : {}),
      ...(popupConfig.startAtMs ? { startAtMs: popupConfig.startAtMs } : {}),
      ...(popupConfig.endAtMs ? { endAtMs: popupConfig.endAtMs } : {}),
      contentHash: contentHash(`${headline ?? ''}|${body}`),
      ...(activeOverlays.popup?.$id
        ? { overlayId: activeOverlays.popup.$id }
        : {}),
    }
  }

  // Site-event automations (AGL-256): actions-gated; runJs steps are
  // business-gated (webhooks flag marks the tier).
  const actionsEntitled = Aglyn.resolveOrgEntitlements(org).features
    .actions
  const clientAutomations: ClientAutomation[] = actionsEntitled
    ? await getClientAutomations({
        hostId,
        path: overlayPath,
        allowJs: Aglyn.resolveOrgEntitlements(org).features.webhooks,
      })
    : []
  // Screen/section experiments (AGL-253): Business-gated; composing a
  // tree per divergent variant is bounded (≤4) and ISR-cached.
  const experiments: ScreenExperiment[] =
    Aglyn.resolveOrgEntitlements(org).features.abTesting &&
    screenId &&
    screen
      ? await getScreenExperiments({ hostId, screenId, screen })
      : []

  // Overlay payloads showOverlay steps reference (AGL-257).
  const automationOverlays: Record<string, any> = {}
  for (const automation of clientAutomations) {
    for (const step of automation.steps) {
      if (step.type === 'showOverlay' && step.overlayId) {
        const overlay = overlayDocs.find(
          (candidate) => candidate.$id === step.overlayId,
        )
        if (overlay) {
          automationOverlays[step.overlayId] = {
            kind: overlay.kind,
            ...(overlay.bar ? { bar: overlay.bar } : {}),
            ...(overlay.popup ? { popup: overlay.popup } : {}),
          }
        }
      }
    }
  }

  return {
    announcementBar,
    popup,
    clientAutomations: JSON.parse(JSON.stringify(clientAutomations)),
    experiments: JSON.parse(JSON.stringify(experiments)),
    automationOverlays: Object.keys(automationOverlays).length
      ? JSON.parse(JSON.stringify(automationOverlays))
      : null,
  }
}
