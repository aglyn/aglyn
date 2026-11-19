// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// The console page view's Publishing schedule and Page Access cards (AGL-113, AGL-4086), as sections of the page's
// details. The Kotlin kit's PageSettingsScreens.kt.

/// Whether the workspace's plan carries scheduled publishing; nil while the workspace is still being read.
@MainActor
@Observable
final class SchedulingPlan {
  let org = LiveDocument()

  var carried: Bool? {
    guard case .ready(let doc) = org.state else { return nil }
    return planFeatureCarried(doc?.data, scheduledPublishingFeature)
  }

  /// The console's sentence for a locked control: "Scheduled publishing is included from Business."
  var lockReason: String {
    PlanFeatureDefaults.grantedFrom[scheduledPublishingFeature].map { "Scheduled publishing is included from \($0)." }
      ?? "Scheduled publishing is a paid add-on."
  }

  /// The console's upsell under the schedule buttons.
  var upsell: String {
    "Schedule this page to go live, or come down, at a set date and time."
      + (PlanFeatureDefaults.grantedFrom[scheduledPublishingFeature].map { " Included from \($0)." } ?? "")
  }
}

/// The page's schedule: the pending publish or unpublish (cancel it), a schedule that came due and did not run
/// (dismiss it), and Schedule publish / Schedule unpublish, locked with the console's upsell on a plan without it.
struct PageScheduleSection: View {
  let context: NativePluginContext
  let page: PageNode
  let live: Bool
  let settings: PageSettings
  let plan: SchedulingPlan
  let api: PageSettingsAPI
  let runner: ActionRunner
  let canPublish: Bool
  let open: (PageSheet) -> Void

  var body: some View {
    let locked = plan.carried == false
    let ready = plan.carried != nil
    Section("Schedule") {
      if let pending = settings.pending {
        AglynRow(pageScheduleLabel(pending), systemImage: "calendar.badge.clock") {
          Button("Cancel") { cancel("Schedule canceled") }
            .buttonStyle(.borderless)
            .disabled(!canPublish || runner.busy)
            .accessibilityIdentifier("page-schedule-cancel")
        }
        .accessibilityIdentifier("page-schedule-pending")
      }
      if let skipped = settings.skippedLabel {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack {
            StatusChip(skipped, tone: .warning)
            Spacer(minLength: 0)
            Button("Dismiss") { cancel("Schedule canceled") }
              .buttonStyle(.borderless)
              .disabled(!canPublish || runner.busy)
          }
          AglynHelperText(settings.skippedHelp)
        }
        .accessibilityIdentifier("page-schedule-skipped")
      }
      // Side by side where they fit; on a phone, one under the other rather than each wrapped onto two lines.
      ViewThatFits(in: .horizontal) {
        HStack(spacing: AglynSpace.two) { scheduleButtons(ready: ready, locked: locked) }
        VStack(alignment: .leading, spacing: AglynSpace.one) { scheduleButtons(ready: ready, locked: locked) }
      }
      .buttonStyle(.borderless)
      if locked {
        AglynUpgradeNotice(plan.upsell, action: planUpgradeAction { context.navigate("core.billing.plans") })
      } else if !canPublish {
        AglynHelperText("Your role on this site can edit content but not publish it.")
      }
    }
  }

  @ViewBuilder
  private func scheduleButtons(ready: Bool, locked: Bool) -> some View {
    Button("Schedule publish", systemImage: "calendar") {
      open(.schedule(page, unpublish: false, versionID: nil))
    }
    .fixedSize()
    .disabled(!canPublish || !ready || locked || page.versionID == nil)
    .accessibilityIdentifier("page-schedule-publish")
    Button("Schedule unpublish", systemImage: "calendar") {
      open(.schedule(page, unpublish: true, versionID: nil))
    }
    .fixedSize()
    .disabled(!canPublish || !ready || locked || !live)
    .accessibilityIdentifier("page-schedule-unpublish")
  }

  private func cancel(_ message: String) {
    runner.run(message) { try await api.cancelSchedule(page.id) }
  }
}

/// Who may see the page: the visibility, the page password, and the per-page preview switch.
struct PageAccessSection: View {
  let page: PageNode
  let livePath: String?
  let settings: PageSettings
  let host: [String: Any]?
  let api: PageSettingsAPI
  let runner: ActionRunner
  let canEdit: Bool
  let canPublish: Bool
  @State private var password = ""

  var body: some View {
    let inPreview = isPageInPreview(host, pageID: page.id)
    Section("Page access") {
      Picker(
        "Visibility",
        selection: Binding(
          get: { settings.visibility },
          set: { next in if let next, next != settings.visibility { setVisibility(next) } })
      ) {
        if settings.visibility == nil { Text("Other").tag(PageVisibility?.none) }
        ForEach(PageVisibility.allCases) { option in Text(option.label).tag(Optional(option)) }
      }
      .disabled(!canEdit || runner.busy)
      .accessibilityIdentifier("page-visibility")
      if let hint = settings.visibility?.hint { AglynHelperText(hint) }
      if settings.visibility == .password {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack {
            SecureField("Page password", text: $password)
              #if os(iOS)
                .textContentType(.newPassword)
              #endif
              .accessibilityIdentifier("page-password")
            Button("Save", systemImage: "lock") { savePassword() }
              .buttonStyle(.borderless)
              .disabled(!canEdit || runner.busy)
              .accessibilityIdentifier("page-password-save")
          }
          AglynHelperText(
            settings.hasPassword
              ? "A password is set — save a new one to change it." : "Save a password to protect this page.")
        }
      }
      Toggle(
        "Preview — only your team can see this page",
        isOn: Binding(get: { inPreview }, set: { setPreview($0) })
      )
      .disabled(!canPublish || runner.busy)
      .accessibilityIdentifier("page-preview-switch")
      AglynHelperText(pagePreviewCaption(siteInPreview: isSiteInPreview(host), pageInPreview: inPreview))
      AglynHelperText("Per-user editor permissions arrive with the team user manager.")
    }
  }

  private func setVisibility(_ next: PageVisibility) {
    let had = settings.hasPassword
    runner.run("Page access updated") {
      try await api.setVisibility(page.id, next, hadPassword: had, livePath: livePath)
    }
  }

  private func savePassword() {
    let value = password
    let set = !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    runner.run(set ? "Password protection enabled" : "Password protection removed") {
      try await api.setPassword(page.id, value, livePath: livePath)
      password = ""
    }
  }

  private func setPreview(_ enabled: Bool) {
    runner.run(enabled ? "Only your team can see this page now" : "This page is public once it is published") {
      try await api.setPreview(page.id, enabled)
    }
  }
}

/// Schedule publication / Schedule unpublish: a version (publishing) and a future time.
struct PageScheduleSheet: View {
  let context: NativePluginContext
  let hostID: String
  let page: PageNode
  let unpublish: Bool
  let presetVersionID: String?
  let api: PageSettingsAPI
  let runner: ActionRunner
  let close: () -> Void
  @State private var versions = LiveQuery()
  @State private var versionID = ""
  @State private var at = defaultScheduleTime()

  var body: some View {
    let future = at > Date()
    AglynActionSheet(
      unpublish ? "Schedule unpublish" : "Schedule publication",
      message: unpublish
        ? "The page goes offline once the time passes (applied on the next site refresh). Only one pending schedule "
          + "exists per page."
        : "The selected version becomes the live version at the chosen time (applied on the next site refresh after it "
          + "passes). Only one pending schedule exists per page.",
      confirmLabel: "Schedule", confirmEnabled: future && (unpublish || !versionID.isEmpty), busy: runner.busy,
      error: runner.error, onCancel: close
    ) {
      let (time, version) = (at, versionID)
      runner.run("Scheduled to \(unpublish ? "unpublish" : "publish") \(time.formatted(date: .abbreviated, time: .shortened))", onDone: close) {
        try await api.schedule(page.id, unpublish: unpublish, versionID: version, at: time)
      }
    } fields: {
      if !unpublish {
        Picker("Version", selection: $versionID) {
          if case .ready(let docs) = versions.state {
            let rows = docs.map(PageVersion.init)
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, version in
              Text(version.name ?? "Version \(rows.count - index)").tag(version.id)
            }
          }
        }
        .accessibilityIdentifier("page-schedule-version")
      }
      DatePicker(unpublish ? "Unpublish at" : "Publish at", selection: $at)
        .accessibilityIdentifier("page-schedule-at")
      if !future { AglynHelperText("Pick a future date/time", isError: true) }
    }
    .onAppear { if versionID.isEmpty { versionID = presetVersionID ?? page.versionID ?? "" } }
    .task(id: page.id) {
      guard !unpublish else { return }
      await versions.bind(
        context.firestore,
        FirestoreQuery(
          ["hosts", hostID, "screens", page.id, "versions"], order: [.init("createdAt", descending: true)], limit: 20))
    }
  }
}
