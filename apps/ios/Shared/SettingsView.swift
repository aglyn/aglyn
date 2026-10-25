// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynScreens
import AglynUI
import SwiftUI

/// Your account's settings (the account menu's Settings): profile, email addresses, security, notifications and sound,
/// support, and signing out. Workspace and site settings are their own modes in the sidebar now (One way in), so they
/// are not repeated here.
struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation: ShellNavigation?
  @State private var confirmSignOut = false

  /// The account's own pages (`account.screens.json`), in their order.
  private var accountScreens: [ScreenSpec] { ScreenCatalog.shared.group("account") }

  var body: some View {
    Form {
      Section {
        HStack(spacing: 12) {
          AglynAccountAvatar(initials: AccountIdentity(model: model).initials, size: 44)
          VStack(alignment: .leading, spacing: 2) {
            Text(AccountIdentity(model: model).name).font(AglynFont.headline)
            if let email = model.auth?.user?.email { Text(email).font(AglynFont.subheadline).foregroundStyle(.secondary) }
          }
        }
        .accessibilityElement(children: .combine)
      }
      if let navigation, !accountScreens.isEmpty {
        Section("Your account") {
          ForEach(accountScreens) { screen in
            Button {
              navigation.push(.screen(screen.id, [:]))
            } label: {
              AglynRow(screen.label, subtitle: screen.subtitle, systemImage: screen.icon) {
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
              }
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("settings-\(screen.id)")
          }
        }
      }
      Section {
        AglynPushLink {
          NotificationSettingsView()
        } label: {
          AglynRow("Notifications and sound", subtitle: "What reaches you, where, and how it sounds", systemImage: "bell.badge")
        }
        .accessibilityIdentifier("settings-notifications")
      }
      // Aglyn POS: the register's own screens (card readers…), once a store is open.
      if model.app == .pos, model.workspace?.site != nil {
        let screens = model.registry.screens(for: .pos, placement: .menu)
        if !screens.isEmpty {
          Section("Register") {
            ForEach(screens, id: \.id) { screen in
              AglynPushLink {
                // The Mac's Settings window has no shell navigation of its own.
                PluginScreenView(screenID: screen.id).environment(navigation ?? ShellNavigation())
              } label: {
                Label(screen.title, systemImage: screen.icon ?? "square.grid.2x2")
              }
              .accessibilityIdentifier("settings-\(screen.id)")
            }
          }
        }
      }
      #if os(iOS)
        // On the Mac these are the Help menu's, opening in the main window rather than the Settings window.
        HelpSection()
      #endif
      Section("About") {
        LabeledContent("Version", value: AppVersion.current)
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
    .aglynFormBackground()
    .navigationTitle("Settings")
    .signOutConfirmation(isPresented: $confirmSignOut)
  }
}
