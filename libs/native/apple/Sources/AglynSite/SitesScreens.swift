// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

func hostStatusTone(_ kind: HostStatus.Kind) -> AglynTone {
  switch kind {
  case .live: .success
  case .draft: .neutral
  case .preview: .neutral
  case .maintenance: .warning
  case .suspended: .error
  }
}

/// Roles that may create a site in the workspace.

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
  /// A pin past the account-wide bound, waiting on "Pinned is full. Replace one?".
  @State private var pinning: PendingSitePin?
  /// The Created filter's sheet is open.
  @State private var choosingCreated = false
  /// The workspace's plan and its site cap (`/api/orgs/entitlements`), for "6 of 10 sites · Pro plan".
  @State private var allowancePlan: SiteAllowancePlan?
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.openURL) private var openURL

  private var canCreate: Bool { context.can("hosts.create") }

  var body: some View {
    Group {
      if let orgID = context.orgID {
        // One list on every device (Figma Mac Sites 13:3): a site opens on its own page.
        list(selectable: false)
        .sheet(isPresented: $creating) {
          // Buying a starter leaves the sheet for the console's own Create site, which opens on that pick.
          CreateSiteSheet(context: context, orgID: orgID) { address in
            creating = false
            openURL(address)
          }
        }
        .task(id: orgID) {
          // Create new's Site and the site switcher's Create site land here; the sheet says first when the role or the
          // plan stops it, as the console's dialog does.
          if startNew { creating = true }
          model.start(context.firestore, uid: context.uid, orgID: orgID)
        }
        .task(id: pinned) { model.watchPinned(pinned) }
        .sheet(item: $pinning) { pending in
          SitePinnedFullSheet(
            pending: pending, pins: pinned.map { SitePinChoice(id: $0, name: siteName($0)) },
            onReplace: { replacing in
              context.preferences?.replaceHostPin(replacing, with: pending.id, orgID: orgID)
              pinning = nil
            },
            onClose: { pinning = nil })
        }
        .sheet(isPresented: $choosingCreated) {
          SiteCreatedFilterSheet(current: model.created) { picked in
            model.created = picked
            choosingCreated = false
          } onCancel: {
            choosingCreated = false
          }
        }
        .task(id: orgID) {
          allowancePlan = nil
          if let body = try? await context.api.request("/api/orgs/entitlements", query: [("orgId", orgID)]) {
            allowancePlan = SiteAllowancePlan(body)
          }
        }
      } else {
        AglynEmptyState("Pick a workspace first", systemImage: "square.stack.3d.up")
      }
    }
    .navigationTitle("Sites")
    .aglynScreenTitle("Sites")
    .aglynSearchable(text: $searchText, prompt: "Search sites") {
      AglynFilterMenu(active: activeFilter) {
        Picker("Sites", selection: Binding(get: { model.domain }, set: { model.domain = $0 })) {
          ForEach(SiteDomainFilter.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.inline)
        // The console's Created range (`SITE_FILTER_FIELDS`): one condition and one day.
        Button(model.created == nil ? "Created…" : "Change Created…", systemImage: "calendar") { choosingCreated = true }
          .accessibilityIdentifier("sites-filter-created")
        if model.created != nil {
          Button("Clear Created", systemImage: "xmark") { model.created = nil }
        }
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

  /// The workspace's pinned sites, in the order pinned (`users/{uid}.pinnedHosts`).
  private var pinned: [String] { context.orgID.flatMap { context.preferences?.pinnedHosts(in: $0) } ?? [] }

  /// The Filter control reads as on with the filter's name, or how many are on.
  private var activeFilter: String? {
    let on = [model.domain == .all ? nil : model.domain.label, model.created?.label].compactMap { $0 }
    return on.count > 1 ? "\(on.count) filters" : on.first
  }

  /// A site's name for the replace question: the list's row, else the workspace's sites, else a site gone from reach.
  private func siteName(_ id: String) -> String {
    if case .ready(let rows) = model.rows, let row = rows.first(where: { $0.id == id }) { return row.name }
    if let row = model.pinnedRows.first(where: { $0.id == id }) { return row.name }
    return context.sites.first { $0.id == id }?.name ?? "A site you can no longer open"
  }

  /// Pins or unpins a site (the console's pin on a site card); past the account-wide bound, asks which pin to replace.
  private func togglePin(_ row: SiteRow) {
    guard let orgID = context.orgID, let preferences = context.preferences else { return }
    if preferences.toggleHostPin(row.id, orgID: orgID) == .full { pinning = PendingSitePin(id: row.id, name: row.name) }
  }

  /// The list has answered, so the count is a measurement and not a placeholder.
  private var listRead: Bool {
    if case .ready = model.rows { return true }
    return false
  }

  /// `6 of 10 sites · Pro plan` beside Create site (the console's AGL-2166 readout): the sites this person can open in the
  /// workspace against the plan's cap, once both are read.
  private var allowance: String? {
    describeSiteAllowance(
      used: context.sites.count, limit: allowancePlan?.hostLimit, planLabel: allowancePlan?.planLabel,
      ready: allowancePlan != nil && listRead)
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      // The one-time product-updates ask (AGL-3185), where the console puts it: over the Sites list.
      ProductUpdatesAsk(context: context)
      if let allowance {
        HStack {
          Spacer(minLength: 0)
          Text(allowance).font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
            .accessibilityIdentifier("sites-allowance")
        }
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.bottom, AglynSpace.half)
      }
      // On a phone the filter chips sit over the list; the Mac and iPad keep them in the list toolbar's Filter.
      if !wide {
        AglynChipRow(
          SiteDomainFilter.allCases.map { AglynChipOption($0.rawValue, $0.label) }, selected: model.domain.rawValue
        ) { model.domain = SiteDomainFilter(rawValue: $0) ?? .all }
      }
      if let created = model.created {
        // A filter that is on, as a chip under the toolbar (Calm rule 3); × turns it off.
        HStack {
          AglynFilterChip(created.label) { model.created = nil }.accessibilityIdentifier("sites-created-chip")
          Spacer(minLength: 0)
        }
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.vertical, AglynSpace.half)
      }
      ForEach(Array(model.refused.enumerated()), id: \.offset) { _, refusal in
        AglynNotice("That filter was not applied: \(refusal.reason).", tone: .warning)
          .padding(.horizontal, AglynContentInsets.horizontal)
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
      let filtered = model.filtering
      AglynEmptyState(
        filtered ? "No sites match" : "No sites yet", systemImage: SiteSymbols.site,
        message: filtered ? "Try another search or filter." : "Create a site to start building."
      ) {
        if !filtered && canCreate { Button("Create site") { creating = true }.buttonStyle(.aglynProminent) }
      }
    case .ready(let queried):
      let pinnedIDs = pinned
      let rows = sitesShown(queried, pinned: pinnedIDs, pinnedRows: model.pinnedRows, filtering: model.filtering)
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
            let isPinned = pinnedIDs.contains(row.id)
            HStack(spacing: 8) {
              // Clicking a site opens it: the sidebar drills into its scope (no separate "work on this site" step).
              Button {
                context.selectSite(row.id)
              } label: {
                SiteListRow(context: context, row: row).contentShape(Rectangle())
              }
              .buttonStyle(.aglynRow)
              .accessibilityIdentifier("site-\(row.id)")
              // The pin beside the status, as on the console's site card: a pinned site leads the list.
              if context.preferences != nil, let orgID = context.orgID {
                SitePinButton(
                  name: row.name, pinned: isPinned,
                  full: context.preferences?.hostPinsFull(in: orgID) == true
                ) { togglePin(row) }
                .accessibilityIdentifier("site-pin-\(row.id)")
              }
              Image(systemName: "chevron.forward").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AglynColor.textTertiary).frame(width: 16, height: 16)
                .contentShape(Rectangle())
                .onTapGesture { context.selectSite(row.id) }
                .accessibilityHidden(true)
            }
            // On the content edges, the favicon on E and the chevron on width − E, a hairline between rows (Figma 13:3).
            .aglynContentRow(separator: row.id != rows.last?.id || model.hasMore)
            .contextMenu {
              if context.preferences != nil {
                Button(isPinned ? "Unpin" : "Pin to top", systemImage: isPinned ? "pin.slash" : "pin") { togglePin(row) }
              }
            }
          }
          if model.hasMore { AglynLoadMoreRow("Show more sites") { model.loadMore() } }
        }
        .refreshable { model.refresh() }
        .aglynContentList()
        // On a phone the card sits just under the chips (Figma iPhone / Workspace / Sites 512:32000), not under the
        // grouped list's own top gap (~35 points, which left ~44 between the chips and the card).
        .modifier(PhoneSitesListTop(wide: wide))
        .accessibilityIdentifier("sites-list")
      }
    }
  }
}

/// A site waiting on "Pinned is full. Replace one?".
struct PendingSitePin: Identifiable, Equatable {
  let id: String
  let name: String
}

/// The pin on a site row (the console's pin on a site card, `mdiPin` / `mdiPinOutline`): filled in the accent when the
/// site is pinned, an outline otherwise.
struct SitePinButton: View {
  let name: String
  let pinned: Bool
  /// Every pin the account keeps is in this workspace, so a pin asks which to replace.
  let full: Bool
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      Image(systemName: pinned ? "pin.fill" : "pin")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(pinned ? AglynColor.tint : AglynColor.secondaryText)
        .frame(width: 28, height: 28)
        .contentShape(Rectangle())
    }
    .buttonStyle(.borderless)
    .help(pinned ? "Unpin" : full ? "Pinned is full: pick one to replace" : "Pin to top")
    .accessibilityLabel(pinned ? "Unpin \(name)" : "Pin \(name)")
    .accessibilityAddTraits(pinned ? .isSelected : [])
  }
}

/// "Pinned is full. Replace one?" for a site (the console's `PinnedFullDialog`, kind site): asked only at the
/// account-wide bound. Each pin of the workspace has its Replace; Keep my pins changes nothing.
/// One pin the replace question offers.
struct SitePinChoice: Identifiable, Equatable {
  let id: String
  let name: String
}

struct SitePinnedFullSheet: View {
  let pending: PendingSitePin
  let pins: [SitePinChoice]
  let onReplace: (String) -> Void
  let onClose: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(
            "You can pin up to \(ContractValues.shared.pinnedHostsMax) sites. Pick the one \(pending.name) takes the place of."
          )
          .foregroundStyle(.secondary)
        }
        Section {
          ForEach(pins) { pin in
            HStack {
              Text(pin.name).frame(maxWidth: .infinity, alignment: .leading)
              Button("Replace") { onReplace(pin.id) }
                .buttonStyle(.aglynSecondary)
                .controlSize(.small)
                .accessibilityLabel("Replace \(pin.name)")
                .accessibilityIdentifier("replace-site-pin-\(pin.id)")
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Pinned is full. Replace one?")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Keep my pins", action: onClose) }
      }
    }
    .aglynSheetMinimumSize(width: 440, height: 420)
  }
}

/// The Created filter (the console's Filters panel on the Sites cards): a condition the declaration offers and a day.
struct SiteCreatedFilterSheet: View {
  let onApply: (SiteCreatedFilter) -> Void
  let onCancel: () -> Void
  @State private var op: String
  @State private var day: String

  init(current: SiteCreatedFilter?, onApply: @escaping (SiteCreatedFilter) -> Void, onCancel: @escaping () -> Void) {
    self.onApply = onApply
    self.onCancel = onCancel
    _op = State(initialValue: current?.op ?? SiteCreatedFilter.operators.first ?? "is")
    _day = State(initialValue: current?.day ?? "")
  }

  var body: some View {
    AglynActionSheet(
      ContractValues.shared.siteFilterHeaders["createdAt"] ?? "Created", confirmLabel: "Apply",
      confirmEnabled: day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil, busy: false, error: nil,
      onCancel: onCancel
    ) {
      onApply(SiteCreatedFilter(op: op, day: day))
    } fields: {
      Picker("Condition", selection: $op) {
        ForEach(SiteCreatedFilter.operators, id: \.self) { Text(listFilterOperatorLabel($0)).tag($0) }
      }
      .accessibilityIdentifier("sites-created-op")
      FieldEditor(spec: FieldSpec("createdDay", "Date", kind: .date), value: $day)
    }
    .presentationDetents([.medium])
  }
}

/// A phone's sites card just under the chips; the Mac and iPad lists keep their own top.
private struct PhoneSitesListTop: ViewModifier {
  let wide: Bool

  func body(content: Content) -> some View {
    if wide { content } else { content.contentMargins(.top, AglynSpace.half, for: .scrollContent) }
  }
}

/// Which of a sites row's columns show at a width. The Mac and iPad keep every column (Figma Mac Sites 13:3, iPad 13
/// Sites 13:1880); a phone, like a narrow Mac window (Shipped / Mac / Sites · narrow window 38:530), drops "Edited" so
/// the name, address and status keep the width (Figma iPhone / Workspace / Sites 512:32000; it clipped to "E" or "…").
enum SiteRowColumns {
  static func showsEdited(wideChrome: Bool) -> Bool { wideChrome }
}

/// One row of the sites list (Figma Mac Sites 13:3): the site's favicon, else its initial on its brand color; its name
/// and address; its status; when it was last edited (not on a phone); a chevron. The role is the site page's, not the
/// row's.
struct SiteListRow: View {
  let context: NativePluginContext
  let row: SiteRow
  @State private var host = LiveDocument()
  @Environment(\.aglynWideChrome) private var wide

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
      if SiteRowColumns.showsEdited(wideChrome: wide),
        let edited = (doc?.data["updatedAt"] as? Date) ?? (doc?.data["createdAt"] as? Date)
      {
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
            // In preview or maintenance the site is entered as the team (the console's `SiteVisitButton`, AGL-4086).
            let (team, api, open) = (SiteVisit.entersAsTeam(doc.data), context.api, openURL)
            Task { open(await SiteVisit.url(entersAsTeam: team, hostID: hostID, address: url, api: api)) }
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

/// Create a site, as the console's Create site: a name, an address the route checks, the addresses it suggests when the
/// one asked for is taken, an optional logo, dark logo and favicon held until the site exists (AGL-4119), and what the site
/// starts from (AGL-4049), which the person must pick: the style, or a starter where the marketplace's are offered to the
/// workspace. Nothing is chosen for them, so Create site stays off until one is.
struct CreateSiteSheet: View {
  let context: NativePluginContext
  let orgID: String
  /// Leaves the sheet for the console's own Create site, at this address.
  var openWeb: @MainActor (URL) -> Void = { _ in }
  @Environment(\.dismiss) private var dismiss
  @State private var runner = ActionRunner()
  @State private var name = ""
  @State private var subdomain = ""
  @State private var edited = false
  @State private var suggestions: [String] = []
  @State private var style: String?
  /// The files held until the site exists, and why a field refused the last one, each by its slot.
  @State private var brandFiles: [String: PickedFile] = [:]
  @State private var brandErrors: [String: String] = [:]
  /// The one picker every field shares (`AglynImageFileField`), and the field it is choosing for.
  @State private var pickSource: PickSource?
  @State private var pickSlot: String?
  /// A site made with a file that did not make it: the sheet stays to say so, once, then opens it.
  @State private var madeWithMissing: (hostID: String, notice: String)?

  /// What the create would refuse anyway, said first (the console's dialog): nil while unknown or when nothing stops it.
  @State private var blocked: CreateSiteBlock?

  /// Whether the marketplace's starters are offered to this workspace: nil until it is read.
  @State private var startersOffered: Bool?
  /// The picker's own answer: false hands back to the styles, as the console's dialog does for a workspace with nothing to
  /// offer. Nil until it answers.
  @State private var pickerShown: Bool?
  @State private var starterMode = SiteStarterMode.base
  @State private var starterSearch = ""
  /// The words the picker asks with, once the typing has settled.
  @State private var settledSearch = ""
  @State private var pick: SiteStarterSummary?
  /// "Start in preview" (AGL-4086): only the team sees the site until it is made public. Off for a starter site, as the
  /// console's default (`sitePreviewStartsOn`).
  @State private var startInPreview = sitePreviewStartsOn("starter")

  private var usingStarters: Bool { startersOffered == true && pickerShown != false }

  private var valid: Bool {
    usingStarters
      ? canCreateSite(name: name, subdomain: subdomain, pick: pick)
      : canCreateSite(name: name, subdomain: subdomain, style: style)
  }

  var body: some View {
    if let madeWithMissing {
      missedSheet(madeWithMissing.hostID, notice: madeWithMissing.notice)
    } else if let blocked {
      blockedSheet(blocked)
    } else {
      form
        .task(id: orgID) { blocked = await createSiteBlock(context, orgID: orgID) }
        .task(id: orgID) { startersOffered = await siteStartersOffered(context, orgID: orgID) }
    }
  }

  /// The site is made, and a file it was given did not make it: which, and where to add it. Open site is the way on.
  private func missedSheet(_ hostID: String, notice: String) -> some View {
    NavigationStack {
      Form {
        Section { AglynNotice(notice, tone: .warning) }
      }
      .formStyle(.aglynGrouped)
      .navigationTitle("Create a site")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Open site") {
            context.selectSite(hostID)
            dismiss()
          }
          .keyboardShortcut(.defaultAction)
          .accessibilityIdentifier("create-site-open")
        }
      }
    }
    .interactiveDismissDisabled()
    .aglynSheetMinimumSize(width: 420, height: 220)
    .accessibilityIdentifier("create-site-missed")
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
      onConfirm: create, foot: usingStarters ? siteStarterPickNote(pick).map { AnyView(pickNote($0)) } : nil
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
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        Toggle("Start in preview", isOn: $startInPreview).disabled(runner.busy).accessibilityIdentifier("site-start-in-preview")
        Text(startInPreviewCaption(startInPreview)).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
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
    } below: {
      brandSection
      if usingStarters {
        starterSection
      } else if startersOffered == false || pickerShown == false {
        styleSection
      }
    }
    .aglynMediaPicker($pickSource, multiple: false) { files in
      if let file = files.first, let slot = pickSlot { hold(file, slot: slot) }
    }
    .aglynSheetMinimumSize(width: 640, height: 700)
  }

  /// What the pick needs next, held at the foot of the sheet so it is beside whichever row was tapped, however long the list.
  private func pickNote(_ note: SiteStarterPickNote) -> some View {
    AglynNotice(
      note.message, tone: note.webAction == nil ? .success : .info, actionTitle: note.webAction, action: note.webAction.map { _ in leaveForTheWeb })
      .padding(AglynSpace.two)
      .background(AglynColor.paper)
      .overlay(alignment: .top) { Divider() }
      .accessibilityIdentifier("starter-note")
  }

  /// The console's own Create site, on this pick: where it is bought, or where an AI starter's questions are asked.
  private func leaveForTheWeb() {
    guard let pick, let url = siteCreateWebURL(origin: context.api.origin, orgSlug: context.orgSlug, listingID: pick.listingID)
    else { return }
    dismiss()
    openWeb(url)
  }

  /// A file a field takes is held; one it does not is said on the field, before anything is created.
  private func hold(_ file: PickedFile, slot: String) {
    let refusal = siteBrandFileRefusal(file, slot: slot)
    brandErrors[slot] = refusal
    if refusal == nil { brandFiles[slot] = file }
  }

  /// The console's fields (`useSiteBrandFiles`): all three optional, none ever in the way of Create site.
  private var brandSection: some View {
    Section {
      ForEach(SiteBrandFiles.slots, id: \.slot) { spec in
        AglynImageFileField(
          label: spec.label, file: brandFiles[spec.slot],
          ground: spec.slot == "logo" ? .light : spec.slot == "logoDark" ? .dark : nil,
          helper: spec.slot == "favicon" ? "Leave this blank to use your logo." : nil, error: brandErrors[spec.slot],
          enabled: !runner.busy
        ) { source in
          pickSlot = spec.slot
          pickSource = source
        } onRemove: {
          brandFiles[spec.slot] = nil
          brandErrors[spec.slot] = nil
        }
        .accessibilityIdentifier("site-brand-\(spec.slot)")
      }
    } header: {
      Text("Logo and favicon (optional)").font(AglynFont.headline).foregroundStyle(AglynColor.textPrimary)
        .textCase(nil).accessibilityAddTraits(.isHeader)
    } footer: {
      Text(SiteBrandFiles.hint)
    }
  }

  /// The console's own choice (`SiteStylePicker`): its heading and words, and every style in its order, each with its
  /// picture from the console. The starter site has no "Pick for me": that card is the AI start's.
  private var styleSection: some View {
    Section {
      AglynOptionCardGrid(
        label: "Style of site",
        options: SiteStyles.all.map { style in
          AglynOptionCardItem(
            id: style.id, title: style.name, description: style.blurb,
            imageURL: mediaPreviewURL(style.preview, origin: context.api.origin, hostID: nil, width: 480),
            imageAlt: style.alt)
        }, selection: $style
      )
      .accessibilityIdentifier("site-style-cards")
      .listRowInsets(EdgeInsets())
      .listRowBackground(Color.clear)
    } header: {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        Text("Choose a style").font(AglynFont.headline).foregroundStyle(AglynColor.textPrimary)
          .accessibilityAddTraits(.isHeader)
        Text("Your site starts with a home page, a header and a footer in the style you choose. You can change everything later.")
          .font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
        if style == nil {
          Text("Choose a style to create your site.").font(AglynFont.subheadline)
            .foregroundStyle(AglynColor.secondaryText).accessibilityIdentifier("site-style-required")
        }
      }
      .textCase(nil)
      .padding(.bottom, AglynSpace.half)
    }
  }

  /// The console's "Choose your starter": its words, the marketplace's starters through the zone a plugin fills, and
  /// whichever starters and AI starters it offers. Nothing is picked until a row is.
  private var starterSection: some View {
    Section {
      Picker("Kind of starter", selection: Binding(get: { starterMode }, set: changeStarterMode)) {
        Text("Starters").tag(SiteStarterMode.base)
        Text("AI starters").tag(SiteStarterMode.ai)
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .accessibilityIdentifier("starter-mode")
      .listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets())
      HStack(spacing: AglynSpace.one) {
        Image(systemName: "magnifyingglass").foregroundStyle(AglynColor.secondaryText).accessibilityHidden(true)
        TextField("Search starters", text: $starterSearch)
          .autocorrectionDisabled()
          .accessibilityIdentifier("starter-search")
      }
      SlotWidgets(context: context, slot: StarterPickerZone.slot)
        .environment(\.starterPickerZone, starterZone)
        .listRowInsets(EdgeInsets())
        .task(id: starterSearch) {
          try? await Task.sleep(nanoseconds: 300_000_000)
          if !Task.isCancelled { settledSearch = starterSearch }
        }
    } header: {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        Text(SiteStarterSearch.title).font(AglynFont.headline).foregroundStyle(AglynColor.textPrimary)
          .accessibilityAddTraits(.isHeader)
        Text(SiteStarterSearch.lede).font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
        if let needed = starterStillNeeded {
          Text(needed).font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
            .accessibilityIdentifier("site-starter-required")
        }
      }
      .textCase(nil)
      .padding(.bottom, AglynSpace.half)
    }
  }

  /// Why Create site is off, in the console's words (`CreateHostDialog`), until a pick it can create from.
  private var starterStillNeeded: String? {
    switch (siteStarterPickBlock(pick), starterMode) {
    case (.some(.none), .base): "Choose a starter to create your site."
    case (.some(.none), .ai): "Choose an AI starter to continue."
    case (.some(.purchase), .base): "Buy this starter to create your site from it."
    case (.some(.purchase), .ai): "Buy this starter to continue with it."
    case (nil, .ai): "Continue on the web to answer this starter's questions."
    case (nil, .base): nil
    }
  }

  private var starterZone: StarterPickerZone {
    StarterPickerZone(
      orgID: orgID, mode: starterMode, search: settledSearch, selected: pick,
      onPick: { picked in
        pick = picked
        runner.error = nil
      },
      ready: { pickerShown = $0 })
  }

  /// Another kind of starter is another list: what was picked in this one is not carried across, so nothing is chosen
  /// that is not on screen.
  private func changeStarterMode(_ next: SiteStarterMode) {
    starterMode = next
    pick = nil
    runner.error = nil
  }

  private func create() {
    let start: SiteStart
    if usingStarters {
      guard let pick else { return }
      start = .starter(listingID: pick.listingID)
    } else {
      guard let style else { return }
      start = .style(style)
    }
    let (name, subdomain, files, preview) = (name, subdomain, brandFiles, startInPreview)
    runner.run {
      switch try await createSite(context.api, orgID: orgID, name: name, subdomain: subdomain, start: start, preview: preview) {
      case .created(let hostID, _):
        // The logo, dark logo and favicon go in now the site has a library. A file that does not make it never costs
        // the site: it is said once, here, before the site opens.
        let outcome = await saveSiteBrand(context.api, hostID: hostID, files: files)
        if let notice = siteBrandMissedNotice(outcome.missed) {
          madeWithMissing = (hostID, notice)
        } else {
          context.selectSite(hostID)
          dismiss()
        }
      case .refused(let message, let offered):
        suggestions = offered
        runner.error = message
      case .pickRefused(let refused):
        // A price still asked keeps the pick, which offers to buy it; anything else clears it, with the reason.
        pick = refused.keep ? pick?.owned(false) : nil
        runner.error = refused.message
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
      permissionRefusalText(ContractValues.shared.orgRoleGrants, key: "hosts.create")
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
  if context.orgRole != nil && !context.can("hosts.create") { return .role }
  guard let entitlements = try? await context.api.request("/api/orgs/entitlements", query: [("orgId", orgID)]),
    let limit = entitlements["quotas"]?["hostLimit"]?.numberValue
  else { return nil }
  // Its `hosts` directory is what the console's dialog counts. A workspace with no directory yet counts none, as the
  // dialog's does.
  guard let org = await workspaceDocumentOnce(context, orgID: orgID) else { return nil }
  return siteLimitBlock(limit: Int(limit), directory: org["hosts"] as? [String: Any] ?? [:])
}

/// The workspace's document, read once; nil only when the read failed.
@MainActor
private func workspaceDocumentOnce(_ context: NativePluginContext, orgID: String) async -> [String: Any]? {
  await withCheckedContinuation { continuation in
    var listener: FirestoreListening?
    var answered = false
    listener = context.firestore.listenDocument(["orgs", orgID]) { result in
      guard !answered else { return }
      answered = true
      listener?.remove()
      guard let document = try? result.get() else { return continuation.resume(returning: nil) }
      continuation.resume(returning: document.data)
    }
  }
}

/// Whether Create site offers the marketplace's starters: a plugin fills the zone, and `release_site_starters` is on for
/// the workspace or the person is staff. The picker's first answer then decides, as the route is the judge.
@MainActor
func siteStartersOffered(_ context: NativePluginContext, orgID: String) async -> Bool {
  guard !context.slotWidgets(StarterPickerZone.slot).isEmpty else { return false }
  let staff = context.staff != nil
  let org = staff ? nil : await workspaceDocumentOnce(context, orgID: orgID)
  return releaseFlagOn("release_site_starters", org: org, orgID: orgID, staff: staff)
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
