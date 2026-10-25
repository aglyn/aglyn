// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// The signed-in "Aglyn POS" shell: pick the store (a site), then the
/// register, built from the plugins' POS contributions.
struct POSShell: View {
  @Environment(AppModel.self) private var model
  @Bindable var navigation: ShellNavigation
  @State private var confirmSignOut = false
  /// The stack's depth as its screens last saw it: on the Mac a screen slides in as Aglyn's do (AGL-4009).
  @State private var ledger = AglynStackLedger()

  var body: some View {
    NavigationStack(path: navigation.path(.home)) {
      Group {
        if let workspace = model.workspace, workspace.ready, workspace.site != nil {
          RegisterView()
        } else {
          StorePicker()
        }
      }
      .aglynStackEntrance()
      .navigationDestination(for: Route.self) { RouteView(route: $0).aglynStackEntrance() }
      .environment(\.aglynPush, AglynPushAction { [weak navigation] view in navigation?.push(.view(view)) })
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Menu {
            // Screens a plugin puts in the register's menu (card readers…), once a store is open.
            if model.workspace?.site != nil {
              ForEach(model.registry.screens(for: .pos, placement: .menu), id: \.id) { screen in
                Button(screen.title, systemImage: screen.icon ?? "square.grid.2x2") {
                  navigation.push(.screen(screen.id, [:]))
                }
                .accessibilityIdentifier("pos-menu-\(screen.id)")
              }
              Divider()
            }
            Button("Switch store", systemImage: "storefront") { navigation.picker = .workspace }
            #if os(iOS)
              Button("Settings", systemImage: "gearshape") { navigation.push(.settings) }
                .accessibilityIdentifier("pos-menu-settings")
            #endif
            // Every account signed in on this register, and Add account (each keeps its own sign-in and stores).
            AccountSwitchItems()
            Divider()
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
              confirmSignOut = true
            }
          } label: {
            Label("Store", systemImage: "storefront")
          }
          .accessibilityIdentifier("pos-menu")
        }
      }
    }
    .sheet(item: $navigation.picker) { _ in
      ScopePickerSheet(start: .workspace, twoStep: true, siteNoun: "Store").environment(model).environment(navigation)
    }
    .sheet(isPresented: $navigation.showAddAccount) { AddAccountView().environment(model) }
    .onChange(of: navigation.showSwitcher) { _, asked in
      guard asked else { return }
      navigation.showSwitcher = false
      navigation.picker = .workspace
    }
    #if os(macOS)
      .environment(
        \.aglynStackMotion, AglynStackMotion(ledger: ledger) { [weak navigation] in navigation?.paths[.home]?.count ?? 0 })
    #endif
    .signOutConfirmation(isPresented: $confirmSignOut)
    // Aglyn POS draws the same theme as the account's Aglyn.
    .aglynAppTheme(nonce: navigation.themeNonce)
    // The register keeps the system's navigation and toolbar on every device; it is not part of the shell redesign.
    .environment(\.aglynWideChrome, false)
    .onAppear { DebugLaunch.route(navigation) }
  }
}

/// The first screen after sign-in: which store this register sells for.
struct StorePicker: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      if let workspace = model.workspace, workspace.ready {
        if workspace.orgs.isEmpty {
          FirstRunView()
        } else {
          List {
            Section {
              ForEach(workspace.sites) { site in
                Button { workspace.selectSite(site.id) } label: {
                  AglynRow(site.name, subtitle: site.subdomain, systemImage: "storefront")
                }
                .buttonStyle(.aglynRow)
              }
            } header: {
              Text("Choose the store this register sells for")
            }
          }
        }
      } else {
        List { SkeletonRows(count: 3) }
      }
    }
    .navigationTitle("Stores")
  }
}

/// The register: the plugins' `register` placements. Until the POS plugin
/// contributes its register, a placeholder says what comes here.
struct RegisterView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let screens = model.registry.screens(for: .pos, placement: .register)
    Group {
      if let first = screens.first {
        PluginScreenView(screenID: first.id)
      } else {
        AglynEmptyState(
          "Register", systemImage: "cart",
          message: "Products, cart and payments for \(model.workspace?.site?.name ?? "this store") open here.")
      }
    }
    .navigationTitle(model.workspace?.site?.name ?? "Register")
  }
}
