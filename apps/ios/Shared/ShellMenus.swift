// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

// The menus that belong to their owner (AGL-3945, Figma Menus 2:4): your account's, behind your photo at the foot of the
// rail (a sheet on a phone), and the workspace's, behind its name in the sidebar.

/// Who is signed in, for the account menu's header and photo.
@MainActor
struct AccountIdentity {
  let model: AppModel

  var name: String { model.auth?.user?.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? model.auth?.user?.email ?? "You" }
  var email: String? { model.auth?.user?.email }
  var initials: String { accountInitials(name: model.auth?.user?.displayName, email: model.auth?.user?.email) }
}

/// The account menu's places, shared by the Mac and iPad menu and the phone's sheet.
@MainActor
enum AccountPlaces {
  static let settingsScreen = "core.account.profile"
  static let marketplaceScreen = "marketplace.sell"
  static let reportScreen = "core.support"

  static func documentation(_ model: AppModel) -> AglynWebPage? {
    HelpLink.all(model.config).first { $0.id == "docs" }.map { AglynWebPage($0.url) }
  }
}

/// The account menu's items, in Figma's order: Theme ▸, Settings, Marketplace, Documentation, Report an issue; then
/// the accounts signed in on this device (the one in use ticked) and Add account; then Sign out.
struct AccountMenuItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Binding var confirmSignOut: Bool

  var body: some View {
    let identity = AccountIdentity(model: model)
    Section {
      Text(identity.name)
      if let email = identity.email, email != identity.name { Text(email) }
    }
    Section {
      ThemeMenu()
      Button("Settings", systemImage: "gearshape") { navigation.push(.settings) }
      if model.app == .aglyn, model.registry.screen(AccountPlaces.marketplaceScreen) != nil {
        Button("Marketplace", systemImage: "storefront") { navigation.push(.screen(AccountPlaces.marketplaceScreen, [:])) }
      }
      if let docs = AccountPlaces.documentation(model) {
        Button("Documentation", systemImage: "book") { navigation.openWeb(docs) }
      }
      if model.registry.screen(AccountPlaces.reportScreen) != nil {
        Button("Report an issue", systemImage: "flag") { navigation.push(.screen(AccountPlaces.reportScreen, [:])) }
      }
    }
    AccountSwitchItems()
    Section {
      Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmSignOut = true }
    }
  }
}

/// The accounts signed in on this device, the one in use ticked, and Add account.
struct AccountSwitchItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    if let auth = model.auth {
      Section("Accounts") {
        ForEach(auth.accounts) { account in
          Button {
            Task { await auth.switchAccount(to: account.slot) }
          } label: {
            if account.slot == auth.activeSlot && auth.impersonation == nil {
              Label(account.displayName ?? account.email ?? "Account", systemImage: "checkmark")
            } else {
              Text(account.displayName ?? account.email ?? "Account")
            }
          }
          .accessibilityIdentifier("account-\(account.email ?? account.slot)")
        }
        if auth.canAddAccounts {
          Button("Add account", systemImage: "person.badge.plus") { navigation.showAddAccount = true }
            .accessibilityIdentifier("account-add")
        }
      }
    }
  }
}

/// Theme ▸: light, dark or the system's, saved on the account so it follows the person (Theming, Phase 4 adds the rest).
struct ThemeMenu: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    if let preferences = model.preferences {
      let appearance = Binding<AppAppearance>(
        get: { preferences.appTheme.appearance },
        set: { value in
          var theme = preferences.appTheme
          theme.appearance = value
          preferences.setAppTheme(theme)
        })
      Menu {
        Picker("Appearance", selection: appearance) {
          Label("Light", systemImage: "sun.max").tag(AppAppearance.light)
          Label("Dark", systemImage: "moon").tag(AppAppearance.dark)
          Label("Match system", systemImage: "circle.lefthalf.filled").tag(AppAppearance.system)
        }
        .pickerStyle(.inline)
        Divider()
        Button("Theme settings…", systemImage: "paintpalette") { navigation.push(.themeSettings) }
          .accessibilityIdentifier("account-theme-settings")
      } label: {
        Label("Theme", systemImage: "circle.lefthalf.filled")
      }
    }
  }
}

extension AppAppearance {
  /// The color scheme a window takes; nil follows the system.
  var colorScheme: ColorScheme? {
    switch self {
    case .light: .light
    case .dark: .dark
    default: nil
    }
  }
}

/// The account photo at the foot of the rail: opens the account menu.
struct AccountMenuButton: View {
  @Environment(AppModel.self) private var model
  @State private var confirmSignOut = false
  var size: CGFloat = 32

  var body: some View {
    Menu {
      AccountMenuItems(confirmSignOut: $confirmSignOut)
    } label: {
      AglynAccountAvatar(initials: AccountIdentity(model: model).initials, size: size)
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    // The rail names the account with its own bubble (AGL-3996), so no slow system help tag.
    .accessibilityLabel(AccountIdentity(model: model).name)
    .accessibilityIdentifier("rail-account")
    .signOutConfirmation(isPresented: $confirmSignOut)
  }
}

extension View {
  /// "Sign out of …?", naming the account, which signs out only the account in use.
  func signOutConfirmation(isPresented: Binding<Bool>) -> some View {
    modifier(SignOutConfirmation(isPresented: isPresented))
  }
}

private struct SignOutConfirmation: ViewModifier {
  @Environment(AppModel.self) private var model
  @Binding var isPresented: Bool

  func body(content: Content) -> some View {
    let others = (model.auth?.accounts.count ?? 1) > 1
    let who = model.auth?.user?.email ?? "this account"
    content.confirmationDialog(
      others ? "Sign out of \(who)?" : "Sign out of \(model.appName)?", isPresented: $isPresented, titleVisibility: .visible
    ) {
      Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        .accessibilityIdentifier("confirm-sign-out")
    } message: {
      if others { Text("Your other accounts stay signed in.") }
    }
  }
}

/// The workspace menu's items (its name ▾): who and what it is, Invite people, Workspace settings, Billing and usage,
/// Workspace color ▸.
struct WorkspaceMenuItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    if let org = model.workspace?.org {
      Section {
        Text(org.name)
        if let plan = model.workspace?.orgLogos[org.id]?.planLabel {
          Text("\(org.role.capitalized) · \(plan)")
        }
      }
      Section {
        if navigation.inSite {
          Button("Workspace home", systemImage: "house") { navigation.enterWorkspace() }
        }
        Button("Switch workspace…", systemImage: "arrow.left.arrow.right") { navigation.showOneBox = true }
      }
      Section {
        if model.registry.screen("core.team") != nil {
          Button("Invite people", systemImage: "person.badge.plus") {
            navigation.mode = .workspaceSettings
            navigation.select(.plugin("core.team"))
          }
        }
        Button("Workspace settings", systemImage: "gearshape") {
          navigation.enter(.workspaceSettings, first: ShellScope(model: model, navigation: navigation).firstSection(of: .workspaceSettings))
        }
        if model.registry.screen("core.billing") != nil {
          Button("Billing and usage", systemImage: "creditcard") {
            navigation.mode = .workspaceSettings
            navigation.select(.plugin("core.billing"))
          }
        }
        Button("Workspace color…", systemImage: "paintpalette") {
          navigation.colorFor = ColorPickTarget(orgID: org.id, name: org.name)
        }
      }
      // The console menu's own "Upgrade plan" (Figma 121:18682): Billing, at the plans.
      if model.offersUpgrade {
        Section {
          Button("Upgrade plan", systemImage: "arrow.up.circle") {
            navigation.enter(.workspaceSettings, first: .plugin("core.billing"))
          }
          .accessibilityIdentifier("workspace-menu-upgrade")
        }
      }
    }
  }
}
