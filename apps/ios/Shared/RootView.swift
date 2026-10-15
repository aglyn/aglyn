// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// What every window shows first: a configuration problem, the sign-in, or
/// the signed-in shell the app passes in.
struct RootView<Shell: View>: View {
  @Environment(AppModel.self) private var model
  @State private var navigation = ShellNavigation()
  let shell: (ShellNavigation) -> Shell

  init(@ViewBuilder shell: @escaping (ShellNavigation) -> Shell) {
    self.shell = shell
  }

  var body: some View {
    Group {
      if !model.configProblems.isEmpty {
        AglynEmptyState(
          "This build is not configured", systemImage: "wrench.and.screwdriver",
          message: model.configProblems.joined(separator: "\n"))
      } else if let device = model.deviceScreen, let context = model.deviceContext() {
        // A paired customer display or kiosk: nobody signs in, and it comes back as it was after a relaunch.
        device.make(context, [:]).id(device.id)
      } else if let auth = model.auth {
        // The launch view stays up until Auth has answered, so a signed-in
        // relaunch goes from the launch screen straight to the shell.
        if !auth.ready {
          AglynLaunchView(name: model.brandName, caption: model.app == .pos ? "POS" : nil)
        } else if auth.user == nil || model.authFlow.landing {
          // A sign-up that is still landing keeps its screen up: the account exists, its records are being written.
          SignedOutView()
        } else if auth.user?.emailVerified == false && auth.impersonation == nil {
          // Every console route refuses an unconfirmed address, so it is confirmed first (`/verify-email`).
          VerifyEmailView()
        } else {
          shell(navigation)
            .environment(navigation)
            .focusedSceneValue(\.shellNavigation, navigation)
            // A support session says so on every screen, with its way back to the staff member's own session.
            // The first verified session of an account with no workspace creates the one its sign-up asked for.
            .task(id: "\(auth.user?.uid ?? ""):\(model.workspace?.ready == true)") { await model.settleFirstRun() }
            .safeAreaInset(edge: .top, spacing: 0) {
              if let impersonation = auth.impersonation {
                AglynNotice(
                  impersonation.banner, tone: .warning, actionTitle: "Exit impersonation",
                  action: { Task { await auth.endImpersonation() } }
                )
                .padding(AglynSpace.one)
                .background(.bar)
                .accessibilityIdentifier("impersonation-banner")
              }
            }
        }
      }
    }
    .tint(AglynColor.tint)
    .font(AglynFont.body)
    .onChange(of: model.auth?.user, initial: true) { _, user in
      model.userChanged(user)
      openPendingPush()
    }
    // Entering or leaving a support session starts from home: nothing open belonged to the other person.
    .onChange(of: model.auth?.impersonation) {
      navigation.paths = [:]
      navigation.section = .home
      navigation.showSwitcher = false
      navigation.pendingInvite = nil
    }
    .onOpenURL { url in
      // A sign-up, sign-in, reset or verification link opens its own screen; any other link the signed-in shell.
      let signedIn = model.auth?.user != nil
      if model.authFlow.open(url.absoluteString, signedIn: signedIn, onPlan: { plan in
        if let slug = model.workspace?.org?.slug { model.open(plan.destination(orgSlug: slug), in: navigation) }
      }) {
        if model.auth?.user?.emailVerified == true { model.authFlow.pendingVerificationCode = nil }
        return
      }
      model.open(url.absoluteString, in: navigation)
    }
    .onChange(of: model.push.pendingLink) { openPendingPush() }
    .task { await DebugLaunch.autoSignIn(model) }
  }

  /// A tapped push's link, opened once someone is signed in.
  private func openPendingPush() {
    guard let link = model.push.pendingLink, model.auth?.user != nil else { return }
    model.push.pendingLink = nil
    model.open(link, in: navigation)
  }
}

/// Debug-build launch arguments that drive the app for screenshots and UI tests.
enum DebugLaunch {
  /// `-AglynAutoSignIn YES`: sign in as the seeded emulator member from Local.xcconfig.
  @MainActor
  static func autoSignIn(_ model: AppModel) async {
    #if DEBUG
      guard UserDefaults.standard.bool(forKey: "AglynAutoSignIn"),
        let config = model.config, config.authEmulatorHost != nil,
        var email = Bundle.main.object(forInfoDictionaryKey: "AGLYN_DEBUG_EMAIL") as? String,
        var password = Bundle.main.object(forInfoDictionaryKey: "AGLYN_DEBUG_PASSWORD") as? String,
        !email.isEmpty, !password.isEmpty
      else { return }
      // `-AglynDebugAccount staff`: the seeded staff account
      // (tools/scripts/seed-native/account.mjs), to see the staff section.
      if UserDefaults.standard.string(forKey: "AglynDebugAccount") == "staff" {
        email = "mobile-staff@example.test"
        password = "seed-\(config.firebase.projectID)-staff"
      }
      if let current = model.auth?.user {
        guard current.email != email else { return }
        await model.signOut()
      }
      do {
        try await model.auth?.signIn(email: email, password: password)
      } catch {
        print("Aglyn: debug sign-in failed: \(error)")
      }
    #endif
  }

  /// `-AglynSection notifications|settings|more|analytics|home`, `-AglynDemoRoute <screen id>` and `-AglynDemoParams`.
  @MainActor
  static func route(_ navigation: ShellNavigation) {
    #if DEBUG
      let defaults = UserDefaults.standard
      switch defaults.string(forKey: "AglynSection") {
      case "notifications": navigation.section = .notifications
      case "settings": navigation.section = .settings
      case "more": navigation.section = .more
      case "analytics": navigation.section = .analytics
      case let value? where value.hasPrefix("plugin:"): navigation.section = .plugin(String(value.dropFirst(7)))
      default: break
      }
      if let screen = defaults.string(forKey: "AglynDemoRoute"), !screen.isEmpty {
        // `-AglynDemoParams booking=b-1&email=…` for a screen that opens on one record.
        var params: NativeParams = [:]
        for pair in (defaults.string(forKey: "AglynDemoParams") ?? "").split(separator: "&") {
          let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
          if parts.count == 2 { params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1] }
        }
        switch screen {
        case "notification-settings": navigation.push(.notificationSettings)
        case "analytics": navigation.push(.analytics)
        default: navigation.push(.screen(screen, params))
        }
      }
      if defaults.bool(forKey: "AglynShowSwitcher") { navigation.showSwitcher = true }
    #endif
  }
}
