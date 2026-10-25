// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import SwiftUI

// A SITE'S ANALYTICS, as the console's Analytics page shows them, as a list of sections beside the one picked
// (AGL-4011): Traffic, Pages (Pro; a row opens that page's traffic), Funnels when the plugin is on, and At a glance.
// The cards are AglynSite's (SiteAnalytics.swift); this screen only lays them out. The Kotlin shell's Analytics.kt is
// the same screen.

/// The core page's widget slot, as the console's `PluginWidgetSlot`: a whole section a plugin computes (funnels).
let hostAnalyticsSlot = "hostAnalytics"

/// One section of the Analytics list.
enum AnalyticsSection: String, CaseIterable, Identifiable, Hashable {
  case traffic, pages, funnels, glance

  var id: String { rawValue }

  var title: String {
    switch self {
    case .traffic: "Traffic"
    case .pages: "Pages"
    case .funnels: "Funnels"
    case .glance: "At a glance"
    }
  }

  var supporting: String {
    switch self {
    case .traffic: "Page views, visitors and where they came from"
    case .pages: "Each page’s views, side by side"
    case .funnels: "Where visitors drop off"
    case .glance: "Sales, leads and tasks"
    }
  }

  var systemImage: String {
    switch self {
    case .traffic: "chart.bar.xaxis"
    case .pages: "doc.on.doc"
    case .funnels: "line.3.horizontal.decrease"
    case .glance: "square.grid.2x2"
    }
  }
}

/// A page picked in the Pages table: its traffic opens in place of the table.
struct AnalyticsPageDrill: Hashable, Identifiable {
  let screenID: String
  let path: String
  var id: String { screenID }
}

struct AnalyticsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var selection: AnalyticsSection?
  @State private var pushed: AnalyticsSection?
  @State private var drill: AnalyticsPageDrill?

  private var hostID: String? { model.scopedSite(navigation)?.id }

  private var sections: [AnalyticsSection] {
    AnalyticsSection.allCases.filter {
      switch $0 {
      case .funnels: model.registry.screen(funnelsScreen) != nil || !model.registry.widgets(for: .aglyn, slot: hostAnalyticsSlot).isEmpty
      case .glance: !glanceWidgets.isEmpty
      default: true
      }
    }
  }

  private let funnelsScreen = "funnels.list"

  private var glanceWidgets: [NativeWidget] { model.registry.widgets(for: .aglyn).filter { hostID != nil || !$0.requiresSite } }

  var body: some View {
    WideLayoutReader { wide in
      if hostID == nil {
        AglynEmptyState("Pick a site first", systemImage: "globe", message: "Analytics are one site's.")
      } else if wide {
        AglynListDetailColumns(listWidth: 320) {
          List {
            ForEach(sections) { section in
              AglynRow(section.title, subtitle: section.supporting, systemImage: section.systemImage)
                .aglynSelectableRow(section, selection: $selection)
                .accessibilityIdentifier("analytics-section-\(section.id)")
            }
          }
          .aglynSelectableListStyle()
          .aglynSelectionKeys(sections, selection: $selection)
        } detail: {
          if let selection {
            detail(selection).id(selection)
          } else {
            AglynSelectionPlaceholder("No section selected", systemImage: "chart.bar.xaxis")
          }
        }
        .onAppear { if selection == nil { selection = .traffic } }
      } else {
        List {
          ForEach(sections) { section in
            Button {
              pushed = section
            } label: {
              AglynRow(section.title, subtitle: section.supporting, systemImage: section.systemImage) {
                Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
              }
            }
            .buttonStyle(.aglynRow)
            .aglynListRow()
            .accessibilityIdentifier("analytics-section-\(section.id)")
          }
        }
        .aglynListBackground()
        .aglynPushDestination(item: $pushed) { section in
          detail(section).navigationTitle(section.title).aglynScreenTitle(section.title)
        }
      }
    }
    .navigationTitle("Analytics")
    .aglynScreenTitle("Analytics")
    .refreshable { model.refresh() }
    .onChange(of: selection) { drill = nil }
    .accessibilityIdentifier("analytics")
  }

  @ViewBuilder
  private func detail(_ section: AnalyticsSection) -> some View {
    if let hostID, let reader = model.reader {
      switch section {
      case .traffic:
        scroll { SiteTrafficCard(reader: reader, api: model.api, hostID: hostID, detail: true, refresh: model.refreshToken) }
      case .pages:
        if let drill {
          scroll {
            Button {
              self.drill = nil
            } label: {
              Label("Pages", systemImage: "chevron.left")
            }
            .buttonStyle(.borderless)
            .foregroundStyle(AglynColor.tint)
            .accessibilityIdentifier("analytics-page-back")
            Text(drill.path).font(AglynFont.title2).lineLimit(1).truncationMode(.middle)
            PageTrafficCard(reader: reader, api: model.api, hostID: hostID, screenID: drill.screenID, refresh: model.refreshToken) {
              openPlans()
            }
          }
        } else {
          scroll {
            SitePagesTrafficCard(reader: reader, api: model.api, hostID: hostID, refresh: model.refreshToken, upgrade: openPlans) {
              drill = AnalyticsPageDrill(screenID: $0, path: $1)
            }
          }
        }
      case .funnels:
        if let context = model.context(for: navigation) {
          let widgets = model.registry.widgets(for: .aglyn, slot: hostAnalyticsSlot)
          if !widgets.isEmpty {
            scroll { ForEach(widgets) { $0.make(context).accessibilityIdentifier("widget-\($0.id)") } }
          } else if let screen = model.registry.screen(funnelsScreen) {
            screen.make(context, [:])
          }
        }
      case .glance:
        scroll { HomeGlanceGrid(title: nil) }
      }
    }
  }

  private func scroll<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.three) { content() }
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.vertical, AglynSpace.three)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(AglynColor.paper)
  }

  /// The plans, where the upgrade the card names is bought (the console's Upgrade goes to Billing).
  private func openPlans() {
    navigation.push(.screen("core.billing.plans", [:]))
  }
}
