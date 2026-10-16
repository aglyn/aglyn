// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import AglynWebView
import SwiftUI

/// The view for a route on a navigation stack.
struct RouteView: View {
  let route: Route

  var body: some View {
    switch route {
    case .screen(let id, let params): PluginScreenView(screenID: id, params: params)
    case .besigner(let path): BesignerScreen(path: path)
    case .unavailable(let path): NotInAppView(path: path)
    case .settings: SettingsView()
    case .notificationSettings: NotificationSettingsView()
    case .analytics: AnalyticsView()
    }
  }
}

/// A registered plugin screen, handed the window's context. A screen that
/// reads the picked site asks for one first.
struct PluginScreenView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let screenID: String
  var params: NativeParams = [:]

  var body: some View {
    if let screen = model.registry.screen(screenID), let context = model.context(for: navigation) {
      if !screen.admits(context.staff) {
        AglynEmptyState(
          "Not available", systemImage: "lock",
          message: "This page is for Aglyn staff whose role includes it.")
        .navigationTitle(screen.title)
      } else if screen.requiresSite && context.hostID == nil {
        AglynEmptyState(
          "Pick a site", systemImage: "globe",
          message: "\(screen.title) shows one site at a time."
        ) {
          Button("Choose a site") { navigation.showSwitcher = true }
        }
        .navigationTitle(screen.title)
      } else {
        screen.make(context, params)
          .id("\(screenID):\(context.hostID ?? "")")
      }
    } else {
      AglynEmptyState(
        "This page is not in the app", systemImage: "questionmark.square.dashed",
        message: "Update \(model.appName) to open it here.")
    }
  }
}

/// A console link the app has no native screen for yet. Console areas are
/// native screens; the app never opens the console page instead.
struct NotInAppView: View {
  @Environment(AppModel.self) private var model
  let path: String

  var body: some View {
    AglynEmptyState(
      "This page is not in the app yet", systemImage: "questionmark.square.dashed",
      message: "\(model.appName) opens it here once its screen is built.")
    .navigationTitle("Not in the app")
    .accessibilityIdentifier("not-in-app")
  }
}

/// Where the Besigner web view is, so a navigation inside it can be judged
/// against the editor it left (AGL-3850).
@MainActor
final class BesignerWebSession {
  /// The editor page the web view shows (or is entering).
  private(set) var current: String
  /// Set once the web view has handed the person back to the app.
  var left = false

  init(path: String) { current = path }

  /// Whether the web view may show `next`; a Besigner page becomes the current one.
  func allows(_ next: String) -> Bool {
    guard !left, BesignerEntry.exit(from: current, to: next) == .stay else { return false }
    if !next.hasPrefix(BesignerEntry.path) { current = next }
    return true
  }
}

/// The Besigner in the authenticated web view, signed in with the app's own
/// session: the only web content the apps show. It opens through the
/// console's `/auth/besigner` entry page, which signs the web view in before
/// the editor loads; anything the Besigner navigates to that is not the
/// editor returns to the app's own screens.
struct BesignerScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let path: String
  @State private var webModel = ConsoleWebViewModel()
  @State private var state: SessionState = .starting
  @State private var session: BesignerWebSession

  init(path: String) {
    self.path = path
    _session = State(initialValue: BesignerWebSession(path: path))
  }

  private enum SessionState: Equatable {
    case starting
    case ready([ConsoleSession.HTTPCookieSnapshot])
    case failed(String)
  }

  var body: some View {
    Group {
      switch state {
      case .starting:
        ProgressView("Opening the Besigner")
      case .failed(let message):
        AglynEmptyState("The Besigner did not open", systemImage: "exclamationmark.triangle", message: message) {
          Button("Try again") { Task { await start() } }
        }
      case .ready(let cookies):
        if let config = model.config, let url = BesignerEntry.url(origin: config.consoleOrigin, besignerPath: path) {
          ConsoleWebView(
            url: url, trustedOrigins: [config.consoleOrigin], cookies: cookies.compactMap(\.cookie),
            model: webModel,
            handlers: [
              "openNative": { params in
                let link = params["path"]?.stringValue ?? ""
                guard case .screen(let screen, let screenParams)? = model.registry.resolve(link) else {
                  return ["opened": false]
                }
                navigation.push(.screen(screen, screenParams))
                return ["opened": true]
              },
              "close": { _ in
                leave()
                return nil
              },
            ],
            info: ["app": .string(model.app == .pos ? "aglyn-pos" : "aglyn")],
            allowsPath: { session.allows($0) },
            onRefusedPath: { handBack($0) }
          )
          .ignoresSafeArea(edges: .bottom)
        }
      }
    }
    .navigationTitle(webModel.title.isEmpty ? "Besigner" : webModel.title)
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("Done") { leave() }
          .accessibilityIdentifier("besigner-done")
      }
    }
    .task { await start() }
  }

  /// Back to the screen the Besigner was opened from.
  private func leave() {
    guard !session.left else { return }
    session.left = true
    if case .besigner? = navigation.paths[navigation.section]?.last {
      _ = navigation.paths[navigation.section]?.popLast()
    }
  }

  /// A page the Besigner went to that the web view does not show.
  private func handBack(_ next: String) {
    guard !session.left else { return }
    switch BesignerEntry.exit(from: session.current, to: next) {
    case .stay: return
    case .leave: leave()
    case .sessionEnded:
      state = .failed("Your session ended. Open the Besigner again to keep editing.")
    case .open(let link):
      leave()
      // Only a screen the app has; a console page with none just returns to the app.
      if case .screen(let screen, let params)? = model.registry.resolve(link) {
        navigation.push(.screen(screen, params))
      }
    }
  }

  private func start() async {
    session.left = false
    state = .starting
    guard let config = model.config, let auth = model.auth,
      let token = try? await auth.idToken(forceRefresh: false) else {
      state = .failed("Sign in again to open the Besigner.")
      return
    }
    switch await ConsoleSession.mint(origin: config.consoleOrigin, idToken: token) {
    case .ok(let cookies): state = .ready(cookies)
    case .failed(_, let error): state = .failed(error)
    }
  }
}
