// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Home, a site dashboard in four sections: the site header, quick actions,
/// "At a glance" metric cards, and recent activity. Wide windows keep the
/// header full width and put recent activity beside the rest.
struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.openURL) private var openURL
  @State private var feed = NotificationFeed()
  @State private var site = SiteStatus()

  /// How many recent notifications the dashboard reads, and how many it lists.
  private static let recentWindow = 50
  private static let recentShown = 5

  private var hasSite: Bool { model.workspace?.site != nil }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.three) {
        if let workspace = model.workspace, workspace.ready, workspace.orgs.isEmpty {
          AglynEmptyState(
            "No workspaces yet", systemImage: "building.2",
            message: "Create a workspace in the \(model.brandName) console, then come back here.")
        } else {
          header
          WideLayoutReader { wide in
            if wide {
              HStack(alignment: .top, spacing: AglynSpace.three) {
                VStack(alignment: .leading, spacing: AglynSpace.three) {
                  quickActions
                  glance
                }
                .frame(minWidth: 360, maxWidth: .infinity)
                .layoutPriority(1)
                activity.frame(minWidth: 280, maxWidth: 400)
              }
            } else {
              VStack(alignment: .leading, spacing: AglynSpace.three) {
                quickActions
                glance
                activity
              }
            }
          }
        }
      }
      .padding(AglynSpace.two)
      .frame(maxWidth: 1200, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(AglynColor.page)
    .navigationTitle("Home")
    .refreshable { model.refresh() }
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      feed.start(reader: model.reader, uid: model.auth?.user?.uid, count: Self.recentWindow)
    }
    .task(id: "\(model.workspace?.site?.id ?? ""):\(model.refreshToken)") {
      site.start(reader: model.reader, hostID: model.workspace?.site?.id)
    }
  }

  // MARK: 1. The site

  private var header: some View {
    let picked = model.workspace?.site
    let address = HostStatus.siteAddress(picked?.subdomain)
    return SiteHeaderCard(
      workspace: model.workspace?.org?.name,
      name: picked?.name ?? (model.workspace?.ready == true ? "Pick a site" : "Loading site"),
      address: address,
      status: site.chip,
      // Live needs no sentence: the pages card counts them.
      detail: site.status.flatMap { $0.kind == .live ? nil : $0.detail },
      loading: model.workspace?.ready != true,
      onVisit: address.flatMap { URL(string: "https://\($0)/") }.map { url in { openURL(url) } },
      onSwitch: { navigation.showSwitcher = true })
  }

  // MARK: 2. Quick actions

  private var quickActions: some View {
    let actions = model.registry.quickActions(for: .aglyn).filter { hasSite || !$0.requiresSite }
    return Group {
      if !actions.isEmpty {
        VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
          AglynSectionHeader("Quick actions")
          AglynGrid(minimum: 76) {
            ForEach(actions) { action in
              QuickActionTile(action.title, systemImage: action.icon) {
                navigation.push(.screen(action.screen, action.params))
              }
              .accessibilityIdentifier("quick-action-\(action.id)")
            }
          }
        }
      }
    }
  }

  // MARK: 3. At a glance

  private var glance: some View {
    let widgets = model.registry.widgets(for: .aglyn).filter { hasSite || !$0.requiresSite }
    let rows = feed.rows
    let unread = rows?.filter { !$0.read }.count
    let pages = site.status?.publishedPages
    return VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      AglynSectionHeader("At a glance")
      AglynCardGrid(minimum: 160, maxColumns: 3) {
        if hasSite {
          MetricCard(
            "Published pages", systemImage: "doc.text",
            value: site.loaded ? pages.map(String.init) ?? "0" : nil,
            caption: pages == 0 ? "Nothing published yet" : pages == 1 ? "page visitors can open" : "pages visitors can open",
            failed: site.failed ? "Could not load this site." : nil)
          .accessibilityIdentifier("glance-pages")
        }
        MetricCard(
          "Unread notifications", systemImage: "bell",
          value: unread.map(String.init),
          caption: unread == 0 ? "You're all caught up" : "of \(rows?.count ?? 0) recent",
          actionLabel: "Open notifications", failed: feed.failed ? "Could not load notifications." : nil
        ) {
          navigation.select(.notifications)
        }
        .accessibilityIdentifier("glance-unread")
        if let context = model.context(for: navigation) {
          ForEach(widgets) { widget in
            widget.make(context)
              .aglynGridFullWidth(widget.size == .full)
              .id("\(widget.id):\(context.hostID ?? ""):\(model.refreshToken)")
          }
        }
      }
    }
  }

  // MARK: 4. Recent activity

  private var activity: some View {
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      AglynSectionHeader("Recent activity") {
        Button("All notifications") { navigation.select(.notifications) }.buttonStyle(.borderless)
      }
      if let rows = feed.rows {
        if rows.isEmpty {
          AglynEmptyState("No activity yet", systemImage: "bell", message: "Orders, form submissions and bookings show up here.")
            .aglynCardSurface()
        } else {
          AglynListCard(Array(rows.prefix(Self.recentShown))) { row in
            Button { openNotification(row, model: model, navigation: navigation) } label: {
              NotificationRow(row: row)
            }
            .buttonStyle(.plain)
          }
        }
      } else {
        AglynListCard([0, 1, 2].map { SkeletonID(id: $0) }) { _ in
          ActivityRow("Loading a notification", subtitle: "Loading its body", time: "now", systemImage: "bell", tone: .info, unread: false)
            .redacted(reason: .placeholder)
        }
      }
    }
  }
}

private struct SkeletonID: Identifiable { let id: Int }
