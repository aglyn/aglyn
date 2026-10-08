// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// The account, the picked workspace, and signing out.
struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var confirmSignOut = false

  var body: some View {
    Form {
      Section("Account") {
        LabeledContent("Signed in as", value: model.auth?.user?.email ?? "—")
        if let name = model.auth?.user?.displayName, !name.isEmpty {
          LabeledContent("Name", value: name)
        }
      }
      if let workspace = model.workspace {
        Section("Workspace") {
          LabeledContent("Workspace", value: workspace.org?.name ?? "None")
          LabeledContent(model.app == .pos ? "Store" : "Site", value: workspace.site?.name ?? "None")
          LabeledContent("Role", value: workspace.org?.role.capitalized ?? "—")
        }
      }
      Section {
        NavigationLink {
          NotificationSettingsView()
        } label: {
          Label("Notifications", systemImage: "bell.badge")
        }
        .accessibilityIdentifier("settings-notifications")
      }
      Section("About") {
        LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
        if let origin = model.config?.consoleOrigin {
          LabeledContent("Console", value: origin)
        }
      }
      Section {
        Button("Sign out", role: .destructive) { confirmSignOut = true }
          .accessibilityIdentifier("settings-sign-out")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle("Settings")
    .confirmationDialog("Sign out of \(model.appName)?", isPresented: $confirmSignOut) {
      Button("Sign out", role: .destructive) { Task { await model.signOut() } }
    }
  }
}
