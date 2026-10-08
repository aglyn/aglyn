// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

func hostStatusTone(_ kind: HostStatus.Kind) -> AglynTone {
  switch kind {
  case .live: .success
  case .draft: .neutral
  case .maintenance: .warning
  case .suspended: .error
  }
}

/// Roles that may create a site in the workspace.
let siteCreatorRoles: Set<String> = ["owner", "admin"]

/// The workspace's sites, the picked one beside the list in a wide window:
/// search, the custom-domain filter, create a site, and open or switch to
/// one, with its status and addresses.
struct SitesScreen: View {
  let context: NativePluginContext
  var initialSiteID: String?
  @State private var model = SitesListModel()
  @State private var selection: String?
  @State private var searchText = ""
  @State private var creating = false

  private var canCreate: Bool { siteCreatorRoles.contains(context.orgRole ?? "") }

  var body: some View {
    Group {
      if let orgID = context.orgID {
        WideLayoutReader { wide in
          if wide {
            HStack(spacing: 0) {
              list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
              Divider()
              Group {
                if let selection {
                  SiteOverview(context: context, hostID: selection).id(selection)
                } else {
                  AglynEmptyState("Pick a site to see it here", systemImage: SiteSymbols.site)
                }
              }
              .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
          } else {
            list(selectable: false)
          }
        }
        .sheet(isPresented: $creating) { CreateSiteSheet(context: context, orgID: orgID) }
        .task(id: orgID) { model.start(context.firestore, uid: context.uid, orgID: orgID) }
      } else {
        AglynEmptyState("Pick a workspace first", systemImage: "square.stack.3d.up")
      }
    }
    .navigationTitle("Sites")
    .searchable(text: $searchText, prompt: "Search sites")
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          creating = true
        } label: {
          Label("Create site", systemImage: "plus")
        }
        .disabled(!canCreate || context.orgID == nil)
        .keyboardShortcut("n", modifiers: .command)
        .help(canCreate ? "Create a site" : "Only a workspace owner or admin creates sites")
        .accessibilityIdentifier("add-site")
      }
    }
    .onDisappear { model.stop() }
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      AglynChipRow(
        SiteDomainFilter.allCases.map { AglynChipOption($0.rawValue, $0.label) }, selected: model.domain.rawValue
      ) { model.domain = SiteDomainFilter(rawValue: $0) ?? .all }
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    switch model.rows {
    case .loading:
      List { SkeletonRows(count: 6) }.aglynListBackground()
    case .failed(let message):
      AglynEmptyState("Could not load sites", systemImage: SiteSymbols.error, message: message) {
        Button("Try again") { model.refresh() }
      }
    case .ready(let rows) where rows.isEmpty:
      let filtered = !model.search.isEmpty || model.domain != .all
      AglynEmptyState(
        filtered ? "No sites match" : "No sites yet", systemImage: SiteSymbols.site,
        message: filtered ? "Try another search or filter." : "Create a site to start building."
      ) {
        if !filtered && canCreate { Button("Create site") { creating = true }.buttonStyle(.borderedProminent) }
      }
    case .ready(let rows):
      if selectable {
        List(selection: $selection) {
          ForEach(rows) { row in
            SiteListRow(context: context, row: row).tag(row.id)
              .aglynListRow()
              .accessibilityIdentifier("site-\(row.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more sites") { model.loadMore() } }
        }
        .onChange(of: rows, initial: true) { _, rows in
          if selection == nil || !rows.contains(where: { $0.id == selection }) {
            let preferred = initialSiteID ?? context.hostID
            selection = rows.first { $0.id == preferred }?.id ?? rows.first?.id
          }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .refreshable { model.refresh() }
        .aglynListBackground()
        .accessibilityIdentifier("sites-list")
      } else {
        List {
          ForEach(rows) { row in
            NavigationLink {
              SiteOverview(context: context, hostID: row.id).navigationTitle(row.name)
            } label: {
              SiteListRow(context: context, row: row)
            }
            .aglynListRow()
            .accessibilityIdentifier("site-\(row.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more sites") { model.loadMore() } }
        }
        .refreshable { model.refresh() }
        .aglynListBackground()
        .accessibilityIdentifier("sites-list")
      }
    }
  }
}

/// One row of the sites list, with its site's live status.
struct SiteListRow: View {
  let context: NativePluginContext
  let row: SiteRow
  @State private var host = LiveDocument()

  var body: some View {
    let doc = host.state.value ?? nil
    let status = doc.map { HostStatus.describe($0.data) }
    AglynRow(
      row.name,
      subtitle: [HostStatus.siteAddress(row.subdomain), row.role.map(\.capitalized)].compactMap { $0 }
        .joined(separator: " · "),
      systemImage: SiteSymbols.site
    ) {
      HStack(spacing: AglynSpace.half) {
        if row.id == context.hostID { StatusChip("Current", tone: .info) }
        if let status { StatusChip(status.label, tone: hostStatusTone(status.kind)) }
      }
    }
    .task(id: row.id) { await host.bind(context.firestore, ["hosts", row.id]) }
  }
}

/// One site: its status, addresses and what it holds, with the switch that
/// makes it the site every screen shows, and its areas.
struct SiteOverview: View {
  let context: NativePluginContext
  let hostID: String
  @Environment(\.openURL) private var openURL
  @State private var host = LiveDocument()

  var body: some View {
    Group {
      switch host.state {
      case .loading:
        List { SkeletonRows(count: 6) }.aglynListBackground()
      case .failed:
        AglynEmptyState(
          "Could not load this site", systemImage: SiteSymbols.error, message: "You may no longer have access to it.")
      case .ready(nil):
        AglynEmptyState("This site is gone", systemImage: SiteSymbols.site)
      case .ready(let doc?):
        overview(doc)
      }
    }
    .task(id: hostID) { await host.bind(context.firestore, ["hosts", hostID]) }
  }

  private func overview(_ doc: FirestoreDocument) -> some View {
    let status = HostStatus.describe(doc.data)
    let subdomain = doc.string("subdomain")
    let name = doc.string("displayName").flatMap { $0.trimmed.isEmpty ? nil : $0 } ?? subdomain ?? hostID
    let platform = HostStatus.siteAddress(subdomain)
    let custom = doc.string("cname").flatMap { $0.trimmed.isEmpty ? nil : $0 }
    let favicon = (doc.data["seo"] as? [String: Any])?["favicon"] as? String
    let current = hostID == context.hostID
    let domain = custom ?? platform
    return Form {
      Section {
        HStack(spacing: AglynSpace.oneAndHalf) {
          AglynRemoteImage(favicon.flatMap { $0.hasPrefix("http") ? URL(string: $0) : nil }, systemImage: SiteSymbols.site)
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          VStack(alignment: .leading, spacing: 2) {
            Text(name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
            if let domain { Text(domain).font(AglynFont.subheadline).foregroundStyle(.secondary) }
          }
          Spacer(minLength: AglynSpace.one)
          StatusChip(status.label, tone: hostStatusTone(status.kind))
        }
        Text(status.detail).font(AglynFont.subheadline).foregroundStyle(.secondary)
        if current {
          Label("You are working on this site", systemImage: "checkmark.circle.fill")
            .foregroundStyle(AglynColor.info)
        } else {
          Button {
            context.selectSite(hostID)
          } label: {
            Label("Work on this site", systemImage: "arrow.left.arrow.right")
          }
          .accessibilityIdentifier("site-switch")
        }
        if let domain, let url = URL(string: "https://\(domain)/") {
          Button {
            openURL(url)
          } label: {
            Label("Visit site", systemImage: "arrow.up.right.square")
          }
          .accessibilityIdentifier("site-visit")
        }
      }
      Section("Addresses") {
        AglynDetailRow("Platform address", value: platform)
        AglynDetailRow("Custom domain", value: custom, placeholder: "None connected")
        AglynDetailRow("Published pages", value: String(status.publishedPages))
        AglynDetailRow("Created", value: doc.date("createdAt").map { relativeTime($0) })
      }
      if current {
        Section("Manage") {
          ForEach(SiteAreas.allCases, id: \.screen) { area in
            Button {
              context.navigate(area.screen)
            } label: {
              AglynRow(area.title, subtitle: area.supporting, systemImage: area.systemImage) {
                Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
              }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("site-area-\(area.screen)")
          }
        }
      } else {
        Section {
          AglynNotice("Switch to this site to manage its pages, media and setup.", tone: .info)
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("site-detail")
  }
}

/// Create a site, as the console's Create site: a name, an address the
/// route checks, and the addresses it suggests when the one asked for is taken.
struct CreateSiteSheet: View {
  let context: NativePluginContext
  let orgID: String
  @Environment(\.dismiss) private var dismiss
  @State private var runner = ActionRunner(roleHint: "a workspace owner or admin")
  @State private var name = ""
  @State private var subdomain = ""
  @State private var edited = false
  @State private var suggestions: [String] = []

  private var valid: Bool { !name.trimmed.isEmpty && isValidSubdomain(subdomain) }

  var body: some View {
    AglynActionSheet(
      "Create a site", message: "You can connect your own domain later.", confirmLabel: "Create site",
      confirmEnabled: valid, busy: runner.busy, error: runner.error, onCancel: { dismiss() },
      onConfirm: create
    ) {
      TextField(
        "Site name",
        text: Binding(
          get: { name },
          set: { next in
            name = next.capped(80)
            if !edited { subdomain = suggestSubdomain(next) }
          })
      )
      .accessibilityIdentifier("site-name")
      LabeledContent {
        HStack(spacing: 2) {
          TextField(
            "Address", text: Binding(get: { subdomain }, set: { edited = true; subdomain = cleanSubdomainInput($0) })
          )
          .autocorrectionDisabled()
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
          #endif
          .multilineTextAlignment(.trailing)
          .accessibilityIdentifier("site-subdomain")
          Text(".\(HostStatus.defaultTenantApex)").foregroundStyle(.secondary)
        }
      } label: {
        Text("Address")
      }
      if !subdomain.isEmpty && !isValidSubdomain(subdomain) {
        Text("3 to 30 letters, numbers or hyphens.").font(AglynFont.caption).foregroundStyle(AglynColor.error)
      }
      if !suggestions.isEmpty {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text("Try one of these:").font(AglynFont.strongSubheadline)
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AglynSpace.one) {
              ForEach(suggestions, id: \.self) { suggestion in
                Button(suggestion) {
                  subdomain = suggestion
                  edited = true
                }
                .buttonStyle(.bordered)
              }
            }
          }
        }
      }
    }
  }

  private func create() {
    let (name, subdomain) = (name, subdomain)
    runner.run {
      switch try await createSite(context.api, orgID: orgID, name: name, subdomain: subdomain) {
      case .created(let hostID, _):
        context.selectSite(hostID)
        dismiss()
      case .refused(let message, let offered):
        suggestions = offered
        runner.error = message
      }
    }
  }
}

/// The picked site's own overview screen.
struct CurrentSiteScreen: View {
  let context: NativePluginContext
  let params: NativeParams

  var body: some View {
    if let hostID = params["site"] ?? context.hostID {
      SiteOverview(context: context, hostID: hostID).navigationTitle("Site")
    } else {
      AglynEmptyState("Pick a site first", systemImage: SiteSymbols.site)
    }
  }
}
