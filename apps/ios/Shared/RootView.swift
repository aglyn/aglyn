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

  @State private var intro = AglynLaunchIntro()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// What the window shows once the app knows: each stage decides whether the Facets ground stays behind it.
  private enum Stage { case configProblem, device, waiting, signedOut, verify, shell }

  private var stage: Stage {
    if !model.configProblems.isEmpty { return .configProblem }
    if model.deviceScreen != nil, model.deviceContext() != nil { return .device }
    guard let auth = model.auth else { return .waiting }
    if !auth.ready { return .waiting }
    if auth.user == nil || model.authFlow.landing { return .signedOut }
    if auth.user?.emailVerified == false && auth.impersonation == nil { return .verify }
    return .shell
  }

  var body: some View {
    let stage = stage
    ZStack {
      // The Facets ground: under the launch intro, and behind every signed-out screen so it holds still as they change.
      if !intro.finished || stage == .signedOut || stage == .verify {
        ground
      }
      destination(stage)
      if !intro.finished {
        AglynLaunchMark(intro, name: model.appName)
          .allowsHitTesting(false)
          .transition(.opacity)
      }
    }
    .task {
      // The intro ends when Auth has answered (signed out → sign-in, signed in → the shell), never on a fixed wait.
      // The sign-in and verify screens show the lockup where the intro docks it; the shell does not, so it fades.
      await intro.run(
        reduceMotion: reduceMotion, isReady: { [model] in model.auth?.ready ?? true },
        docksToLockup: { [self] in self.stage == .signedOut || self.stage == .verify })
    }
    // The screen on show where no navigation change announces it (AGL-4067): the shell's first, and the signed-out ones.
    .onChange(of: stage, initial: true) { _, stage in
      switch stage {
      case .shell: navigation.reportScreen()
      case .signedOut: Telemetry.screen("sign_in")
      case .verify: Telemetry.screen("verify_email")
      case .device: Telemetry.screen("device")
      case .configProblem, .waiting: break
      }
    }
    .tint(AglynColor.tint)
    .toggleStyle(AglynToggleStyle())
    .font(AglynFont.body)
    // Every plain web page (a live site, a preview, a docs or legal page) opens in the in-app browser screen, pushed
    // onto the section on screen (AGL-3935).
    .aglynBrowserHost { page, disposition in navigation.openWeb(page, disposition) }
    .onChange(of: model.auth?.user, initial: true) { _, user in
      model.userChanged(user)
      openPendingPush()
      // Invitations join on their own once the account is in use (AGL-4023), as the console's do on every load.
      Task { await model.joinInvites() }
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

  /// The Facets ground at the intro's settle and light.
  private var ground: some View {
    AglynFacetsBackground(settle: intro.settle, light: intro.light)
      // Reduce Motion cross-fades the launch frame into the ground at rest instead of moving the planes.
      .id(intro.crossFades ? AnyHashable(intro.settled) : AnyHashable("ground"))
      .transition(.opacity)
  }

  @ViewBuilder
  private func destination(_ stage: Stage) -> some View {
    let reveal = AuthReveal(offset: intro.destinationOffset, opacity: intro.destinationOpacity)
    switch stage {
    case .configProblem:
      AglynEmptyState(
        "This build is not configured", systemImage: "wrench.and.screwdriver",
        message: model.configProblems.joined(separator: "\n"))
    case .device:
      // A paired customer display or kiosk: nobody signs in, and it comes back as it was after a relaunch.
      if let device = model.deviceScreen, let context = model.deviceContext() {
        device.make(context, [:]).id(device.id).opacity(intro.destinationOpacity)
      }
    case .waiting:
      // The intro holds its last frame until Auth has answered, so a signed-in relaunch goes from the launch screen
      // straight to the shell.
      Color.clear
    case .signedOut:
      // A sign-up that is still landing keeps its screen up: the account exists, its records are being written.
      // Its Terms of Service and Privacy Policy links open in the in-app browser screen, pushed over it; the stack's
      // root carries the same ground, so it reads as one with the intro under it whether or not the stack paints.
      AglynBrowserStack { SignedOutView().environment(\.authReveal, reveal).background { ground } }
    case .verify:
      // Every console route refuses an unconfirmed address, so it is confirmed first (`/verify-email`).
      VerifyEmailView().environment(\.authReveal, reveal)
    case .shell:
      if let auth = model.auth {
        shell(navigation)
          .environment(navigation)
          .focusedSceneValue(\.shellNavigation, navigation)
          // A support session says so on every screen, with its way back to the staff member's own session.
          // The first verified session of an account with no workspace creates the one its sign-up asked for.
          .task(id: "\(auth.user?.uid ?? ""):\(model.workspace?.ready == true)") { await model.settleFirstRun() }
          // Notifications are asked for once someone is signed in and in the app, never on the signed-out screens.
          .task(id: auth.user?.uid) { if auth.impersonation == nil { model.push.askPermission(for: auth.user?.uid) } }
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
          .opacity(intro.destinationOpacity)
          .offset(y: intro.destinationOffset)
      }
    }
  }

  /// A tapped push's link, opened once someone is signed in.
  private func openPendingPush() {
    guard let link = model.push.pendingLink, model.auth?.user != nil else { return }
    let (orgID, hostID, uid) = (model.push.pendingOrgID, model.push.pendingHostID, model.push.pendingUID)
    model.push.pendingLink = nil
    model.push.pendingOrgID = nil
    model.push.pendingHostID = nil
    model.push.pendingUID = nil
    // A push sent to another account signed in here opens in that account (Add account).
    if let auth = model.auth, auth.impersonation == nil,
      let owner = auth.accounts.first(where: { $0.uid == uid && $0.slot != auth.activeSlot })
        ?? (uid == nil ? AccountRosterRules.owner(ofOrg: orgID, in: auth.accounts, activeSlot: auth.activeSlot) : nil)
    {
      Task {
        await auth.switchAccount(to: owner.slot)
        model.follow(link, orgID: orgID, hostID: hostID, in: navigation)
      }
      return
    }
    model.follow(link, orgID: orgID, hostID: hostID, in: navigation)
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

  @MainActor private static var routed = false

  /// `-AglynSection notifications|settings|more|analytics|home`, `-AglynDemoRoute <screen id>` and `-AglynDemoParams`.
  @MainActor
  static func route(_ navigation: ShellNavigation) {
    #if DEBUG
      // Once per launch: a tab opened later starts where it was opened, not on the launch's route.
      guard !routed else { return }
      routed = true
      let defaults = UserDefaults.standard
      switch defaults.string(forKey: "AglynSection") {
      case "notifications": navigation.section = .notifications
      case "settings": navigation.section = .settings
      // The phone has no Menu tab (AGL-4006): every area is a tile on Home.
      case "more": navigation.section = .home
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
