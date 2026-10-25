// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// The menus that belong to their owner (AGL-3945, Figma Menus 2:4): your account's, behind your photo at the foot of the
// rail (a sheet on a phone), and the workspace's, behind its name in the sidebar.

/// Who is signed in, for the account menu's header and photo: their name and picture as the console resolves them
/// (`readAccountName`, `readAccountPhoto`, AGL-4010), the profile first, then the sign-in record.
@MainActor
struct AccountIdentity {
  let model: AppModel

  private var user: AglynUser? { model.auth?.user }

  var name: String {
    let resolved =
      model.preferences?.name(authDisplayName: user?.displayName, email: user?.email)
      ?? readAccountName(nil, authDisplayName: user?.displayName, email: user?.email)
    return resolved.isEmpty ? "You" : resolved
  }

  var email: String? { user?.email }

  var initials: String { accountInitials(name: name == email || name == "You" ? nil : name, email: email) }

  /// The stored picture (an address, or a library pick's `/api/media/cdn/...` path); nil draws the initials.
  var photoValue: String? {
    model.preferences?.photo(authPhotoURL: user?.photoURL) ?? readAccountPhoto(nil, authPhotoURL: user?.photoURL)
  }

  /// The picture as an address on the console this app talks to (the shared `mediaPreviewURL`).
  var photoURL: URL? { model.mediaURL(photoValue, hostID: nil, width: AccountPlaces.photoWidth) }

  /// The notification sound picked on the account (`users/{uid}.notificationSound`), by its label.
  var soundLabel: String? {
    AglynNotificationSounds.sound(for: model.preferences?.identity[AglynNotificationSounds.field])?.label
  }

  /// Another signed-in account's photo, as last shown on this device.
  func photoURL(of account: SignedInAccount) -> URL? {
    if account.slot == model.auth?.activeSlot, model.auth?.impersonation == nil { return photoURL }
    return model.mediaURL(account.photoURL, hostID: nil, width: AccountPlaces.photoWidth)
  }
}

/// The account menu's places, shared by the Mac and iPad menu and the phone's sheet.
@MainActor
enum AccountPlaces {
  static let settingsScreen = "core.account.profile"
  /// The person's profile (name, photo), which Edit profile opens.
  static let profileScreen = "core.account.profile"
  static let marketplaceScreen = "marketplace.sell"
  static let reportScreen = "core.support"
  /// The width a person's photo is asked for at: the largest it is drawn (the phone sheet's 72) at 3x.
  static let photoWidth = 256

  static func documentation(_ model: AppModel) -> AglynWebPage? {
    HelpLink.all(model.config).first { $0.id == "docs" }.map { AglynWebPage($0.url) }
  }
}

/// The account menu (Figma Mac / Popover / Account 16:142, dark 311:2829), drawn as a popover's content so it can hold
/// the person's photo and the inline appearance picker: the profile header with Edit profile; Appearance, Theme
/// settings…, Notifications and sound, Settings; Marketplace, Documentation, Report an issue; the accounts signed in on
/// this device with their photos and Add account; Sign out. Only what the console offers the signed-in person.
struct AccountMenuContent: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Binding var confirmSignOut: Bool
  /// Closes the popover before the chosen place opens.
  let done: () -> Void

  var body: some View {
    let identity = AccountIdentity(model: model)
    VStack(alignment: .leading, spacing: 0) {
      AglynProfileHeader(
        name: identity.name, email: identity.email, initials: identity.initials, photoURL: identity.photoURL,
        editProfile: model.registry.screen(AccountPlaces.profileScreen) == nil
          ? nil : { go { navigation.push(.screen(AccountPlaces.profileScreen, [:])) } })
      AglynMenuDivider()
      AppearanceRow()
      AglynMenuRow("Theme settings…", systemImage: "paintpalette", action: { go { navigation.push(.themeSettings) } })
        .accessibilityIdentifier("account-theme-settings")
      AglynMenuRow(
        "Notifications and sound", systemImage: "bell", action: { go { navigation.push(.notificationSettings) } }
      ) {
        if let sound = identity.soundLabel { AglynMenuValue(sound) }
      }
      .accessibilityIdentifier("account-notifications")
      AglynMenuRow("Settings", systemImage: "gearshape", action: { go { navigation.push(.settings) } })
        .accessibilityIdentifier("account-settings")
      AglynMenuDivider()
      if model.app == .aglyn, model.registry.screen(AccountPlaces.marketplaceScreen) != nil {
        AglynMenuRow("Marketplace", systemImage: "storefront", action: {
          go { navigation.push(.screen(AccountPlaces.marketplaceScreen, [:])) }
        })
        .accessibilityIdentifier("account-marketplace")
      }
      if let docs = AccountPlaces.documentation(model) {
        AglynMenuRow("Documentation", systemImage: "book", action: { go { navigation.openWeb(docs) } })
          .accessibilityIdentifier("account-documentation")
      }
      if model.registry.screen(AccountPlaces.reportScreen) != nil {
        AglynMenuRow("Report an issue", systemImage: "flag", action: {
          go { navigation.push(.screen(AccountPlaces.reportScreen, [:])) }
        })
        .accessibilityIdentifier("account-report")
      }
      if let auth = model.auth {
        AglynMenuDivider()
        AglynMenuCaption("Accounts")
        ForEach(auth.accounts) { account in
          AglynMenuPersonRow(
            name: account.displayName ?? account.email ?? "Account",
            detail: account.displayName == nil ? nil : account.email,
            initials: account.initials, photoURL: identity.photoURL(of: account),
            current: account.slot == auth.activeSlot && auth.impersonation == nil
          ) {
            done()
            Task { await auth.switchAccount(to: account.slot) }
          }
          .accessibilityIdentifier("account-\(account.email ?? account.slot)")
        }
        if auth.canAddAccounts {
          AglynMenuRow("Add account", systemImage: "person.badge.plus", action: {
            go { navigation.showAddAccount = true }
          })
          .accessibilityIdentifier("account-add")
        }
      }
      AglynMenuDivider()
      AglynMenuRow("Sign out", systemImage: "rectangle.portrait.and.arrow.right", action: { go { confirmSignOut = true } })
        .accessibilityIdentifier("account-sign-out")
    }
    .padding(AglynMenuMetrics.padding)
    .frame(width: AglynMenuMetrics.width)
  }

  private func go(_ run: @escaping () -> Void) {
    done()
    run()
  }
}

/// Appearance: light, dark or the system's, inline (the console's own toggle), saved on the account so it follows the
/// person.
struct AppearanceRow: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let preferences = model.preferences {
      AglynMenuSegmentedRow(
        "Appearance", systemImage: "circle.lefthalf.filled",
        segments: [
          AglynMenuSegment(AppAppearance.light, systemImage: "sun.max", label: "Light"),
          AglynMenuSegment(AppAppearance.dark, systemImage: "moon", label: "Dark"),
          AglynMenuSegment(AppAppearance.system, systemImage: "display", label: "Match system"),
        ],
        selection: Binding(
          get: { preferences.appTheme.appearance },
          set: { value in
            var theme = preferences.appTheme
            theme.appearance = value
            preferences.setAppTheme(theme)
          })
      )
      .accessibilityIdentifier("account-appearance")
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

/// The account photo at the foot of the rail: opens the account menu, a popover from the photo (Figma 16:142).
struct AccountMenuButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var open = false
  @State private var confirmSignOut = false
  var size: CGFloat = 32

  var body: some View {
    let identity = AccountIdentity(model: model)
    Button {
      open.toggle()
    } label: {
      AglynAccountAvatar(initials: identity.initials, photoURL: identity.photoURL, size: size)
    }
    .buttonStyle(.plain)
    .fixedSize()
    // The rail names the account with its own bubble (AGL-3996), so no slow system help tag.
    .accessibilityLabel(AccountIdentity(model: model).name)
    .accessibilityIdentifier("rail-account")
    .popover(isPresented: $open, arrowEdge: .trailing) {
      AccountMenuContent(confirmSignOut: $confirmSignOut) { open = false }
        .environment(model)
        .environment(navigation)
    }
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
