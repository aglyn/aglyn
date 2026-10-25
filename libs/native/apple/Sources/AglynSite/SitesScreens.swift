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
  /// Opens Create site on arrival (Create new's Site, `new=1`).
  var startNew = false
  @State private var model = SitesListModel()
  @State private var selection: String?
  @State private var searchText = ""
  @State private var creating = false
  @Environment(\.aglynWideChrome) private var wide

  private var canCreate: Bool { siteCreatorRoles.contains(context.orgRole ?? "") }

  var body: some View {
    Group {
      if let orgID = context.orgID {
        // One list on every device (Figma Mac Sites 13:3): a site opens on its own page.
        list(selectable: false)
        .sheet(isPresented: $creating) { CreateSiteSheet(context: context, orgID: orgID) }
        .task(id: orgID) {
          // Create new's Site and the site switcher's Create site land here; the sheet says first when the role or the
          // plan stops it, as the console's dialog does.
          if startNew { creating = true }
          model.start(context.firestore, uid: context.uid, orgID: orgID)
        }
      } else {
        AglynEmptyState("Pick a workspace first", systemImage: "square.stack.3d.up")
      }
    }
    .navigationTitle("Sites")
    .aglynScreenTitle("Sites")
    .aglynSearchable(text: $searchText, prompt: "Search sites") {
      AglynFilterMenu(active: model.domain == .all ? nil : model.domain.label) {
        Picker("Sites", selection: Binding(get: { model.domain }, set: { model.domain = $0 })) {
          ForEach(SiteDomainFilter.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.inline)
      }
    }
    .task(id: searchText) {
      try? await Task.sleep(nanoseconds: 300_000_000)
      if !Task.isCancelled { model.search = searchText }
    }
    .aglynPrimaryAction(id: "add-site", "New site", systemImage: "plus", enabled: canCreate && context.orgID != nil) {
      creating = true
    }
    .onDisappear { model.stop() }
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      // On a phone the filter chips sit over the list; the Mac and iPad keep them in the list toolbar's Filter.
      if !wide {
        AglynChipRow(
          SiteDomainFilter.allCases.map { AglynChipOption($0.rawValue, $0.label) }, selected: model.domain.rawValue
        ) { model.domain = SiteDomainFilter(rawValue: $0) ?? .all }
      }
      content(selectable: selectable)
    }
    .background(AglynGround())
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
        if !filtered && canCreate { Button("Create site") { creating = true }.buttonStyle(.aglynProminent) }
      }
    case .ready(let rows):
      if selectable {
        List {
          ForEach(rows) { row in
            SiteListRow(context: context, row: row).aglynSelectableRow(row.id, selection: $selection)
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
        .aglynSelectableListStyle()
        .aglynSelectionKeys(rows.map(\.id), selection: $selection)
        .accessibilityIdentifier("sites-list")
      } else {
        List {
          ForEach(rows) { row in
            // Clicking a site opens it: the sidebar drills into its scope (no separate "work on this site" step).
            Button {
              context.selectSite(row.id)
            } label: {
              HStack(spacing: 8) {
                SiteListRow(context: context, row: row)
                Image(systemName: "chevron.forward").font(.system(size: 12, weight: .semibold))
                  .foregroundStyle(AglynColor.textTertiary).frame(width: 16, height: 16)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.aglynRow)
            // On the content edges, the favicon on E and the chevron on width − E, a hairline between rows (Figma 13:3).
            .aglynContentRow(separator: row.id != rows.last?.id || model.hasMore)
            .accessibilityIdentifier("site-\(row.id)")
          }
          if model.hasMore { AglynLoadMoreRow("Show more sites") { model.loadMore() } }
        }
        .refreshable { model.refresh() }
        .aglynContentList()
        .accessibilityIdentifier("sites-list")
      }
    }
  }
}

/// One row of the sites list (Figma Mac Sites 13:3): the site's favicon, else its initial on its brand color; its name
/// and address; its status; when it was last edited; a chevron. The role is the site page's, not the row's.
struct SiteListRow: View {
  let context: NativePluginContext
  let row: SiteRow
  @State private var host = LiveDocument()

  var body: some View {
    let doc = host.state.value ?? nil
    let status = doc.map { HostStatus.describe($0.data) }
    // The site's favicon, as the console's Sites list shows it (`HostIcon`): the host's own `seo.favicon`, else the
    // membership row's copy of it.
    let favicon = siteFavicon(doc) ?? row.favicon
    // The address the live site answers on: the host's own custom domain once it is read (a membership row written
    // before the mirror carried `cname` lacks it), else the row's custom domain, else the platform address.
    let address = row.shownAddress(hostCname: doc?.string("cname"))
    // Figma List/Site row 36:826: a 36-point favicon, the name at 14 semibold over the address at 12, then the chips and
    // when it was edited; 62 points tall, 12 above and below and 14 between, its sides on the content edges.
    HStack(spacing: 14) {
      AglynBrandPicture(
        mediaPreviewURL(favicon, origin: context.api.origin, hostID: row.id, width: 96), size: 36, cornerRadius: 8
      ) {
        AglynWorkspaceTile(name: row.name, logoURL: nil, colorHex: siteBrandColor(doc), selected: false, size: 36)
          .padding(-3)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(row.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
          .lineLimit(1).truncationMode(.tail)
        Text(address ?? "").font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText)
          .lineLimit(1).truncationMode(.middle)
      }
      Spacer(minLength: 8)
      if row.id == context.hostID { StatusChip("Current", tone: .info) }
      if let status { StatusChip(status.label, tone: hostStatusTone(status.kind)) }
      if let edited = (doc?.data["updatedAt"] as? Date) ?? (doc?.data["createdAt"] as? Date) {
        Text("Edited \(edited.formatted(.relative(presentation: .named)))")
          .font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
          .layoutPriority(-1)
      }
    }
    .frame(minHeight: 38)
    .padding(.vertical, 12)
    .task(id: row.id) { await host.bind(context.firestore, ["hosts", row.id]) }
  }
}

/// A site's brand color, as its theme holds it (`theme.colorSchemes.light.primary.main`).
func siteBrandColor(_ doc: FirestoreDocument?) -> String? {
  let theme = doc?.data["theme"] as? [String: Any]
  let light = (theme?["colorSchemes"] as? [String: Any])?["light"] as? [String: Any]
  return (light?["primary"] as? [String: Any])?["main"] as? String
}

/// A host document's favicon (`seo.favicon`), as the console stores it: a reference, a CDN path or an address.
func siteFavicon(_ doc: FirestoreDocument?) -> String? {
  ((doc?.data["seo"] as? [String: Any])?["favicon"] as? String).flatMap { $0.trimmed.isEmpty ? nil : $0 }
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
    let favicon = siteFavicon(doc)
    let current = hostID == context.hostID
    let domain = custom ?? platform
    return Form {
      Section {
        HStack(spacing: AglynSpace.oneAndHalf) {
          AglynRemoteImage(mediaPreviewURL(favicon, origin: context.api.origin, hostID: hostID, width: 160), systemImage: SiteSymbols.site)
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
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("site-area-\(area.screen)")
          }
        }
      } else {
        Section {
          AglynNotice("Switch to this site to manage its pages, media and setup.", tone: .info)
        }
      }
    }
    .formStyle(.aglynGrouped)
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

  /// What the create would refuse anyway, said first (the console's dialog): nil while unknown or when nothing stops it.
  @State private var blocked: CreateSiteBlock?

  private var valid: Bool { !name.trimmed.isEmpty && isValidSubdomain(subdomain) }

  var body: some View {
    if let blocked {
      blockedSheet(blocked)
    } else {
      form.task(id: orgID) { blocked = await createSiteBlock(context, orgID: orgID) }
    }
  }

  /// The console's blocked dialog: the reason, Close, and Go to Billing when the plan is what stops it.
  private func blockedSheet(_ block: CreateSiteBlock) -> some View {
    NavigationStack {
      Form {
        Section { AglynNotice(block.message, tone: block == .role ? .warning : .info) }
      }
      .formStyle(.aglynGrouped)
      .navigationTitle("Create a site")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        if block != .role {
          ToolbarItem(placement: .confirmationAction) {
            Button("Go to Billing") {
              dismiss()
              context.navigate("core.billing")
            }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("create-site-billing")
          }
        }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 220)
    .accessibilityIdentifier("create-site-blocked")
  }

  private var form: some View {
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
          // One label: the row's ("Address"); the field draws none of its own (it read "Address Address" on the Mac).
          TextField(
            "Address", text: Binding(get: { subdomain }, set: { edited = true; subdomain = cleanSubdomainInput($0) }),
            prompt: Text("your-site")
          )
          .labelsHidden()
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
                .buttonStyle(.aglynSecondary)
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

/// Why Create site cannot go ahead, as the console's dialog says it before the form (`create-host-dialog`): the role
/// first, then the plan's site limit.
enum CreateSiteBlock: Equatable {
  case role
  case limit(Int)

  var message: String {
    switch self {
    case .role:
      "Your role in this workspace does not allow creating sites. Ask a workspace owner or admin to create it, or to "
        + "change your role."
    case .limit(let limit):
      "Your plan includes \(limit == 1 ? "one site" : "\(limit) sites"), and this workspace is using all of them. "
        + "Upgrade or add extra sites from Billing."
    }
  }
}

/// The console's check before Create site (`CreateHostDialog`): the role may create sites (`hosts.create`), and the
/// workspace's `hosts` directory is under the plan's `hostLimit` (`checkQuota`). Nil when nothing stops it or it cannot
/// tell; the route still refuses what it must.
@MainActor
func createSiteBlock(_ context: NativePluginContext, orgID: String) async -> CreateSiteBlock? {
  if let role = context.orgRole, !siteCreatorRoles.contains(role) { return .role }
  guard let entitlements = try? await context.api.request("/api/orgs/entitlements", query: [("orgId", orgID)]),
    let limit = entitlements["quotas"]?["hostLimit"]?.numberValue
  else { return nil }
  // The org document, read once: its `hosts` directory is what the console's dialog counts. Nil only when the read
  // failed; a workspace with no directory yet counts none, as the dialog's does.
  let directory: [String: Any]? = await withCheckedContinuation { continuation in
    var listener: FirestoreListening?
    var answered = false
    listener = context.firestore.listenDocument(["orgs", orgID]) { result in
      guard !answered else { return }
      answered = true
      listener?.remove()
      guard let document = try? result.get() else { return continuation.resume(returning: nil) }
      continuation.resume(returning: document.data["hosts"] as? [String: Any] ?? [:])
    }
  }
  guard let directory else { return nil }
  return siteLimitBlock(limit: Int(limit), directory: directory)
}

/// The console dialog's count of a workspace's sites against its plan's `hostLimit`: the entries of the org's `hosts`
/// directory that are set (`Object.values(hosts).filter(Boolean)`); nil while there is room.
func siteLimitBlock(limit: Int, directory: [String: Any]) -> CreateSiteBlock? {
  let used = directory.values.filter(isSet).count
  return used >= limit ? .limit(limit) : nil
}

/// JavaScript's `Boolean(value)` for a Firestore value: null, false, 0 and "" are unset; anything else is set.
private func isSet(_ value: Any) -> Bool {
  if value is NSNull { return false }
  if let flag = value as? Bool { return flag }
  if let number = value as? Double { return number != 0 && !number.isNaN }
  if let text = value as? String { return !text.isEmpty }
  return true
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
