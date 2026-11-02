// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The marketplace's starters in Create site (AGL-4049): the `hostStarterPicker` zone, drawn before the site exists. Lists
/// what the sheet asks for as rows of one choice: a picture, the name, who made it and its page count, and the price.
/// Nothing is picked when it opens; a person picks, and the pick goes to the sheet, which creates the site from it.
///
/// `ready` tells the sheet whether a picker is on screen, and the first answer decides, as the console's shelf does:
/// starters, or a search that found none, say yes; a workspace refused the starters, a catalog with nothing in it or a
/// first read that failed say no, and the sheet offers its styles instead. Once shown, a later refusal hands back the same
/// way, and a later failure is said here with a way to ask again.
///
/// What a pick needs next is the sheet's to say (`siteStarterPickNote`), at its foot, in view however long the list.
/// Figma: "Native App", `Sites · Choose your starter`.
struct StarterPickerWidget: View {
  let context: NativePluginContext
  @Environment(\.starterPickerZone) private var zone
  @State private var rows: [SiteStarterSummary] = []
  @State private var failure: String?
  @State private var loaded = false
  @State private var shown = false

  /// Statuses that mean this workspace may not have starters offered here.
  private static let refused: Set<Int> = [401, 403, 503]

  private var searchKey: String { "\(zone?.orgID ?? "")|\(zone?.mode.rawValue ?? "")|\(zone?.search ?? "")|\(attempt)" }
  @State private var attempt = 0

  var body: some View {
    Group {
      if let failure {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          AglynNotice(failure, tone: .error)
          Button("Try again") { attempt += 1 }.buttonStyle(.aglynSecondary)
        }
        .padding(AglynSpace.two)
      } else if !loaded {
        VStack(spacing: 0) { SkeletonRows(count: 3) }.padding(AglynSpace.two).accessibilityLabel("Loading starters")
      } else if rows.isEmpty {
        AglynNotice(emptyMessage, tone: .info).padding(AglynSpace.two)
      } else {
        VStack(spacing: 0) {
          ForEach(rows) { row in
            AglynChoiceRow(
              row.displayName.isEmpty ? "Untitled starter" : row.displayName, detail: detail(row), badge: badge(row),
              picture: .init(starterPicture(row, origin: context.api.origin, width: 240)), selected: zone?.selected?.listingID == row.listingID
            ) { zone?.onPick(row) }
            .padding(.horizontal, AglynSpace.two)
            .padding(.vertical, AglynSpace.oneAndHalf)
            .accessibilityIdentifier("starter-\(row.listingID)")
            if row.id != rows.last?.id { Divider().padding(.leading, AglynSpace.two) }
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(zone?.mode == .ai ? "AI starters" : "Starters")
        .accessibilityIdentifier("starter-list")
      }
    }
    .task(id: searchKey) { await read() }
  }

  /// Under the name: who made it and how many pages it creates, as one line.
  private func detail(_ row: SiteStarterSummary) -> String {
    [row.authorName.isEmpty ? nil : "By \(row.authorName)", StarterQuery.pagesLabel(Double(row.pages))]
      .compactMap { $0 }.joined(separator: " · ")
  }

  /// The price, every row carrying one, "Free" included; one the workspace owns says so instead.
  private func badge(_ row: SiteStarterSummary) -> (text: String, tone: AglynTone) {
    if row.priceUsd > 0 { return row.owned == true ? ("Owned", .success) : (siteStarterPriceLabel(row.priceUsd), .info) }
    return ("Free", .success)
  }

  private var emptyMessage: String {
    if zone?.search.isBlank == false { return "No starters match — try fewer words" }
    return zone?.mode == .ai ? "No AI starters yet" : "No starters yet"
  }

  private func read() async {
    guard let zone else { return }
    failure = nil
    do {
      let answer = try await context.api.request(
        SiteStarterSearch.path, query: StarterQuery.params(orgID: zone.orgID, mode: zone.mode, word: zone.search).map { ($0.0, $0.1) })
      if Task.isCancelled { return }
      rows = StarterQuery.parseAnswer(answer)
      loaded = true
      // The first answer is the only one that may decide there is nothing to show.
      if shown || !rows.isEmpty || !zone.search.isBlank {
        shown = true
        zone.ready(true)
      } else {
        zone.ready(false)
      }
    } catch is CancellationError {
      return
    } catch {
      if Task.isCancelled { return }
      let status = (error as? ConsoleAPIError)?.status
      if !shown || status.map(Self.refused.contains) == true {
        shown = false
        zone.ready(false)
      } else {
        failure = (error as? ConsoleAPIError)?.message ?? "Starters could not be loaded"
      }
    }
  }
}

extension String {
  fileprivate var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
