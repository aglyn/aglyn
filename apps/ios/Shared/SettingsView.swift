// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import SwiftUI

/// The account, the picked workspace, and signing out.
struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation: ShellNavigation?
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
      if model.app == .aglyn, let navigation {
        ForEach(CoreGroupList.groups(model), id: \.id) { group in
          Section(group.heading) {
            ForEach(group.screens) { screen in
              Button {
                navigation.push(.screen(screen.id, [:]))
              } label: {
                AglynRow(screen.label, subtitle: screen.subtitle, systemImage: screen.icon) {
                  Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
                }
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("settings-\(screen.id)")
            }
          }
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

/// The core screen groups Settings lists (shared by both app targets).
enum CoreGroupList {
  struct Group {
    let id: String
    let heading: String
    let screens: [ScreenSpec]
  }

  @MainActor
  static func groups(_ model: AppModel) -> [Group] {
    var picks: [(String, String)] = [("workspace", model.workspace?.org?.name ?? "Workspace")]
    if let site = model.workspace?.site { picks.append(("site", "Site · \(site.name)")) }
    picks.append(("account", "Your account"))
    if model.claims.isStaff { picks.append(("staff", "Staff")) }
    return picks.map { Group(id: $0.0, heading: $0.1, screens: ScreenCatalog.shared.group($0.0)) }.filter { !$0.screens.isEmpty }
  }
}
