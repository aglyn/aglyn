// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation
import Observation
import SwiftUI

// Moving files between a site's library and the organization library
// (`/api/media/move-library`, AGL-4254), as the console's media library does:
// a preview first (what will move, what has to stay and why, how many uses
// will be updated), then the move, asked again until the route has nothing
// left, and the report in the console's words (`media-library-move-copy.ts`).

/// Which way the files go: from the organization library into this site's, or from the site's up to the organization's.
public enum MediaLibraryDirection: String, Hashable, Sendable {
  case toSite = "to-site"
  case toOrg = "to-org"
}

/// The other library a file on screen can move to: the site and its workspace, and which way.
public struct MediaLibraryMoveTarget: Hashable, Sendable {
  public let orgID: String
  public let hostID: String
  public let direction: MediaLibraryDirection

  public init(orgID: String, hostID: String, direction: MediaLibraryDirection) {
    self.orgID = orgID
    self.hostID = hostID
    self.direction = direction
  }
}

extension MediaScope {
  /// Where a file in this library can move: only on a site's media screen, which shows both libraries. A site's own
  /// library moves up to its workspace (`orgID`); the workspace's, seen from a site, moves down into that site. The
  /// workspace's own media page (no site) has nowhere to move to.
  public func libraryMove(orgID: String?) -> MediaLibraryMoveTarget? {
    switch self {
    case .site(let hostID):
      guard let orgID, !orgID.isEmpty, !hostID.isEmpty else { return nil }
      return MediaLibraryMoveTarget(orgID: orgID, hostID: hostID, direction: .toOrg)
    case .org(let orgID, let forHostID?):
      guard !orgID.isEmpty, !forHostID.isEmpty else { return nil }
      return MediaLibraryMoveTarget(orgID: orgID, hostID: forHostID, direction: .toSite)
    case .org(_, nil):
      return nil
    }
  }
}

/// A file the route would not move, and why, in its words.
public struct MediaLibraryRefusal: Hashable, Sendable {
  public let mediaID: String
  public let name: String
  public let reason: String?

  public init(mediaID: String, name: String, reason: String?) {
    self.mediaID = mediaID
    self.name = name
    self.reason = reason
  }

  static func list(_ value: JSONValue?) -> [MediaLibraryRefusal] {
    value?.arrayValue?.compactMap { entry in
      guard let id = entry["mediaId"]?.stringValue, !id.isEmpty else { return nil }
      return MediaLibraryRefusal(mediaID: id, name: entry["name"]?.stringValue ?? id, reason: entry["reason"]?.stringValue)
    } ?? []
  }
}

/// What a preview answers: what can move, what has to stay, and how many pages, products or settings use what moves.
public struct MediaLibraryMovePreview: Hashable, Sendable {
  public let movable: [String]
  public let refused: [MediaLibraryRefusal]
  public let unknownIDs: [String]
  public let documents: Int

  public init(movable: [String], refused: [MediaLibraryRefusal], unknownIDs: [String] = [], documents: Int) {
    self.movable = movable
    self.refused = refused
    self.unknownIDs = unknownIDs
    self.documents = documents
  }

  init(_ answer: JSONValue?) {
    self.init(
      movable: answer?["movable"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      refused: MediaLibraryRefusal.list(answer?["refused"]),
      unknownIDs: answer?["unknownIds"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      documents: Int(answer.numberField("documents") ?? 0))
  }
}

/// What a whole move did, every round summed: what moved, what did not (and why), and the uses rewritten.
public struct MediaLibraryMoveOutcome: Hashable, Sendable {
  public let movedIDs: [String]
  public let notMoved: [MediaLibraryRefusal]
  public let uses: Int
  /// The route's own words when it refused a round outright (nothing after it was heard).
  public let transportError: String?

  public init(movedIDs: [String], notMoved: [MediaLibraryRefusal], uses: Int, transportError: String? = nil) {
    self.movedIDs = movedIDs
    self.notMoved = notMoved
    self.uses = uses
    self.transportError = transportError
  }
}

/// The rounds a move asks for at most (the route stops each round at its time budget).
public let mediaLibraryMoveMaxRounds = 20

extension MediaAPI {
  /// The move route's body: both libraries by id, the direction, the files, and `preview` when only asking.
  func libraryMoveBody(_ ids: [String], to target: MediaLibraryMoveTarget, preview: Bool) -> JSONValue {
    var fields: [String: Any?] = [
      "orgId": target.orgID, "hostId": target.hostID, "direction": target.direction.rawValue, "mediaIds": ids,
    ]
    if preview { fields["preview"] = true }
    return .from(fields)
  }

  /// Asks what would move to the other library, writing nothing.
  public func previewLibraryMove(_ ids: [String], to target: MediaLibraryMoveTarget) async throws -> MediaLibraryMovePreview {
    MediaLibraryMovePreview(
      try await api.request("/api/media/move-library", method: .post, body: libraryMoveBody(ids, to: target, preview: true)))
  }

  /// Moves `preview.movable` to the other library, asking again while the route answers `remainingIds` and the last
  /// round moved or failed something (at most `mediaLibraryMoveMaxRounds`), summing the uses it rewrote. What the
  /// preview refused, what a round refused or failed, and what was never heard back about are all `notMoved`;
  /// `names` names the last kind.
  public func moveToOtherLibrary(
    _ preview: MediaLibraryMovePreview, to target: MediaLibraryMoveTarget, names: [String: String] = [:],
    progress: @MainActor @Sendable (_ done: Int, _ total: Int) -> Void = { _, _ in }
  ) async -> MediaLibraryMoveOutcome {
    var moved: [String] = []
    var notMoved = preview.refused
    var uses = 0
    var pending = preview.movable
    var transportError: String?
    var rounds = 0
    await progress(0, preview.movable.count)
    while !pending.isEmpty && rounds < mediaLibraryMoveMaxRounds {
      rounds += 1
      let answer: JSONValue?
      do {
        answer = try await api.request(
          "/api/media/move-library", method: .post, body: libraryMoveBody(pending, to: target, preview: false))
      } catch {
        transportError = (error as? ConsoleAPIError)?.message
        break
      }
      let roundMoved = answer?["movedIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
      let failed = MediaLibraryRefusal.list(answer?["failed"])
      moved.append(contentsOf: roundMoved)
      uses += Int(answer?["rewrote"]?["uses"]?.numberValue ?? 0)
      for one in failed + MediaLibraryRefusal.list(answer?["refused"]) where !notMoved.contains(where: { $0.mediaID == one.mediaID }) {
        notMoved.append(one)
      }
      await progress(moved.count, preview.movable.count)
      if roundMoved.isEmpty && failed.isEmpty { break }
      if answer.boolField("done") == true { break }
      pending = answer?["remainingIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }
    // Anything not heard back about has not moved yet: it is reported so, and stays selected.
    for id in preview.movable where !moved.contains(id) && !notMoved.contains(where: { $0.mediaID == id }) {
      notMoved.append(MediaLibraryRefusal(mediaID: id, name: names[id] ?? id, reason: nil))
    }
    return MediaLibraryMoveOutcome(movedIDs: moved, notMoved: notMoved, uses: uses, transportError: transportError)
  }
}

// MARK: Copy (the console's `media-library-move-copy.ts`)

private func filesCount(_ count: Int) -> String { "\(count) file\(count == 1 ? "" : "s")" }
private func usesCount(_ count: Int) -> String { "\(count) use\(count == 1 ? "" : "s")" }

/// The action's label, by where the file is now.
public func mediaLibraryMoveLabel(_ direction: MediaLibraryDirection) -> String {
  direction == .toSite ? "Move to this site's library" : "Move to organization library"
}

/// Where the files go, in a sentence.
public func mediaLibraryName(_ direction: MediaLibraryDirection) -> String {
  direction == .toSite ? "this site's library" : "the organization library"
}

/// The confirmation's explanation before anything moves.
public func mediaLibraryMoveIntro(_ direction: MediaLibraryDirection, movable: Int, documents: Int) -> String {
  let what =
    direction == .toSite
    ? "Only this site will be able to use them." : "Every site in the workspace will be able to use them."
  let one = documents == 1
  let updated =
    documents > 0
    ? " \(documents) page\(one ? "" : "s"), product\(one ? "" : "s") or setting\(one ? "" : "s") that use\(one ? "s" : "") them will be updated to the new address, and the old address keeps working."
    : " Nothing uses them yet."
  return "\(filesCount(movable)) will move to \(mediaLibraryName(direction)). \(what)\(updated)"
}

/// The confirmation when nothing picked can move.
public func mediaLibraryNothingMoves(_ direction: MediaLibraryDirection) -> String {
  "None of these files can move to \(mediaLibraryName(direction))."
}

/// The heading over what the preview refused.
public func mediaLibraryStaysHeading(_ count: Int) -> String {
  "\(filesCount(count)) will stay where \(count == 1 ? "it is" : "they are"):"
}

/// One refused file's line: its name and the reason, without the route's "Stays in the organization library: ".
public func mediaLibraryRefusalLine(_ refusal: MediaLibraryRefusal) -> String {
  let prefix = "Stays in the organization library: "
  guard var reason = refusal.reason else { return refusal.name }
  if reason.hasPrefix(prefix) { reason.removeFirst(prefix.count) }
  return "\(refusal.name): \(reason)"
}

/// The confirm button: `Move 3 files`, or `Move` while nothing can.
public func mediaLibraryMoveButton(_ movable: Int) -> String {
  movable > 0 ? "Move \(filesCount(movable))" : "Move"
}

/// `Moved 12 files to this site's library and updated 31 uses`.
public func mediaLibraryMovedMessage(_ direction: MediaLibraryDirection, moved: Int, uses: Int) -> String {
  "Moved \(filesCount(moved)) to \(mediaLibraryName(direction)) and updated \(usesCount(uses))"
}

/// `Moved 7 of 9 to this site's library and updated 12 uses — 2 could not be moved: "a.png" and "b.png", and are
/// still selected`.
public func mediaLibraryPartialMessage(
  _ direction: MediaLibraryDirection, moved: Int, total: Int, uses: Int, notMoved: [MediaLibraryRefusal]
) -> String {
  let named = notMoved.prefix(3).map { one in one.reason.map { "\"\(one.name)\" (\($0))" } ?? "\"\(one.name)\"" }
  let more = notMoved.count > 3 ? " and \(notMoved.count - 3) more" : ""
  let head =
    moved > 0
    ? "Moved \(moved) of \(total) to \(mediaLibraryName(direction)) and updated \(usesCount(uses))"
    : "Could not move \(filesCount(total)) to \(mediaLibraryName(direction))"
  let tail = moved > 0 ? "could not be moved" : "are where they were"
  return "\(head) — \(notMoved.count) \(tail): \(named.joined(separator: ", "))\(more), and \(notMoved.count == 1 ? "is" : "are") still selected"
}

/// What the library says once a move has run, and in which tone: success, a partial move, or nothing moved.
public enum MediaLibraryMoveReport: Hashable, Sendable {
  case success(String)
  case partial(String)
  case failed(String)

  public var message: String {
    switch self {
    case .success(let text), .partial(let text), .failed(let text): text
    }
  }

  /// The console's snackbar variant: success, warning, error.
  public var tone: AglynTone {
    switch self {
    case .success: .success
    case .partial: .warning
    case .failed: .error
    }
  }

  public init(_ outcome: MediaLibraryMoveOutcome, direction: MediaLibraryDirection, total: Int) {
    if outcome.notMoved.isEmpty {
      self = .success(mediaLibraryMovedMessage(direction, moved: outcome.movedIDs.count, uses: outcome.uses))
      return
    }
    if outcome.movedIDs.isEmpty, let error = outcome.transportError {
      self = .failed(error)
      return
    }
    let text = mediaLibraryPartialMessage(
      direction, moved: outcome.movedIDs.count, total: total, uses: outcome.uses, notMoved: outcome.notMoved)
    self = outcome.movedIDs.isEmpty ? .failed(text) : .partial(text)
  }
}

// MARK: The confirmation

/// One move's confirmation, from asking through reporting. The library holds it; whichever view the person is looking
/// at (the library, or a file's details pushed over it on a phone) presents it.
@MainActor
@Observable
public final class MediaLibraryMover {
  public enum Phase: Equatable {
    case checking
    case problem(String)
    case ready(MediaLibraryMovePreview)
    case moving(done: Int, total: Int, preview: MediaLibraryMovePreview)
  }

  public struct Request: Identifiable, Equatable {
    public let id = UUID()
    public let ids: [String]
    public let names: [String: String]
    public let target: MediaLibraryMoveTarget
    /// Presented by a file's pushed details rather than the library.
    public let fromDetail: Bool
  }

  public private(set) var request: Request?
  public private(set) var phase: Phase = .checking

  public init() {}

  public var busy: Bool {
    if case .moving = phase { return true }
    return false
  }

  /// Opens the confirmation for `ids` and runs the preview.
  public func start(_ ids: [String], names: [String: String], target: MediaLibraryMoveTarget, api: MediaAPI, fromDetail: Bool = false) {
    guard request == nil, !ids.isEmpty else { return }
    let request = Request(ids: ids, names: names, target: target, fromDetail: fromDetail)
    self.request = request
    phase = .checking
    Task { @MainActor in
      do {
        let preview = try await api.previewLibraryMove(ids, to: target)
        if self.request?.id == request.id { phase = .ready(preview) }
      } catch {
        let message = (error as? ConsoleAPIError)?.message ?? "Could not check where these files are used"
        if self.request?.id == request.id { phase = .problem(message) }
      }
    }
  }

  public func cancel() {
    guard !busy else { return }
    request = nil
  }

  /// Runs the move and hands the outcome to `finished` (what moved, and the report to show).
  public func confirm(api: MediaAPI, finished: @escaping @MainActor (_ movedIDs: [String], _ report: MediaLibraryMoveReport) -> Void) {
    guard let request, case .ready(let preview) = phase, !preview.movable.isEmpty else { return }
    phase = .moving(done: 0, total: preview.movable.count, preview: preview)
    Task { @MainActor in
      let outcome = await api.moveToOtherLibrary(preview, to: request.target, names: request.names) { done, total in
        if self.request?.id == request.id { self.phase = .moving(done: done, total: total, preview: preview) }
      }
      self.request = nil
      finished(outcome.movedIDs, MediaLibraryMoveReport(outcome, direction: request.target.direction, total: request.ids.count))
    }
  }
}

/// The confirmation sheet: the preview while it is asked, what will move and what stays, then the move's progress.
struct MediaLibraryMoveSheet: View {
  let mover: MediaLibraryMover
  let api: MediaAPI
  let finished: @MainActor (_ movedIDs: [String], _ report: MediaLibraryMoveReport) -> Void

  private var direction: MediaLibraryDirection { mover.request?.target.direction ?? .toOrg }

  private var preview: MediaLibraryMovePreview? {
    switch mover.phase {
    case .ready(let preview), .moving(_, _, let preview): preview
    default: nil
    }
  }

  var body: some View {
    AglynActionSheet(
      mediaLibraryMoveLabel(direction), confirmLabel: mediaLibraryMoveButton(preview?.movable.count ?? 0),
      confirmEnabled: !(preview?.movable.isEmpty ?? true), busy: mover.busy,
      error: { if case .problem(let message) = mover.phase { return message } else { return nil } }(),
      onCancel: { mover.cancel() }, onConfirm: { mover.confirm(api: api, finished: finished) }
    ) {
      switch mover.phase {
      case .checking:
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text("Checking every page, product and setting that uses these files…")
          ProgressView().progressViewStyle(.linear)
        }
        .accessibilityIdentifier("media-library-move-checking")
      case .problem:
        Text(mediaLibraryNothingMoves(direction))
      case .ready(let preview), .moving(_, _, let preview):
        Text(
          preview.movable.isEmpty
            ? mediaLibraryNothingMoves(direction)
            : mediaLibraryMoveIntro(direction, movable: preview.movable.count, documents: preview.documents)
        )
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("media-library-move-intro")
        if !preview.refused.isEmpty {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(mediaLibraryStaysHeading(preview.refused.count)).font(AglynFont.caption.weight(.semibold))
            ForEach(preview.refused.prefix(8), id: \.mediaID) { one in
              Text(mediaLibraryRefusalLine(one)).font(AglynFont.caption)
            }
            if preview.refused.count > 8 { Text("and \(preview.refused.count - 8) more").font(AglynFont.caption) }
          }
          .foregroundStyle(AglynColor.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("media-library-move-refused")
        }
        if case .moving(let done, let total, _) = mover.phase {
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            Text("Moving \(done) of \(total) file\(total == 1 ? "" : "s")…").font(AglynFont.caption)
              .foregroundStyle(AglynColor.secondaryText)
            ProgressView(value: Double(done), total: Double(max(total, 1))).progressViewStyle(.linear)
          }
        }
      }
    }
    .accessibilityIdentifier("media-library-move")
  }
}

/// What a file's details need to offer the move to the other library: the library's confirmation, how to open it for
/// one file, and what to do once it has run.
struct MediaDetailLibraryMove {
  let mover: MediaLibraryMover
  let start: (MediaItem) -> Void
  let finished: @MainActor (_ movedIDs: [String], _ report: MediaLibraryMoveReport) -> Void
}
