// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

private func canInstall(_ context: NativePluginContext) -> Bool {
  installRoles.contains(context.orgRole ?? "") && siteInstallRoles.contains(context.siteRole ?? "")
}

/// The marketplace's sections, as the console's hub tabs them.
private struct SectionTabs: View {
  let context: NativePluginContext
  let current: String

  var body: some View {
    Picker("Section", selection: Binding(get: { current }, set: { if $0 != current { context.navigate($0) } })) {
      Text("Browse all").tag(marketplaceBrowseScreen)
      Text("Installed").tag(marketplaceInstalledScreen)
      Text("Licenses").tag(marketplaceLicencesScreen)
      Text("Publish").tag(marketplacePublishScreen)
      Text("Selling").tag(marketplaceSellScreen)
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .accessibilityIdentifier("marketplace-sections")
  }
}

// MARK: Browse

/// Browse: the listings the workspace may see, by category, search and order, the picked one beside the list on wide
/// windows with its details, versions, reviews and install.
struct BrowseScreen: View {
  let context: NativePluginContext
  var initialListingID: String?

  @State private var list = LiveQueryList(pageSize: browsePageSize) { ListingRow($0) }
  /// The marketplace home's two shelves (AGL-3945): the newest and the most installed.
  @State private var newest = LiveQueryList(pageSize: 8) { ListingRow($0) }
  @State private var popular = LiveQueryList(pageSize: 8) { ListingRow($0) }
  @State private var search = ""
  @State private var category: String?
  @State private var sort = BrowseSort.newest
  @State private var selection: String?
  @State private var pushed: String?
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        // The sections span the window over both columns, so the browse list keeps its column to itself.
        VStack(spacing: 0) {
          SectionTabs(context: context, current: marketplaceBrowseScreen)
            .frame(maxWidth: 640, alignment: .leading)
            .aglynContentEdges().padding(.vertical, AglynSpace.one)
            .frame(maxWidth: .infinity, alignment: .leading)
          Divider()
          AglynListDetailColumns(listWidth: 400, showsDetail: !(list.ready && list.rows.isEmpty)) {
            shelf(selectable: true)
          } detail: {
            if let selection {
              ListingDetail(context: context, listingID: selection).id(selection)
            } else {
              AglynSelectionPlaceholder("No listing selected", systemImage: "storefront")
            }
          }
        }
        .aglynListColumn()
      } else {
        shelf(selectable: false)
      }
    }
    .navigationTitle("Marketplace")
    .aglynScreenTitle("Marketplace")
    .aglynPushDestination(item: $pushed) { id in ListingDetail(context: context, listingID: id).navigationTitle("Listing") }
    .aglynSearchable(text: $search, prompt: "Search the marketplace")
    .task(id: "\(search)|\(category ?? "")|\(sort.rawValue)|\(context.orgID ?? "")") {
      // The search waits for a pause in the typing, as the console's does.
      if !search.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
      if Task.isCancelled { return }
      let orgID = context.orgID
      let (category, search, sort) = (category, search, sort)
      list.show(context.firestore) { limit in browseQuery(viewerOrgID: orgID, category: category, search: search, sort: sort, limit: limit) }
    }
    .task {
      if let initialListingID {
        selection = initialListingID
        if !isWide { pushed = initialListingID }
      }
    }
    .task(id: context.orgID) {
      let orgID = context.orgID
      newest.show(context.firestore) { browseQuery(viewerOrgID: orgID, category: nil, search: "", sort: .newest, limit: $0) }
      popular.show(context.firestore) { browseQuery(viewerOrgID: orgID, category: nil, search: "", sort: .installed, limit: $0) }
    }
    .onDisappear {
      list.stop()
      newest.stop()
      popular.stop()
    }
  }

  @ViewBuilder
  private func shelf(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      if !selectable {
        SectionTabs(context: context, current: marketplaceBrowseScreen)
          .aglynContentEdges().padding(.vertical, AglynSpace.one)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          AglynChoiceChip("All", selected: category == nil) { category = nil }
          ForEach(ContractValues.shared.listingCategories, id: \.self) { name in
            AglynChoiceChip(name.prefix(1).uppercased() + name.dropFirst(), selected: category == name) { category = name }
          }
          Menu {
            Picker("Order", selection: $sort) {
              ForEach(BrowseSort.allCases) { Text($0.label).tag($0) }
            }
          } label: {
            Label(sort.label, systemImage: "arrow.up.arrow.down")
          }
          .fixedSize()
          .help("Order the listings")
          .accessibilityIdentifier("marketplace-sort")
        }
        .aglynContentEdges()
        .padding(.vertical, AglynSpace.one)
      }
      // The home: New and Popular as preview cards, while nothing is searched or picked.
      if search.isEmpty && category == nil && (!newest.rows.isEmpty || !popular.rows.isEmpty) {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          shelfRow("New", newest.rows)
          shelfRow("Popular", popular.rows)
          Text("All listings").font(AglynFont.headline).aglynContentEdges().padding(.top, AglynSpace.one)
        }
        .accessibilityIdentifier("marketplace-home")
      }
      content(selectable: selectable)
    }
    .aglynListColumn()
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func shelfRow(_ title: String, _ rows: [ListingRow]) -> some View {
    if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        Text(title).font(AglynFont.headline).aglynContentEdges()
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: AglynSpace.oneAndHalf) {
            ForEach(rows) { row in
              ListingCard(row: row) {
                if isWide { selection = row.id } else { pushed = row.id }
              }
            }
          }
          .aglynContentEdges()
        }
      }
    }
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !list.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure = list.failure {
      AglynEmptyState("Could not load the marketplace", systemImage: "exclamationmark.triangle", message: failure)
    } else if list.rows.isEmpty {
      AglynEmptyState("Nothing matches", systemImage: "storefront", message: "Try another search or category.")
    } else if selectable {
      List { rows(selectable: true) }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynSelectableListStyle().aglynSelectionKeys(list.rows.map(\.id), selection: $selection)
        .accessibilityIdentifier("listings")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("listings")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(list.rows) { row in
      Group {
        if selectable {
          ListingListRow(row: row).aglynSelectableRow(row.id, selection: $selection)
        } else {
          Button { pushed = row.id } label: {
            HStack {
              ListingListRow(row: row)
              Image(systemName: "chevron.right").font(AglynFont.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
          }
          .buttonStyle(.aglynRow)
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("listing-\(row.id)")
    }
    if list.hasMore { AglynLoadMoreRow("Show more listings") { list.loadMore() } }
  }
}

/// A listing as a preview card on the marketplace home: its picture, name, type, rating and price, and Get or Buy,
/// which opens the listing where it installs.
private struct ListingCard: View {
  let row: ListingRow
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      VStack(alignment: .leading, spacing: 6) {
        AglynRemoteImage(row.imageURL.flatMap(URL.init(string:)), systemImage: row.artifactType == "plugin" ? "puzzlepiece.extension" : "square.grid.2x2")
          .frame(width: 180, height: 104)
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
        Text(row.name).font(AglynFont.strongSubheadline).lineLimit(1)
        Text([artifactLabel(row.artifactType), ratingLabel(row)].joined(separator: " · ")).font(AglynFont.caption)
          .foregroundStyle(.secondary).lineLimit(1)
        HStack {
          StatusChip(priceLabel(row.priceUSD), tone: row.paid ? .info : .success)
          Spacer()
          Text(row.paid ? "Buy" : "Get").font(AglynFont.button).foregroundStyle(AglynColor.tint)
        }
      }
      .frame(width: 180, alignment: .leading)
      .padding(10)
      .aglynCardSurface()
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("listing-card-\(row.id)")
  }
}

private struct ListingListRow: View {
  let row: ListingRow

  var body: some View {
    AglynRow(
      row.name,
      subtitle: [artifactLabel(row.artifactType), row.category, ratingLabel(row), "\(row.installCount) installs"].compactMap { $0 }.joined(separator: " · "),
      systemImage: row.artifactType == "plugin" ? "puzzlepiece.extension" : "square.grid.2x2"
    ) {
      StatusChip(priceLabel(row.priceUSD), tone: row.paid ? .info : .success)
    }
  }
}

// MARK: A listing

/// One listing on its own, as a link to `/{org}/marketplace/{listingId}` opens it.
struct ListingScreen: View {
  let context: NativePluginContext
  let listingID: String

  var body: some View { ListingDetail(context: context, listingID: listingID) }
}

private enum ListingSheet: Identifiable {
  case install(InstallTarget?)
  case uninstall(InstallTarget)
  case review
  case report
  /// Reporting someone else's review: its reviewer's uid and name.
  case reportReview(uid: String, name: String)

  var id: String {
    switch self {
    case .install(let scope): "install-\(scope?.rawValue ?? "")"
    case .uninstall(let scope): "uninstall-\(scope.rawValue)"
    case .review: "review"
    case .report: "report"
    case .reportReview(let uid, _): "report-review-\(uid)"
    }
  }
}

private struct ListingDetail: View {
  let context: NativePluginContext
  let listingID: String
  @State private var listing = ObservedDocument()
  @State private var hostPin = ObservedDocument()
  @State private var orgPin = ObservedDocument()
  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var sheet: ListingSheet?
  @State private var editing: SellerListing?
  @State private var editRunner = ActionRunner(roleHint: "an owner, admin or editor")

  /// Listings are the workspace's (`profileId` is the org id), so the owner is a workspace comparison, as the console's is.
  private var owned: SellerListing? {
    guard let doc = listing.document, let orgID = context.orgID, doc.string("profileId") == orgID else { return nil }
    return SellerListing(doc)
  }

  var body: some View {
    Group {
      if !listing.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if listing.failed {
        AglynEmptyState("Could not load this listing", systemImage: "exclamationmark.triangle", message: "Check the connection and try again.")
      } else if let doc = listing.document.map(ListingRow.init), !doc.deleted, !doc.workspaceLocked {
        ListingBody(context: context, listing: doc, hostPin: hostPin.document, orgPin: orgPin.document, runner: runner) { sheet = $0 }
      } else {
        AglynEmptyState("This listing does not exist", systemImage: "storefront", message: "It may have been removed.")
      }
    }
    .sheet(item: $sheet) { sheet in
      if let doc = listing.document.map(ListingRow.init) {
        ListingSheets(context: context, listing: doc, sheet: sheet, state: installState(doc), runner: runner) { self.sheet = nil }
      }
    }
    .sheet(item: $editing) { listing in
      if let orgID = context.orgID {
        EditListingSheet(context: context, listing: listing, runner: editRunner, api: SellerAPI(api: context.api, orgID: orgID)) { editing = nil }
      }
    }
    .aglynScreenToolbar(id: "listing") {
      // The owner's actions on the listing itself: a plugin ships a new version from here, and any listing is edited here.
      if let owned, installRoles.contains(context.orgRole ?? "") {
        if owned.isPlugin {
          Button {
            context.navigate("marketplace.publishPlugin", ["listing": owned.id])
          } label: {
            Label("Publish new version", systemImage: "square.and.arrow.up")
          }
          .accessibilityIdentifier("listing-publish-version")
        }
        Button {
          editRunner.clear()
          editing = owned
        } label: {
          Label("Edit listing", systemImage: "pencil")
        }
        .accessibilityIdentifier("listing-edit")
      }
    }
    .task(id: "\(listingID)-\(context.hostID ?? "")-\(context.orgID ?? "")") {
      listing.start(context.firestore, [listingsCollection, listingID])
      if let hostID = context.hostID { hostPin.start(context.firestore, ["hosts", hostID, "installs", listingID]) }
      if let orgID = context.orgID { orgPin.start(context.firestore, ["orgs", orgID, "installs", listingID]) }
    }
    .onDisappear {
      listing.stop()
      hostPin.stop()
      orgPin.stop()
    }
  }

  private func installState(_ listing: ListingRow) -> PluginInstallState {
    func version(_ doc: FirestoreDocument?) -> String? {
      guard let value = doc?.data["version"] else { return nil }
      if let text = value as? String { return text }
      return (value as? NSNumber).map { jsNumberString($0.doubleValue) }
    }
    return resolvePluginInstallState(
      latestVersion: listing.offeredVersion, hostPinVersion: version(hostPin.document), hostPinned: hostPin.document != nil,
      orgPinVersion: version(orgPin.document), orgPinned: orgPin.document != nil)
  }
}

private struct ListingBody: View {
  let context: NativePluginContext
  let listing: ListingRow
  let hostPin: FirestoreDocument?
  let orgPin: FirestoreDocument?
  let runner: PluginActionRunner
  let open: (ListingSheet) -> Void
  @State private var versions: [ListingVersion]?
  @State private var reviews = LiveQuery()
  @State private var publisher = ObservedDocument()

  private var state: PluginInstallState {
    func version(_ doc: FirestoreDocument?) -> String? {
      guard let value = doc?.data["version"] else { return nil }
      if let text = value as? String { return text }
      return (value as? NSNumber).map { jsNumberString($0.doubleValue) }
    }
    return resolvePluginInstallState(
      latestVersion: listing.offeredVersion, hostPinVersion: version(hostPin), hostPinned: hostPin != nil, orgPinVersion: version(orgPin), orgPinned: orgPin != nil)
  }

  private var api: MarketplaceAPI { MarketplaceAPI(api: context.api) }
  private var plugin: Bool { listing.artifactType == "plugin" }
  private var mine: Bool { listing.profileID != nil && listing.profileID == context.orgID }
  private var installable: Bool { canInstall(context) && context.hostID != nil }
  private var handle: String? { publisher.document.flatMap { $0.string("handle") ?? $0.string("displayName") } }

  var body: some View {
    let state = state
    let targets = installTargets(listing.artifactType)
    let offered = listing.offeredVersion
    List {
      if let error = runner.error { Section { AglynNotice(error, tone: .error) } }
      if let notice = runner.notice { Section { AglynNotice(notice, tone: .success) { runner.clear() } } }
      Section {
        HStack(spacing: AglynSpace.two) {
          AglynRemoteImage(
            mediaPreviewURL(listing.imageURL, origin: context.api.origin, hostID: nil, width: 160),
            systemImage: plugin ? "puzzlepiece.extension" : "square.grid.2x2")
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 2) {
            Text(listing.name).font(AglynFont.title).accessibilityAddTraits(.isHeader)
            Text([artifactLabel(listing.artifactType), handle.map { "@\($0)" }, offered.map { "v\($0)" }].compactMap { $0 }.joined(separator: " · "))
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Menu {
            Button { open(.review) } label: { Label("Rate and review", systemImage: "star") }.disabled(mine)
            Button { open(.report) } label: { Label("Report this listing", systemImage: "exclamationmark.triangle") }
          } label: {
            Image(systemName: "ellipsis.circle").accessibilityLabel("More")
          }
        }
        FlowChips(chips: chips(state))
        if !mine, listing.paid, state.installedVersion == nil {
          AglynNotice("A paid listing is bought once for the workspace; buying is not in the app yet.", tone: .info)
        }
        actions(state, targets, offered)
        if plugin, offered == nil { AglynNotice("No reviewed version yet: it can be installed once one passes review.", tone: .warning) }
        if !installable { AglynNotice("Installing needs the editor role in the workspace and on the picked site.", tone: .neutral) }
      }
      Section {
        HStack(spacing: AglynSpace.one) {
          AglynFigureTile(
            "Rating", value: listing.ratingCount > 0 && listing.ratingAverage != nil ? jsNumberString(listing.ratingAverage!) + " ★" : "—",
            caption: listing.ratingCount > 0 ? "\(listing.ratingCount) ratings" : "Not yet rated")
          AglynFigureTile("Installs", value: "\(listing.activeInstalls ?? listing.installCount)", caption: "\(listing.installCount) all time")
        }
      }
      if !listing.description.isEmpty { Section("About") { Text(listing.description) } }
      if let readme = listing.readme { Section("Read me") { Text(String(readme.prefix(4000))).font(AglynFont.body) } }
      Section("Versions") {
        if let versions {
          if versions.isEmpty { Text("No published versions yet.").foregroundStyle(.secondary) }
          ForEach(versions) { version in
            AglynRow(
              "v\(version.version)",
              subtitle: [
                version.publishedAtMs.map { "Published " + relativeTime(Date(timeIntervalSince1970: $0 / 1000)) }, version.activeInstalls.map { "\($0) active" },
                version.changelog,
              ].compactMap { $0 }.joined(separator: " · "), systemImage: "clock.arrow.circlepath")
          }
        } else {
          SkeletonRows(count: 2)
        }
      }
      Section {
        reviewRows
      } header: {
        HStack {
          Text("Reviews")
          Spacer()
          if !mine { Button("Write a review") { open(.review) }.textCase(nil) }
        }
      }
      Section("Details") {
        AglynDetailRow("License", value: listing.license)
        AglynDetailRow("Homepage", value: listing.homepageURL)
        AglynDetailRow("Source", value: listing.repositoryURL)
        AglynDetailRow("Listing id", value: listing.id)
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("listing-detail")
    .task(id: listing.id) {
      versions = await api.versions(listingID: listing.id)
      await reviews.bind(
        context.firestore, FirestoreQuery([listingsCollection, listing.id, "reviews"], order: [.init("__name__")], limit: 100))
    }
    .task(id: listing.profileID) {
      if let profileID = listing.profileID { publisher.start(context.firestore, ["publisherProfiles", profileID]) }
    }
  }

  private func chips(_ state: PluginInstallState) -> [(String, AglynTone)] {
    var chips: [(String, AglynTone)] = [(priceLabel(listing.priceUSD), listing.paid ? .info : .success)]
    if listing.verified { chips.append(("Verified publisher", .success)) }
    if listing.reviewed { chips.append(("Reviewed", .success)) }
    if listing.visibility == "private" { chips.append(("Private", .neutral)) }
    for name in listing.categories.isEmpty ? [listing.category].compactMap({ $0 }) : listing.categories { chips.append((name, .neutral)) }
    if let installed = state.installedVersion {
      chips.append(("Installed (v\(installed))" + (state.scope == .org ? " · Org-wide" : ""), .success))
      if state.shadowed { chips.append(("Org-wide (shadowed)", .warning)) }
    }
    return chips
  }

  @ViewBuilder
  private func actions(_ state: PluginInstallState, _ targets: [InstallTarget], _ offered: String?) -> some View {
    if plugin, state.installedVersion != nil {
      if state.updateAvailable, let offered {
        Button("Update to v\(offered)") { open(.install(state.scope)) }
          .buttonStyle(.aglynProminent).disabled(!installable || runner.busy).accessibilityIdentifier("listing-update")
      }
      Button(state.scope == .org ? "Remove from the workspace" : "Remove from this site", role: .destructive) { open(.uninstall(state.scope ?? .host)) }
        .disabled(!installable || runner.busy).accessibilityIdentifier("listing-uninstall")
    } else {
      Button {
        open(.install(targets.contains(.host) ? .host : targets.first))
      } label: {
        Label(targets.contains(.host) ? "Install on this site" : "Install", systemImage: "arrow.down.circle")
      }
      .buttonStyle(.aglynProminent)
      .disabled(!installable || runner.busy || (plugin && offered == nil))
      .accessibilityIdentifier("listing-install")
      if targets.contains(.org), targets.contains(.host) {
        Button("Install for every site") { open(.install(.org)) }.disabled(!installable || runner.busy || offered == nil)
      }
    }
  }

  @ViewBuilder
  private var reviewRows: some View {
    switch reviews.state {
    case .loading: SkeletonRows(count: 2)
    case .failed: Text("Reviews could not be loaded.").foregroundStyle(.secondary)
    case .ready(let docs):
      let rows = docs.compactMap(ReviewRow.init).sorted { ($0.updatedAtMs ?? 0) > ($1.updatedAtMs ?? 0) }
      if rows.isEmpty { Text("No reviews yet.").foregroundStyle(.secondary) }
      ForEach(rows) { review in
        AglynRow(
          review.name + (review.rating.map { " · " + String(repeating: "★", count: min(max($0, 0), 5)) } ?? ""),
          subtitle: [review.comment, review.verifiedInstaller ? "Verified installer" : nil, review.updatedAtMs.map { relativeTime(Date(timeIntervalSince1970: $0 / 1000)) }]
            .compactMap { $0 }.joined(separator: " · "),
          systemImage: "person"
        ) {
          if review.uid == context.uid {
            Button("Delete") { runner.run(success: "Your review was removed.") { try await api.deleteReview(listingID: listing.id) } }.buttonStyle(.borderless)
          } else {
            // Not on your own review: the queue is for what someone else wrote.
            Button("Report") { open(.reportReview(uid: review.uid, name: review.name)) }
              .buttonStyle(.borderless)
              .accessibilityIdentifier("review-report-\(review.uid)")
          }
        }
      }
    }
  }
}

/// A wrapping row of status chips.
private struct FlowChips: View {
  let chips: [(String, AglynTone)]

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack { ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in StatusChip(chip.0, tone: chip.1) } }
    }
  }
}

private struct ListingSheets: View {
  let context: NativePluginContext
  let listing: ListingRow
  let sheet: ListingSheet
  let state: PluginInstallState
  let runner: PluginActionRunner
  let close: () -> Void
  @State private var rating = 0
  @State private var comment = ""
  @State private var reason = ""

  private var api: MarketplaceAPI { MarketplaceAPI(api: context.api) }

  var body: some View {
    switch sheet {
    case .install(let scope):
      AglynActionSheet(
        state.updateAvailable ? "Update \(listing.name)?" : (scope == .org ? "Install \(listing.name) for every site?" : "Install \(listing.name)?"),
        message: installBody(scope), confirmLabel: state.updateAvailable ? "Update" : "Install", busy: runner.busy, error: runner.error,
        onCancel: { runner.error = nil; close() },
        onConfirm: {
          guard let hostID = context.hostID else { return }
          runner.run(onDone: close) {
            let outcome = try await api.install(listing, hostID: hostID, scope: scope)
            runner.notice = outcome.message + (outcome.warning.map { " \($0)" } ?? "")
          }
        }
      ) { EmptyView() }
    case .uninstall(let scope):
      AglynActionSheet(
        "Remove \(listing.name)?",
        message: scope == .org ? "It stops running on every site that uses the workspace's install." : "It stops running on this site.",
        confirmLabel: "Remove", destructive: true, busy: runner.busy, error: runner.error,
        onCancel: { runner.error = nil; close() },
        onConfirm: {
          guard let hostID = context.hostID else { return }
          runner.run(success: "Removed \"\(listing.name)\".", onDone: close) { try await api.uninstall(listingID: listing.id, hostID: hostID, scope: scope) }
        }
      ) { EmptyView() }
    case .review:
      AglynActionSheet(
        "Review \(listing.name)", message: "A rating needs an installed copy; a comment alone does not.", confirmLabel: "Post",
        confirmEnabled: rating > 0 || !comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, busy: runner.busy, error: runner.error,
        onCancel: { runner.error = nil; close() },
        onConfirm: {
          runner.run(success: "Thanks — your review is posted.", onDone: close) {
            try await api.review(listingID: listing.id, rating: rating > 0 ? rating : nil, comment: comment)
          }
        }
      ) {
        Picker("Rating", selection: $rating) {
          Text("No rating").tag(0)
          ForEach(1...5, id: \.self) { Text(String(repeating: "★", count: $0)).tag($0) }
        }
        TextField("Comment", text: Binding(get: { comment }, set: { comment = String($0.prefix(2000)) }), axis: .vertical).lineLimit(3...8)
          .accessibilityIdentifier("review-comment")
      }
    case .report:
      reportSheet(label: listing.name, noun: "listing", reviewUID: nil)
    case .reportReview(let uid, let name):
      reportSheet(label: "this review by \(name)", noun: "review", reviewUID: uid)
    }
  }

  /// The console's report dialog, for a listing or a review.
  private func reportSheet(label: String, noun: String, reviewUID: String?) -> some View {
    AglynActionSheet(
      "Report \(label)",
      message: "Tell us what is wrong with this \(noun). A staff member reads every report. Reporting again updates your report rather than adding another one.",
      confirmLabel: "Send report", confirmEnabled: !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, busy: runner.busy,
      error: runner.error,
      onCancel: { runner.error = nil; close() },
      onConfirm: {
        runner.run(success: "Thanks — staff will review this report", onDone: close) {
          try await api.report(listingID: listing.id, reason: reason, reviewUID: reviewUID)
        }
      }
    ) {
      TextField("Reason", text: Binding(get: { reason }, set: { reason = String($0.prefix(maxReportReasonLength)) }), axis: .vertical).lineLimit(3...8)
        .accessibilityIdentifier("report-reason")
    }
  }

  private func installBody(_ scope: InstallTarget?) -> String? {
    if listing.artifactType == "theme" { return "It replaces this site's theme. Setup → Theme has a way back." }
    if scope == .org { return "Every site in the workspace gets it, except a site with its own install of it." }
    if listing.artifactType == "plugin" { return "It runs on this site's pages once installed." }
    return marketplaceLandingMessage(listing.artifactType, listing.name).map { "Once installed: \($0)" }
  }
}

// MARK: Installed

/// The plugins installed on the picked site and for the whole workspace, with update and remove.
struct InstalledScreen: View {
  let context: NativePluginContext
  @State private var sitePins = LiveQuery()
  @State private var orgPins = LiveQuery()
  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var removing: InstallPinRow?

  var body: some View {
    Group {
      if let hostID = context.hostID {
        content(hostID)
      } else {
        AglynEmptyState("Pick a site to see its plugins", systemImage: "puzzlepiece.extension")
      }
    }
    .navigationTitle("Installed")
    .aglynScreenTitle("Installed")
    .sheet(item: $removing) { pin in
      AglynActionSheet(
        "Remove \(pin.name)?",
        message: pin.scope == .org ? "It stops running on every site that uses the workspace's install." : "It stops running on this site.",
        confirmLabel: "Remove", destructive: true, busy: runner.busy, error: runner.error,
        onCancel: { runner.error = nil; removing = nil },
        onConfirm: {
          guard let hostID = context.hostID else { return }
          runner.run(success: "Removed \"\(pin.name)\".", onDone: { removing = nil }) {
            try await MarketplaceAPI(api: context.api).uninstall(listingID: pin.listingID, hostID: hostID, scope: pin.scope)
          }
        }
      ) { EmptyView() }
    }
  }

  @ViewBuilder
  private func content(_ hostID: String) -> some View {
    let site = sitePins.state.value.map { $0.map { InstallPinRow($0, scope: .host) } }
    let org = orgPins.state.value.map { $0.map { InstallPinRow($0, scope: .org) } }
    VStack(spacing: 0) {
      SectionTabs(context: context, current: marketplaceInstalledScreen).aglynContentEdges().padding(.vertical, AglynSpace.one)
      if removing == nil {
        if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.clear() }.aglynContentEdges() }
        if let error = runner.error { AglynNotice(error, tone: .error) { runner.clear() }.aglynContentEdges() }
      }
      if let site, let org {
        if site.isEmpty && org.isEmpty {
          AglynEmptyState("No plugins installed", systemImage: "puzzlepiece.extension", message: "Browse the marketplace to add one to this site or the whole workspace.")
        } else {
          let shadowed = Set(site.map(\.listingID))
          List {
            ForEach(site + org) { pin in
              Button { context.navigate(marketplaceListingScreen, ["listing": pin.listingID]) } label: {
                AglynRow(
                  pin.name,
                  subtitle: [
                    pin.version.map { "v\($0)" }, pin.scope == .org ? "Every site" : "This site",
                    pin.scope == .org && shadowed.contains(pin.listingID) ? "this site has its own install" : nil,
                  ].compactMap { $0 }.joined(separator: " · "), systemImage: "puzzlepiece.extension"
                ) {
                  Menu {
                    Button { context.navigate(marketplaceListingScreen, ["listing": pin.listingID]) } label: { Label("Details", systemImage: "info.circle") }
                    Button(role: .destructive) { removing = pin } label: { Label("Remove", systemImage: "trash") }
                      .disabled(!canInstall(context))
                  } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel("More for \(pin.name)")
                  }
                }
              }
              .buttonStyle(.plain)
              .aglynListRow()
              .accessibilityIdentifier("pin-\(pin.listingID)")
            }
          }
          .aglynListBackground()
          .accessibilityIdentifier("installed-list")
        }
      } else {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      }
    }
    .background(AglynColor.page)
    .task(id: "\(hostID)-\(context.orgID ?? "")") {
      sitePins.start(context.firestore, FirestoreQuery(["hosts", hostID, "installs"], limit: 50))
      if let orgID = context.orgID {
        orgPins.start(context.firestore, FirestoreQuery(["orgs", orgID, "installs"], limit: 50))
      }
    }
    .onDisappear {
      sitePins.stop()
      orgPins.stop()
    }
  }
}

// MARK: Licenses

/// The console's Licenses: what this workspace holds (who on the team bought each and what it cost before tax), and the
/// signed-in person's own receipts across every workspace they belong to, with the workspace each license landed in.
struct LicencesScreen: View {
  let context: NativePluginContext
  @State private var held = LiveQuery()
  @State private var mine = LiveQuery()
  @State private var licensedTo: String?
  @State private var listingNames: [String: String] = [:]
  @State private var orgNames: [String: String] = [:]

  var body: some View {
    Group {
      if let orgID = context.orgID {
        content(orgID)
      } else {
        AglynEmptyState("Pick a workspace to see its licenses", systemImage: "doc.text")
      }
    }
    .navigationTitle("Licenses")
    .aglynScreenTitle("Licenses")
  }

  private func name(_ licence: LicenceRow) -> String { listingNames[licence.listingID] ?? licence.listingID }

  private func row(_ licence: LicenceRow, detail: String) -> some View {
    Button { context.navigate(marketplaceListingScreen, ["listing": licence.listingID]) } label: {
      AglynRow(
        name(licence), subtitle: [detail, "Paid " + dollars(Double(licence.paidCents)), licence.createdAt.map { relativeTime($0) }].compactMap { $0 }
          .joined(separator: " · "), systemImage: "doc.text")
    }
    .buttonStyle(.aglynRow)
  }

  @ViewBuilder
  private func content(_ orgID: String) -> some View {
    let heldRows = held.state.value.map { $0.map(LicenceRow.init) }
    let mineRows = mine.state.value.map { $0.map(LicenceRow.init) }
    VStack(spacing: 0) {
      SectionTabs(context: context, current: marketplaceLicencesScreen).aglynContentEdges().padding(.vertical, AglynSpace.one)
      List {
        Section {
          AglynNotice(
            "A marketplace purchase licenses one organization. Any member with install permission can install what this workspace owns — and a second workspace needs its own license.",
            tone: .info)
        }
        Section {
          if case .failed = held.state {
            Text("This workspace’s licenses could not be loaded. Check the connection and try again.").foregroundStyle(.secondary)
          } else if let heldRows {
            if heldRows.isEmpty {
              VStack(alignment: .leading, spacing: AglynSpace.half) {
                Text("This workspace holds no licenses").font(AglynFont.headline)
                Text("Anything bought for this workspace shows up here, whoever on the team paid for it.").foregroundStyle(.secondary)
              }
            } else {
              ForEach(heldRows) { licence in row(licence, detail: "Bought by " + boughtByLabel(licence, uid: context.uid)).aglynListRow() }
            }
          } else {
            SkeletonRows(count: 3)
          }
        } header: {
          Text("This workspace")
        } footer: {
          Text("Installable by any member with install permission, whoever on the team bought it")
        }
        .accessibilityIdentifier("licences-held")
        Section {
          if case .failed = mine.state {
            Text("Your purchases could not be loaded. Check the connection and try again.").foregroundStyle(.secondary)
          } else if let mineRows {
            if mineRows.isEmpty && licensedTo == nil {
              VStack(alignment: .leading, spacing: AglynSpace.half) {
                Text("You have not bought anything yet").font(AglynFont.headline)
                Text("Your own marketplace receipts appear here, across every workspace you belong to.").foregroundStyle(.secondary)
              }
            } else {
              Picker("Licensed to", selection: $licensedTo) {
                Text("Any workspace").tag(String?.none)
                Text("This workspace").tag(Optional(orgID))
                ForEach(orgNames.filter { $0.key != orgID }.sorted { $0.value.lowercased() < $1.value.lowercased() }, id: \.key) { entry in
                  Text(entry.value).tag(Optional(entry.key))
                }
                Text("Every workspace you belong to").tag(Optional(everyWorkspace))
              }
              .accessibilityIdentifier("licences-licensed-to")
              if mineRows.isEmpty { Text("None of your purchases is licensed there.").foregroundStyle(.secondary) }
              ForEach(mineRows) { licence in
                row(licence, detail: "Licensed to " + licensedToLabel(licence, orgID: orgID, names: orgNames)).aglynListRow()
              }
            }
          } else {
            SkeletonRows(count: 3)
          }
        } header: {
          Text("Bought by you")
        } footer: {
          Text("Your own receipts, and which workspace each license landed in")
        }
        .accessibilityIdentifier("licences-mine")
      }
      .aglynListBackground()
      .accessibilityIdentifier("licences-list")
    }
    .background(AglynColor.page)
    .task(id: orgID) { held.start(context.firestore, licencesQuery(orgID: orgID)) }
    .task(id: licensedTo ?? "") { mine.start(context.firestore, boughtByYouQuery(uid: context.uid, licensedTo: licensedTo)) }
    .task(id: ((heldRows ?? []) + (mineRows ?? [])).map(\.listingID)) {
      let ids = Set(((heldRows ?? []) + (mineRows ?? [])).map(\.listingID).filter { !$0.isEmpty }).subtracting(listingNames.keys)
      for id in ids.sorted() {
        if let doc = try? await context.firestore.readOnce([listingsCollection, id]) { listingNames[id] = doc.string("displayName") ?? id }
      }
    }
    .task(id: (mineRows ?? []).compactMap(\.buyerOrgID)) {
      // The workspace names the person already sees in the switcher; a workspace they have left stays its id.
      for id in Set((mineRows ?? []).compactMap(\.buyerOrgID)).subtracting(orgNames.keys).sorted() {
        if let doc = try? await context.firestore.readOnce(["orgs", id]), let name = doc.string("name") { orgNames[id] = name }
      }
    }
    .onDisappear {
      held.stop()
      mine.stop()
    }
  }
}
