// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Picks the workspace and the site every screen then reads.
struct SwitcherView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  var siteNoun = "Site"

  var body: some View {
    NavigationStack {
      Group {
        if let workspace = model.workspace {
          // A grouped form, so a section's title sits above its rows and never floats over the first one.
          Form {
            Section("Workspace") {
              if !workspace.ready && workspace.orgs.isEmpty {
                SkeletonRows(count: 2)
              }
              ForEach(workspace.orgs) { org in
                Button {
                  workspace.selectOrg(org.id)
                } label: {
                  AglynRow(
                    org.name, subtitle: org.role.capitalized, systemImage: "building.2",
                    imageURL: model.mediaURL(workspace.orgLogos[org.id]?.light, hostID: nil),
                    darkImageURL: model.mediaURL(workspace.orgLogos[org.id]?.dark, hostID: nil)
                  ) {
                    if org.id == workspace.org?.id { checkmark }
                  }
                }
                .buttonStyle(.aglynRow)
                .accessibilityAddTraits(org.id == workspace.org?.id ? .isSelected : [])
              }
              // A full window is not the whole list (the console's switcher, AGL-2336).
              if workspace.hasMoreOrgs {
                Button("Load more workspaces") { workspace.loadMoreOrgs() }
                  .accessibilityIdentifier("switcher-more-orgs")
              }
            }
            if workspace.org != nil {
              Section(siteNoun == "Site" ? "Sites" : "Stores") {
                if !workspace.ready { SkeletonRows(count: 2) }
                if workspace.ready && workspace.sites.isEmpty {
                  Text("This workspace has no \(siteNoun.lowercased())s you can open.").foregroundStyle(.secondary)
                }
                ForEach(workspace.sites) { site in
                  Button {
                    workspace.selectSite(site.id)
                    dismiss()
                  } label: {
                    AglynRow(
                      site.name, subtitle: site.subdomain, systemImage: "globe",
                      imageURL: model.mediaURL(site.favicon, hostID: site.id)
                    ) {
                      if site.id == workspace.site?.id { checkmark }
                    }
                  }
                  .buttonStyle(.aglynRow)
                  .accessibilityIdentifier("switcher-site-\(site.id)")
                  .accessibilityAddTraits(site.id == workspace.site?.id ? .isSelected : [])
                }
              }
            }
          }
          .formStyle(.grouped)
          .sensoryFeedback(.selection, trigger: workspace.effective)
          .aglynListBackground()
          // Each workspace's logo, read from its own document as the console's switcher reads them.
          .task(id: workspace.orgs.map(\.id)) { workspace.loadLogos(workspace.orgs.map(\.id)) }
        } else {
          ProgressView()
        }
      }
      .navigationTitle("Switch \(siteNoun.lowercased())")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    #if os(macOS)
      .aglynSheetMinimumSize(width: 380, height: 420)
    #endif
  }

  private var checkmark: some View {
    Image(systemName: "checkmark").foregroundStyle(AglynColor.tint).fontWeight(.semibold)
      .accessibilityHidden(true)
  }
}

/// The toolbar button naming the picked workspace and site; opens the switcher.
struct ScopeButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Button {
      navigation.showSwitcher = true
    } label: {
      Label(model.workspace?.site?.name ?? model.workspace?.org?.name ?? "Switch site", systemImage: "arrow.left.arrow.right")
    }
    .help("Switch workspace or site (⌘K)")
    .accessibilityIdentifier("home-switcher")
  }
}
