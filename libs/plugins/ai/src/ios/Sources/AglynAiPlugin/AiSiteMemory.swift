// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The host subcollection the preferences live in (`AI_SITE_MEMORY_SUBCOLLECTION`).
public let aiSiteMemorySubcollection = "aiMemory"

/// At most this many are kept per site (`AI_SITE_MEMORY_MAX`).
public let aiSiteMemoryMax = 12

/// A stored preference: what Aglyn AI learned from an edit the owner applied.
public struct AiSitePreference: Identifiable, Equatable, Sendable {
  public let id: String
  public let text: String
  public let count: Int
  public let lastSeenAtMs: Double
}

private func number(_ value: Any?) -> Double? {
  if let number = value as? NSNumber, !(value is Bool) { return number.doubleValue }
  if let text = value as? String { return Double(text.trimmingCharacters(in: .whitespaces)) }
  return nil
}

/// A stored row as a preference; nil for one this version cannot read (`aiSitePreferenceOf`).
public func aiSitePreferenceOf(id: String, raw: [String: Any]?) -> AiSitePreference? {
  let text = String(((raw?["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
  if text.isEmpty { return nil }
  let count = number(raw?["count"]).flatMap { $0.isFinite && $0 > 0 ? Int($0.rounded(.down)) : nil } ?? 1
  let last = number(raw?["lastSeenAtMs"]).flatMap { $0.isFinite ? $0 : nil } ?? 0
  return AiSitePreference(id: id, text: text, count: count, lastSeenAtMs: last)
}

/// Most repeated first, then the most recent: the order the console lists them.
public func aiSitePreferences(_ rows: [FirestoreDocument]) -> [AiSitePreference] {
  rows.compactMap { aiSitePreferenceOf(id: $0.id, raw: $0.data) }.sorted {
    $0.count != $1.count ? $0.count > $1.count : $0.lastSeenAtMs > $1.lastSeenAtMs
  }
}

/// "Seen in 1 applied edit", "Seen in 3 applied edits".
public func aiSitePreferenceSeen(_ count: Int) -> String { count == 1 ? "Seen in 1 applied edit" : "Seen in \(count) applied edits" }

/// What Aglyn AI learned from this site's edits, on Setup → Business profile (the console's `hostBusinessProfile`
/// widget): the short preferences the assist edit route distilled from the edits the owner applied, which every later AI
/// job for the site reads. The owner reads them here and forgets one, or all of them.
///
/// Read and deleted from the client: the rules let a site's members read and delete `aiMemory` and refuse them a create
/// or an update, because a client write would put words of their choosing into later prompts.
struct AiSiteMemoryCard: View {
  let context: NativePluginContext
  @State private var live = LiveQuery()
  @State private var runner = ActionRunner(roleHint: "an author, editor or admin")
  @State private var clearing = false

  private var preferences: [AiSitePreference] { aiSitePreferences(live.state.value ?? []) }

  var body: some View {
    let preferences = preferences
    return Section {
      if let error = runner.error { AglynNotice(error, tone: .error) { runner.clear() } }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.clear() } }
      if preferences.isEmpty {
        Text(
          live.state.isLoading
            ? "Loading…"
            : "Nothing learned yet. When you apply an Assist edit that shows a preference, such as shorter copy or no emoji, it appears here."
        )
        .foregroundStyle(.secondary)
      } else {
        ForEach(preferences) { preference in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(preference.text)
              Text(aiSitePreferenceSeen(preference.count)).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Forget") { forget(preference) }
              .buttonStyle(.borderless)
              .disabled(runner.busy)
              .accessibilityIdentifier("ai-memory-forget-\(preference.id)")
          }
        }
      }
    } header: {
      HStack {
        Text("What Aglyn AI learned")
        Spacer()
        if !preferences.isEmpty {
          Button("Forget all") {
            runner.clear()
            clearing = true
          }
          .font(AglynFont.caption)
          .disabled(runner.busy)
          .accessibilityIdentifier("ai-memory-forget-all")
        }
      }
    } footer: {
      Text("Short preferences from the edits you applied with Assist. Every AI job for this site reads them.")
    }
    .accessibilityIdentifier("ai-site-memory")
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      await live.bind(context.firestore, FirestoreQuery(["hosts", hostID, aiSiteMemorySubcollection], limit: aiSiteMemoryMax * 2))
    }
    .confirmationDialog("Forget everything Aglyn AI learned here?", isPresented: $clearing, titleVisibility: .visible) {
      Button("Forget all", role: .destructive) { forgetAll(preferences) }
    } message: {
      Text("Later AI jobs for this site stop using these preferences. Aglyn AI learns again from the edits you apply next.")
    }
  }

  private func forget(_ preference: AiSitePreference) {
    guard let hostID = context.hostID else { return }
    let reader = context.firestore
    runner.run("Aglyn AI will no longer use that preference.") {
      try await reader.deleteDocument(["hosts", hostID, aiSiteMemorySubcollection, preference.id])
    }
  }

  private func forgetAll(_ preferences: [AiSitePreference]) {
    guard let hostID = context.hostID else { return }
    let reader = context.firestore
    runner.run("Aglyn AI forgot what it learned on this site.") {
      for preference in preferences { try await reader.deleteDocument(["hosts", hostID, aiSiteMemorySubcollection, preference.id]) }
    }
  }
}
