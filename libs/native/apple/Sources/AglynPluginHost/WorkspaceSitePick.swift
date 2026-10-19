// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

/// A workspace-wide screen whose sections read one site at a time (the console's org pages pick a site the same
/// way, `pickedHostId`): a bar naming the site being read, with a menu of the workspace's sites; the pick is
/// remembered per workspace and plugin on this device, and a workspace with one site picks it. `content` gets the
/// context on the picked site; with none picked, the bar asks for one.
public struct WorkspaceSitePick<Content: View>: View {
  let context: NativePluginContext
  /// The plugin's own key for the remembered pick (`emails`, `marketing`).
  let key: String
  /// What the bar says it reads ("Reading the emails of").
  let prompt: String
  @ViewBuilder let content: (NativePluginContext) -> Content
  @State private var picked: String?

  public init(
    context: NativePluginContext, key: String, prompt: String,
    @ViewBuilder content: @escaping (NativePluginContext) -> Content
  ) {
    self.context = context
    self.key = key
    self.prompt = prompt
    self.content = content
  }

  private var storageKey: String { "aglyn.workspaceSite.\(key).\(context.orgID ?? "")" }

  /// The pick in force: the remembered one while the workspace still has it, else its only site.
  private var current: String? {
    if let picked, context.sites.contains(where: { $0.id == picked }) { return picked }
    return context.sites.count == 1 ? context.sites.first?.id : nil
  }

  public var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: AglynSpace.one) {
        Text(prompt).font(AglynFont.subheadline).foregroundStyle(.secondary)
        Menu {
          ForEach(context.sites) { site in
            Button(site.name) { pick(site.id) }
          }
        } label: {
          Label(current.map(context.siteName) ?? "Choose a site", systemImage: "globe").font(AglynFont.strongSubheadline)
        }
        .fixedSize()
        .accessibilityIdentifier("workspace-site-pick-\(key)")
        Spacer(minLength: 0)
      }
      .aglynContentEdges()
      .padding(.vertical, AglynSpace.one)
      Divider()
      if let current {
        content(context.onSite(current)).id(current)
      } else if context.sites.isEmpty {
        AglynEmptyState("No sites yet", systemImage: "globe", message: "This workspace has no sites you can open.")
      } else {
        AglynEmptyState(
          "Choose a site", systemImage: "globe",
          message: "This is read one site at a time across the workspace. Choose the site to read.")
      }
    }
    .onAppear { picked = UserDefaults.standard.string(forKey: storageKey) }
  }

  private func pick(_ hostID: String) {
    picked = hostID
    UserDefaults.standard.set(hostID, forKey: storageKey)
  }
}

