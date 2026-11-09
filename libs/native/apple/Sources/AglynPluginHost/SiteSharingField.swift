// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// One of the workspace's sites as a sharing field lists it.
public struct SharingSite: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

/// The modes a choice can take, as the field offers them.
public enum SiteSharingMode: String, CaseIterable, Sendable {
  case all, selected, allExcept
}

extension ScopeSharingChoice {
  /// The mode this choice is in.
  public var mode: SiteSharingMode {
    switch self {
    case .all: return .all
    case .selected: return .selected
    case .allExcept: return .allExcept
    }
  }

  /// A choice as it stores, from what a stored document says: nil for one that stores none (no reader matches it).
  public init?(_ sharing: ScopeSharing) {
    switch sharing {
    case .all: self = .all
    case .selected(let hostIDs): self = .selected(hostIDs: hostIDs)
    case .allExcept(let except, _): self = .allExcept(exceptHostIDs: except)
    case .none: return nil
    }
  }

  /// Two choices compare by what they pick, in any order (the console's `campaignSharingKey`).
  public var key: String {
    switch self {
    case .all: return "all"
    case .selected(let ids): return "selected:\(ids.sorted().joined(separator: ","))"
    case .allExcept(let ids): return "allExcept:\(ids.sorted().joined(separator: ","))"
    }
  }

  /// The choice as the manage routes read it off the wire (`{ mode, hostIds | exceptHostIds }`).
  public var wire: [String: Any] {
    switch self {
    case .all: return ["mode": "all"]
    case .selected(let ids): return ["mode": "selected", "hostIds": ids]
    case .allExcept(let ids): return ["mode": "allExcept", "exceptHostIds": ids]
    }
  }
}

/// Who something is shared with, or where it runs, as the console's SiteSharingField edits it (AGL-4047): all sites, the
/// sites chosen, or all sites except some. Rows for a Form section: the three modes, then the sites the chosen mode
/// acts on, each box meaning the same thing throughout. "All sites except…" stays on screen with the reason when it
/// cannot be picked; the current choice stays on, since nobody is told they can't have what they have.
public struct SiteSharingField: View {
  let label: String
  @Binding var value: ScopeSharingChoice?
  let sites: [SharingSite]
  let sitesReady: Bool
  let modes: [SiteSharingMode]
  let maxIncluded: Int?
  let readOnly: Bool
  let readOnlyReason: String?
  let problem: String?
  /// A sentence per choice where the defaults aren’t true of this resource (web’s `modeDetails`); an off-reason wins.
  let modeDetails: [SiteSharingMode: String]

  public init(
    _ label: String = "Shared with", value: Binding<ScopeSharingChoice?>, sites: [SharingSite], sitesReady: Bool,
    modes: [SiteSharingMode] = SiteSharingMode.allCases, maxIncluded: Int? = nil, readOnly: Bool = false,
    readOnlyReason: String? = nil, problem: String? = nil, modeDetails: [SiteSharingMode: String] = [:]
  ) {
    self.modeDetails = modeDetails
    self.label = label
    _value = value
    self.sites = sites
    self.sitesReady = sitesReady
    self.modes = modes
    self.maxIncluded = maxIncluded
    self.readOnly = readOnly
    self.readOnlyReason = readOnlyReason
    self.problem = problem
  }

  private var siteIDs: [String] { sites.map(\.id) }

  private var exceptOffReason: String? {
    if !sitesReady { return "Reading this workspace’s sites…" }
    if sites.count < 2 { return "This workspace has one site, so there is nothing to leave out." }
    if let maxIncluded, sites.count > maxIncluded {
      return "This works up to \(maxIncluded) sites, and this workspace has \(sites.count). Choose the sites instead."
    }
    return nil
  }

  /// The list a mode acts on.
  private var picked: [String] {
    switch value {
    case .selected(let ids): return ids
    case .allExcept(let ids): return ids
    default: return []
    }
  }

  private func choose(_ mode: SiteSharingMode) {
    switch mode {
    case .all: value = .all
    case .selected:
      if case .allExcept(let except) = value {
        value = .selected(hostIDs: siteIDs.filter { !except.contains($0) })
      } else if value?.mode != .selected {
        value = .selected(hostIDs: [])
      }
    case .allExcept:
      if case .selected(let ids) = value {
        value = .allExcept(exceptHostIDs: siteIDs.filter { !ids.contains($0) })
      } else if value?.mode != .allExcept {
        value = .allExcept(exceptHostIDs: [])
      }
    }
  }

  private func toggle(_ hostID: String) {
    let next = picked.contains(hostID) ? picked.filter { $0 != hostID } : picked + [hostID]
    if value?.mode == .allExcept { value = .allExcept(exceptHostIDs: next) } else { value = .selected(hostIDs: next) }
  }

  public var body: some View {
    Group {
      // A field under a heading that already names it passes no label.
      if !label.isEmpty { Text(label).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText) }
      if readOnly, let readOnlyReason { AglynHelperText(readOnlyReason) }
      if modes.contains(.all) {
        AglynChoiceRow("All sites", detail: modeDetails[.all], selected: value?.mode == .all, enabled: !readOnly) { choose(.all) }
          .accessibilityIdentifier("sharing-mode-all")
      }
      if modes.contains(.selected) {
        AglynChoiceRow(
          "Selected sites", detail: modeDetails[.selected] ?? "A new site doesn’t get this until you add it.",
          selected: value?.mode == .selected,
          enabled: !readOnly
        ) { choose(.selected) }
        .accessibilityIdentifier("sharing-mode-selected")
      }
      if modes.contains(.allExcept) {
        let enabled = !readOnly && (exceptOffReason == nil || value?.mode == .allExcept)
        AglynChoiceRow(
          "All sites except…", detail: exceptOffReason ?? modeDetails[.allExcept] ?? "A new site gets this automatically.",
          selected: value?.mode == .allExcept, enabled: enabled
        ) { if enabled { choose(.allExcept) } }
        .accessibilityIdentifier("sharing-mode-allExcept")
      }
      if value?.mode == .selected || value?.mode == .allExcept {
        let excepting = value?.mode == .allExcept
        Text(excepting ? "Sites to leave out" : "Sites to share with")
          .font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
        if !sitesReady {
          Text("Reading this workspace’s sites…").foregroundStyle(AglynColor.secondaryText)
        } else {
          // Leaving out every site this member can name, with no other site known to stay.
          let lastIn = excepting ? siteIDs.filter { !picked.contains($0) } : []
          ForEach(sites) { site in
            let locked = lastIn.count == 1 && lastIn[0] == site.id
            Toggle(isOn: Binding(get: { picked.contains(site.id) }, set: { _ in toggle(site.id) })) {
              VStack(alignment: .leading, spacing: 2) {
                Text(site.name)
                if locked {
                  Text("At least one site has to stay in.").font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
                }
              }
            }
            .disabled(readOnly || locked)
            .accessibilityIdentifier("sharing-site-\(site.id)")
          }
        }
        // Sites on this choice the member cannot name stay on it, and are counted.
        let unnamed = picked.filter { !siteIDs.contains($0) }.count
        if unnamed > 0 {
          Text(
            "Also \(excepting ? "left out" : "shared with"): \(unnamed == 1 ? "1 site" : "\(unnamed) sites") you don’t have access to."
          )
          .font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
        }
      }
      if let problem { AglynHelperText(problem, isError: true) }
    }
  }
}
