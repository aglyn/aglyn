// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI
import UserNotifications

/// Which notifications reach this device: one switch per type, grouped by
/// category, stored at the account scope as
/// `users/{uid}.notificationSettings.accountTypes.{type}.push`, the same
/// settings document and layering the console's notification settings use.
/// A type nobody answered for follows the notification feed, which is what
/// its switch shows until it is changed.
struct NotificationSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var profile: FirestoreDocument?
  @State private var loaded = false
  @State private var failed = false
  @State private var saveFailed = false
  /// Answers saved from this screen, shown before the document echoes them back.
  @State private var pending: [String: Bool] = [:]
  @State private var listener: FirestoreListening?

  private let catalog = NotificationCatalog.shared

  private var settings: [String: Any]? { profile?.data["notificationSettings"] as? [String: Any] }
  private var legacy: [String: Any]? { profile?.data["notificationPrefs"] as? [String: Any] }

  var body: some View {
    Form {
      Section {
        Text("Choose what this device is notified about. Anything you have not changed follows your notification feed.")
          .font(AglynFont.subheadline)
          .foregroundStyle(.secondary)
        if model.push.authorization == .denied {
          Label("Notifications are turned off for \(model.brandName) in this device's settings.", systemImage: "bell.slash")
            .foregroundStyle(AglynColor.warning)
          #if os(iOS)
            Button("Open Settings") {
              if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
          #endif
        }
        if saveFailed {
          Label("That change did not save. Try again.", systemImage: "exclamationmark.circle")
            .foregroundStyle(AglynColor.error)
        }
      }
      if failed {
        Section {
          AglynEmptyState("Could not load your settings", systemImage: "exclamationmark.triangle")
        }
      } else if !loaded {
        Section { SkeletonRows(count: 4) }
      } else {
        ForEach(catalog.categories) { category in
          Section(category.label) {
            ForEach(category.types) { entry in
              Toggle(entry.label, isOn: binding(entry, category: category.id))
                .accessibilityIdentifier("push-\(entry.type)")
            }
          }
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle("Notifications")
    .onAppear(perform: start)
    .onDisappear {
      listener?.remove()
      listener = nil
    }
  }

  private func binding(_ entry: NotificationCatalog.Entry, category: String) -> Binding<Bool> {
    Binding(
      get: {
        pending[entry.type]
          ?? accountPushSwitch(
            settings: settings, type: entry.type, category: category, consoleDefault: entry.consoleDefault,
            legacyPrefs: legacy)
      },
      set: { next in save(entry.type, next) })
  }

  private func start() {
    guard listener == nil, let uid = model.auth?.user?.uid, let reader = model.reader else { return }
    listener = reader.listenDocument(["users", uid]) { result in
      switch result {
      case .success(let document):
        profile = document
        loaded = true
        failed = false
        pending = [:]
      case .failure:
        failed = true
      }
    }
  }

  private func save(_ type: String, _ next: Bool) {
    guard let uid = model.auth?.user?.uid, let reader = model.reader else { return }
    pending[type] = next
    saveFailed = false
    Task {
      do {
        // A nested map, not a dotted path: a type id has a dot of its own
        // (`content.order`), which a dotted path would split into two keys.
        try await reader.setDocument(
          ["users", uid], ["notificationSettings": ["accountTypes": [type: ["push": next]]]], merge: true)
      } catch {
        pending[type] = nil
        saveFailed = true
      }
    }
  }
}
