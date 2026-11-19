// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// "Used by" for a page (AGL-703), as the console's page view shows it: on demand, because the scan reads every page,
// layout and component on the site. The Kotlin kit's PageUsedBy.kt.

/// Something that points at a page, with how (`relation`).
public struct PageDependent: Equatable, Identifiable, Sendable {
  public let type: String
  public let id: String
  public let name: String
  public let relation: String?
  /// One row per kind and id: a layout and a page can share an id.
  public var stableID: String { "\(type)-\(id)" }
}

/// What a dependent's `relation` is called on its row (`RELATION_LABEL`).
public func pageRelationLabel(_ relation: String?) -> String? {
  switch relation {
  case "link": "links here"
  case "child": "nested under"
  case "template": "renders through"
  default: nil
  }
}

/// The console's scope note for a page's scan (`SCOPE_NOTE.screen`).
public let pageUsedByScopeNote =
  "Scanned: link targets on the published version of every page and layout, on every component, the pages nested under "
  + "this one, and the collections that render their pages through it. Links typed as plain addresses rather than picked "
  + "as pages are not scanned — nothing records which page those meant."

/// `POST /api/hosts/where-used` for a page: who points at it, and whether the scan read everything.
public func pageWhereUsed(api: ConsoleAPIClient, hostID: String, pageID: String) async throws -> (dependents: [PageDependent], complete: Bool) {
  let answer = try await api.request(
    "/api/hosts/where-used", method: .post, body: jsonBody(["hostId": hostID, "kind": "screen", "id": pageID]))
  let list: [PageDependent] =
    answer?["dependents"]?.arrayValue?.compactMap { entry in
      guard let id = entry["id"]?.stringValue else { return nil }
      return PageDependent(
        type: entry["type"]?.stringValue ?? "screen", id: id, name: entry["name"]?.stringValue ?? "Untitled",
        relation: entry["relation"]?.stringValue)
    } ?? []
  return (list, answer?["complete"]?.boolValue == true)
}

/// The page's "Used by" section: Find where this is used, then what points at it, each with how and what kind.
struct PageUsedBySection: View {
  let context: NativePluginContext
  let hostID: String
  let pageID: String
  @State private var state: Phase = .idle

  enum Phase: Equatable {
    case idle, loading, failed
    case ready([PageDependent], complete: Bool)
  }

  var body: some View {
    Section("Used by") {
      switch state {
      case .idle:
        Text("Find every page, layout, and component that renders this page before you change or delete it.")
          .foregroundStyle(.secondary)
        Button("Find where this is used") { scan() }.accessibilityIdentifier("page-used-by-scan")
        AglynHelperText(pageUsedByScopeNote)
      case .loading:
        Text("Checking what uses this page…").foregroundStyle(.secondary)
      case .failed:
        AglynNotice(
          "Could not check what uses this page. This is not the same as nothing using it — treat deletion as unsafe until "
            + "the check succeeds.", tone: .warning)
        Button("Try again") { scan() }
      case .ready(let found, let complete):
        if found.isEmpty {
          if complete {
            Text("Nothing uses this page — deleting it changes no live page.")
          } else {
            AglynNotice(
              "Nothing found, but this site has more content than one pass reads — something may still use this page.",
              tone: .warning)
          }
        } else {
          Text("Used in \(found.count) place\(found.count == 1 ? "" : "s") — deleting this page affects each of them.")
            .foregroundStyle(.secondary)
          ForEach(found, id: \.stableID) { item in
            AglynRow(item.name, systemImage: item.type == "screen" ? SiteSymbols.page : "square.on.square.dashed") {
              HStack(spacing: AglynSpace.half) {
                if let relation = pageRelationLabel(item.relation) {
                  StatusChip(relation, tone: item.relation == "template" ? .warning : .neutral)
                }
                StatusChip(dependentLabel(item.type))
              }
            }
          }
        }
        AglynHelperText(pageUsedByScopeNote)
        Button("Rescan") { scan() }.accessibilityIdentifier("page-used-by-rescan")
      }
    }
    .onChange(of: pageID) { state = .idle }
  }

  private func scan() {
    state = .loading
    Task { @MainActor in
      do {
        let answer = try await pageWhereUsed(api: context.api, hostID: hostID, pageID: pageID)
        state = .ready(answer.dependents, complete: answer.complete)
      } catch {
        state = .failed
      }
    }
  }
}
