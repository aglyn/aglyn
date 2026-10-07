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

  var body: some View {
    NavigationStack(path: navigation.path(.home)) {
      Group {
        if let workspace = model.workspace, workspace.ready, workspace.site != nil {
          RegisterView()
        } else {
          StorePicker()
        }
      }
      .navigationDestination(for: Route.self) { RouteView(route: $0) }
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Menu {
            Button("Switch store", systemImage: "storefront") { navigation.showSwitcher = true }
            Divider()
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
              Task { await model.signOut() }
            }
          } label: {
            Label("Store", systemImage: "storefront")
          }
          .accessibilityIdentifier("pos-menu")
        }
      }
    }
    .sheet(isPresented: $navigation.showSwitcher) {
      SwitcherView(siteNoun: "Store").environment(model)
    }
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
          AglynEmptyState(
            "No workspaces yet", systemImage: "building.2",
            message: "Create a workspace in the \(model.brandName) console, then come back here.")
        } else {
          List {
            Section {
              ForEach(workspace.sites) { site in
                Button { workspace.selectSite(site.id) } label: {
                  AglynRow(site.name, subtitle: site.subdomain, systemImage: "storefront")
                }
                .buttonStyle(.plain)
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
