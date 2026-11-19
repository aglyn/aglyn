// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * Marketplace site templates in the template gallery (the console's `TemplateGalleryShelf`, the `templateGallery` zone,
 * AGL-137 and AGL-3080): published bundles with previews, searched by the gallery's search word, only where the gallery
 * picks pages (a five-page site on the components list would install pages nobody asked for). "Use template" installs
 * through `marketplace/install-template`, which lands the bundle in the site's library and publishes nothing. The Kotlin
 * plugin's TemplateGalleryShelf.kt draws the same.
 */

/// The name this shelf reports itself by to the gallery (`SHELF_ID`).
let templateShelfID = "marketplace-site-templates"

/// The console route that installs a site template into a site's library.
let installTemplateRoute = "/api/marketplace/install-template"

/// The shelf's query (`SITE_TEMPLATE_SHELF_QUERY` over `SITE_TEMPLATE_SHELF_BASE`), the gallery's search word folded in.
func templateShelfQuery(search: String, limit: Int) -> FirestoreQuery {
  let words = search.split(whereSeparator: { $0.isWhitespace }).map(String.init)
  return planListQuery(
    ContractValues.shared.siteTemplateShelfQuery,
    ListQueryRequest(base: ContractValues.shared.siteTemplateShelfBase, clauses: [], search: words.isEmpty ? nil : words)
  )
  .firestoreQuery([listingsCollection], limit: limit)
}

/// The facts under a template's name, as the console's card says them: its pages, its version, its price.
func templateShelfFacts(screenCount: Double?, version: String?, priceUSD: Double) -> String {
  "\(screenCount.map { jsNumberString($0) } ?? "?") pages · v\(version ?? "")" + (priceUSD > 0 ? " · $\(jsNumberString(priceUSD))" : " · free")
}

/// What a successful install says: the bundle went to the library, and nothing was published.
func templateInstalledMessage(added: Int, name: String) -> String {
  "Saved \(added) template\(added == 1 ? "" : "s") from \"\(name)\" to your library — open Templates to create pages from them."
}

/// How the shelf stands for the gallery, as the console's reports it.
func templateShelfState(offered: Bool, loading: Bool, visible: Bool) -> TemplateGalleryShelfState {
  !offered ? .empty : loading ? .loading : visible ? .shown : .empty
}

struct TemplateGalleryShelf: View {
  let context: NativePluginContext
  @Environment(\.templateGalleryZone) private var zone
  @State private var listings = LiveQuery()
  @State private var limit = browsePageSize
  @State private var installing: String?
  @State private var runner = PluginActionRunner()

  var body: some View {
    if let zone {
      let offered = zone.kind == "page"
      let docs: [FirestoreDocument] = if case .ready(let docs) = listings.state { docs } else { [] }
      // An unpublished listing keeps its document (`deletedAt`); it is dropped from the page it falls in.
      let rows = docs.filter { $0.data["deletedAt"] == nil || $0.data["deletedAt"] is NSNull }
      let loading = if case .loading = listings.state { true } else { false }
      let hasMore = docs.count >= limit
      let state = templateShelfState(offered: offered, loading: loading, visible: !rows.isEmpty || hasMore)
      // SwiftUI never starts the task of a view that draws nothing, so the query hangs off a row that is always in the
      // gallery's list (no height, no separator); the shelf's own rows follow it once there is something to show.
      Color.clear
        .frame(height: 0)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .accessibilityHidden(true)
        .task(id: "\(offered)-\(zone.search)-\(limit)") {
          guard offered else { return }
          await listings.bind(context.firestore, templateShelfQuery(search: zone.search, limit: limit))
        }
        .onChange(of: state, initial: true) { _, next in zone.reportShelf(templateShelfID, next) }
      if offered, state == .shown {
        Section {
          if let error = runner.error { AglynNotice(error, tone: .error) { runner.error = nil } }
          ForEach(rows, id: \.id) { doc in card(doc, zone: zone) }
          if hasMore { AglynLoadMoreRow("Show more templates") { limit += browsePageSize } }
        } header: {
          Text("Marketplace templates").accessibilityAddTraits(.isHeader)
        }
        .accessibilityIdentifier("marketplace-template-shelf")
      }
    }
  }

  private func card(_ doc: FirestoreDocument, zone: TemplateGalleryZone) -> some View {
    let name = doc.string("displayName") ?? doc.id
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynRemoteImage(
        mediaPreviewURL(doc.string("previewImageUrl"), origin: context.api.origin, hostID: nil, width: 480),
        systemImage: "square.grid.2x2"
      )
      .frame(maxWidth: .infinity)
      .frame(height: AglynSpace.of(15))
      .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
      .accessibilityLabel("\(name) preview")
      Text(name).font(AglynFont.headline)
      if let category = doc.string("category") { StatusChip(category) }
      if let description = doc.string("description") { Text(description).font(AglynFont.subheadline).foregroundStyle(.secondary) }
      Text(templateShelfFacts(screenCount: doc.double("screenCount"), version: doc.string("latestVersion") ?? doc.double("latestVersion").map { jsNumberString($0) }, priceUSD: doc.double("priceUsd") ?? 0))
        .font(AglynFont.caption).foregroundStyle(.secondary)
      Button(installing == doc.id ? "Installing…" : "Use template") { install(doc.id, name: name, zone: zone) }
        .buttonStyle(.aglynProminent)
        .disabled(installing != nil)
        .accessibilityIdentifier("marketplace-template-use-\(doc.id)")
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("marketplace-template-\(doc.id)")
  }

  private func install(_ listingID: String, name: String, zone: TemplateGalleryZone) {
    installing = listingID
    runner.run {
      defer { installing = nil }
      let answer = try await context.api.request(
        installTemplateRoute, method: .post, body: JSONValue.from(["listingId": listingID, "hostId": zone.hostID]))
      zone.onInstalled(templateInstalledMessage(added: Int(answer?["templates"]?.numberValue ?? 0), name: name))
    }
  }
}
