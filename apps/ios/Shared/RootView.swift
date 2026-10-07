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
      } else if let auth = model.auth {
        if !auth.ready {
          ProgressView().controlSize(.large)
        } else if auth.user == nil {
          SignInView()
        } else {
          shell(navigation)
            .environment(navigation)
            .focusedSceneValue(\.shellNavigation, navigation)
        }
      }
    }
    .tint(AglynColor.tint)
    .font(AglynFont.body)
    .onChange(of: model.auth?.user, initial: true) { _, user in model.userChanged(user) }
    .onOpenURL { url in model.open(url.absoluteString, in: navigation) }
    .task { await DebugLaunch.autoSignIn(model) }
  }
}

/// Debug-build launch arguments that drive the app for screenshots and UI tests.
enum DebugLaunch {
  /// `-AglynAutoSignIn YES`: sign in as the seeded emulator member from Local.xcconfig.
  @MainActor
  static func autoSignIn(_ model: AppModel) async {
    #if DEBUG
      guard UserDefaults.standard.bool(forKey: "AglynAutoSignIn"),
        model.config?.authEmulatorHost != nil, model.auth?.user == nil,
        let email = Bundle.main.object(forInfoDictionaryKey: "AGLYN_DEBUG_EMAIL") as? String,
        let password = Bundle.main.object(forInfoDictionaryKey: "AGLYN_DEBUG_PASSWORD") as? String,
        !email.isEmpty, !password.isEmpty
      else { return }
      do {
        try await model.auth?.signIn(email: email, password: password)
      } catch {
        print("Aglyn: debug sign-in failed: \(error)")
      }
    #endif
  }

  /// `-AglynSection notifications|settings|more|home` and `-AglynDemoRoute <screen id>`.
  @MainActor
  static func route(_ navigation: ShellNavigation) {
    #if DEBUG
      let defaults = UserDefaults.standard
      switch defaults.string(forKey: "AglynSection") {
      case "notifications": navigation.section = .notifications
      case "settings": navigation.section = .settings
      case "more": navigation.section = .more
      case let value? where value.hasPrefix("plugin:"): navigation.section = .plugin(String(value.dropFirst(7)))
      default: break
      }
      if let screen = defaults.string(forKey: "AglynDemoRoute"), !screen.isEmpty {
        navigation.push(.screen(screen, [:]))
      }
      if defaults.bool(forKey: "AglynShowSwitcher") { navigation.showSwitcher = true }
    #endif
  }
}
