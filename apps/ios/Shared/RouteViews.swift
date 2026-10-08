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

/// The Besigner in the authenticated web view, signed in with the app's own
/// session: the only web content the apps show. Any other path is refused.
struct BesignerScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let path: String
  @State private var webModel = ConsoleWebViewModel()
  @State private var state: SessionState = .starting

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
        if DeepLinks.isBesignerPath(path), let config = model.config,
          let url = ConsoleWebView.url(origin: config.consoleOrigin, path: path)
        {
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
                _ = navigation.paths[navigation.section]?.popLast()
                return nil
              },
            ],
            info: ["app": .string(model.app == .pos ? "aglyn-pos" : "aglyn")],
            allowsPath: { DeepLinks.isBesignerPath($0) },
            onRefusedPath: { model.open($0, in: navigation) }
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
      if webModel.canGoBack {
        ToolbarItem(placement: .navigation) {
          Button { webModel.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
        }
      }
    }
    .task { await start() }
  }

  private func start() async {
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
