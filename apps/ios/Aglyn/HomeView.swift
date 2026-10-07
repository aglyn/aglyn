// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// Home: the picked workspace and site, the plugins' quick actions and
/// dashboard widgets, and the latest notifications.
struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var feed = NotificationFeed()

  private var hasSite: Bool { model.workspace?.site != nil }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        scopeHeader
        if let workspace = model.workspace, workspace.ready, workspace.orgs.isEmpty {
          AglynEmptyState(
            "No workspaces yet", systemImage: "building.2",
            message: "Create a workspace in the \(model.brandName) console, then come back here.")
        } else {
          quickActions
          widgets
          recentNotifications
        }
      }
      .padding(20)
      .frame(maxWidth: 980, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(AglynColor.page)
    .navigationTitle("Home")
    .refreshable { model.refresh() }
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      feed.start(reader: model.reader, uid: model.auth?.user?.uid, count: 5)
    }
  }

  private var scopeHeader: some View {
    Button { navigation.showSwitcher = true } label: {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(model.workspace?.org?.name ?? (model.workspace?.ready == true ? "No workspace" : "Loading"))
            .font(AglynFont.title)
            .foregroundStyle(.primary)
            .redacted(reason: model.workspace?.ready == true ? [] : .placeholder)
          Text(model.workspace?.site?.name ?? (model.workspace?.ready == true ? "Pick a site" : "Loading site"))
            .foregroundStyle(.secondary)
            .redacted(reason: model.workspace?.ready == true ? [] : .placeholder)
        }
        Spacer()
        Image(systemName: "arrow.left.arrow.right.circle.fill")
          .font(.title2)
          .foregroundStyle(AglynColor.tint)
          .accessibilityHidden(true)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Switch workspace or site")
    .accessibilityValue("\(model.workspace?.org?.name ?? ""), \(model.workspace?.site?.name ?? "")")
  }

  @ViewBuilder
  private var quickActions: some View {
    let actions = model.registry.quickActions(for: .aglyn).filter { hasSite || !$0.requiresSite }
    if !actions.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        Text("Quick actions").font(AglynFont.headline)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
          ForEach(actions) { action in
            Button {
              if let screen = action.screen {
                navigation.push(.screen(screen, action.params))
              } else if let path = action.consolePath {
                navigation.push(.console(path))
              }
            } label: {
              QuickActionTile(action.title, systemImage: action.icon)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("quick-action-\(action.id)")
          }
        }
      }
    }
  }

  @ViewBuilder
  private var widgets: some View {
    let visible = model.registry.widgets(for: .aglyn).filter { hasSite || !$0.requiresSite }
    if let context = model.context(for: navigation), !visible.isEmpty {
      WideLayoutReader { wide in
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: wide ? 2 : 1), spacing: 16) {
          ForEach(visible) { widget in
            AglynCard(widget.title, systemImage: widget.icon) {
              widget.make(context)
            }
            .id("\(widget.id):\(context.hostID ?? ""):\(model.refreshToken)")
          }
        }
      }
    }
  }

  private var recentNotifications: some View {
    AglynCard("Notifications", systemImage: "bell") {
      if let rows = feed.rows {
        if rows.isEmpty {
          Text("You're all caught up.").foregroundStyle(.secondary)
        } else {
          VStack(alignment: .leading, spacing: 12) {
            ForEach(rows) { row in
              Button { openNotification(row, model: model, navigation: navigation) } label: { NotificationRow(row: row) }
                .buttonStyle(.plain)
            }
          }
        }
      } else {
        Text("Loading notifications").redacted(reason: .placeholder)
      }
    } accessory: {
      Button("See all") { navigation.select(.notifications) }.buttonStyle(.borderless)
    }
  }
}
