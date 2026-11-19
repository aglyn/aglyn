// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The zone a CRM record's page hosts for what other plugins read about the record (the console's `recordInsights`).
public let recordInsightsZoneName = "recordInsights"

/// A task a widget proposes for the record (the console's `ConsoleProposedTask`); the record's own task editor opens with it.
public struct ProposedTask: Equatable, Sendable {
  public let title: String
  public let notes: String
  /// `call`, `email`, `meeting` or `todo`.
  public let kind: String
  /// `low`, `normal` or `high`.
  public let priority: String
  public let dueInDays: Int

  public init(title: String, notes: String, kind: String, priority: String, dueInDays: Int) {
    self.title = title
    self.notes = notes
    self.kind = kind
    self.priority = priority
    self.dueInDays = dueInDays
  }
}

/// One of an open deal's stages, as the record page names them.
public struct RecordStage: Equatable, Sendable {
  public let id: String
  public let name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

/// What a CRM record's page hands the widgets in its `recordInsights` zone (the console's `ConsoleRecordInsightsZoneProps`):
/// which record it is, and the writes the page makes for them, each only where the page can make it. Nothing a widget
/// proposes is saved until the person saves it in the page's own editor.
public struct RecordInsightsZone: @unchecked Sendable {
  public let hostID: String?
  public let orgID: String?
  /// `contact`, `company`, `deal` or `lead`.
  public let recordKind: String
  public let recordID: String
  public let name: String
  /// An open deal's stages and the one it is in; nil on any other record.
  public let stages: [RecordStage]?
  public let stageID: String?
  /// Opens the record's task editor filled with `task` (nil where the record has no tasks, a lead's); the key is the job's.
  public let proposeTask: (@MainActor (ProposedTask, String) -> Void)?
  /// Asks to move an open deal to a stage, as its stage card does (nil on any other record).
  public let proposeStage: (@MainActor (String, String) -> Void)?

  public init(
    hostID: String?, orgID: String?, recordKind: String, recordID: String, name: String, stages: [RecordStage]? = nil,
    stageID: String? = nil, proposeTask: (@MainActor (ProposedTask, String) -> Void)? = nil,
    proposeStage: (@MainActor (String, String) -> Void)? = nil
  ) {
    self.hostID = hostID
    self.orgID = orgID
    self.recordKind = recordKind
    self.recordID = recordID
    self.name = name
    self.stages = stages
    self.stageID = stageID
    self.proposeTask = proposeTask
    self.proposeStage = proposeStage
  }
}

private struct RecordInsightsZoneKey: EnvironmentKey {
  static let defaultValue: RecordInsightsZone? = nil
}

extension EnvironmentValues {
  /// A CRM record page's zone, while one of its widgets is drawn; nil anywhere else.
  public var recordInsightsZone: RecordInsightsZone? {
    get { self[RecordInsightsZoneKey.self] }
    set { self[RecordInsightsZoneKey.self] = newValue }
  }
}
