// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The calmer record screens' pieces (AGL-3945, the nav redesign's eight rules): one filled button, the next step for
// the record's state; every other act in the ⋯ menu; the summary first, and the rest folded below. Shared, so an
// order, a product, a contact and a page read the same, as the Kotlin apps' RecordHeader and FoldedSection do.

/// One act a record screen offers: its one filled button, or an item of its ⋯ menu.
public struct AglynRecordAction: Identifiable {
  public let id: String
  public let label: String
  public let systemImage: String
  public let destructive: Bool
  public let enabled: Bool
  /// Shown while the act is under way (the filled button turns into a spinner).
  public let busy: Bool
  public let run: @MainActor () -> Void

  public init(
    _ id: String, _ label: String, systemImage: String, destructive: Bool = false, enabled: Bool = true,
    busy: Bool = false, run: @escaping @MainActor () -> Void
  ) {
    self.id = id
    self.label = label
    self.systemImage = systemImage
    self.destructive = destructive
    self.enabled = enabled
    self.busy = busy
    self.run = run
  }
}

/// A record's head: its picture, title and status line, then the ⋯ menu with every other act and the one filled
/// button. Nothing else sits in the head. Beside the title where both fit, else on their own line beneath it.
public struct AglynRecordHeader: View {
  let title: String
  let subtitle: String?
  let imageURL: URL?
  let systemImage: String
  let status: (text: String, tone: AglynTone)?
  let primary: AglynRecordAction?
  let more: [AglynRecordAction]

  public init(
    _ title: String, subtitle: String? = nil, imageURL: URL? = nil, systemImage: String,
    status: (text: String, tone: AglynTone)? = nil, primary: AglynRecordAction? = nil, more: [AglynRecordAction] = []
  ) {
    self.title = title
    self.subtitle = subtitle
    self.imageURL = imageURL
    self.systemImage = systemImage
    self.status = status
    self.primary = primary
    self.more = more
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynDetailHeader(title, subtitle: subtitle, imageURL: imageURL, systemImage: systemImage, status: status)
      if primary != nil || !more.isEmpty {
        HStack(spacing: AglynSpace.one) {
          if let primary {
            Button(role: primary.destructive ? .destructive : nil) {
              primary.run()
            } label: {
              if primary.busy {
                ProgressView().controlSize(.small)
              } else {
                Label(primary.label, systemImage: primary.systemImage).lineLimit(1)
              }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!primary.enabled || primary.busy)
            .accessibilityIdentifier(primary.id)
          }
          if !more.isEmpty { AglynRecordMoreMenu(more) }
          Spacer(minLength: 0)
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("record-header")
  }
}

/// The ⋯ menu: every act but the filled one, the destructive ones last, below a divider.
public struct AglynRecordMoreMenu: View {
  let actions: [AglynRecordAction]

  public init(_ actions: [AglynRecordAction]) { self.actions = actions }

  public var body: some View {
    let plain = actions.filter { !$0.destructive }
    let destructive = actions.filter(\.destructive)
    Menu {
      ForEach(plain) { item(for: $0) }
      if !plain.isEmpty && !destructive.isEmpty { Divider() }
      ForEach(destructive) { item(for: $0) }
    } label: {
      Label("More actions", systemImage: "ellipsis")
        .labelStyle(.iconOnly)
        .frame(minWidth: 28, minHeight: 20)
    }
    .menuStyle(.button)
    .buttonStyle(.bordered)
    .fixedSize()
    .accessibilityIdentifier("record-more")
  }

  private func item(for action: AglynRecordAction) -> some View {
    Button(role: action.destructive ? .destructive : nil) {
      action.run()
    } label: {
      Label(action.label, systemImage: action.systemImage)
    }
    .disabled(!action.enabled || action.busy)
    .accessibilityIdentifier(action.id)
  }
}

/// A section that stays folded until opened (Payment and refunds, Customer details, Timeline and notes): its heading,
/// with a count when there is one, as a row that opens it.
public struct AglynFoldedSection<Content: View>: View {
  let title: String
  let count: Int?
  let identifier: String?
  let content: Content
  @State private var open: Bool

  public init(
    _ title: String, count: Int? = nil, initiallyOpen: Bool = false, identifier: String? = nil,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.count = count
    self.identifier = identifier
    self.content = content()
    _open = State(initialValue: initiallyOpen)
  }

  public var body: some View {
    Section {
      DisclosureGroup(isExpanded: $open) {
        content
      } label: {
        HStack {
          Text(title).font(AglynFont.strongSubheadline)
          Spacer(minLength: AglynSpace.one)
          if let count, count > 0 {
            Text("\(count)").font(AglynFont.caption).foregroundStyle(.secondary).monospacedDigit()
          }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(open ? "Open" : "Folded")
        .accessibilityIdentifier(identifier ?? "fold-\(title)")
      }
    }
  }
}
