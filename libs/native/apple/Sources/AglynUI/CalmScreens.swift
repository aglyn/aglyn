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
  @Environment(\.aglynWideChrome) private var wide
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
    if wide { column } else { touch }
  }

  /// The Mac and iPad detail column's head (Figma Orders 13:483): the title at 22 bold with its status pill under it,
  /// the ⋯ and the one filled button at the right, then the subtitle as the record's line under the head. A picture
  /// leads only when the record has one; a symbol tile adds nothing a detail column needs.
  private var column: some View {
    VStack(alignment: .leading, spacing: 20) {
      // Title and actions on one line where they fit; a narrow column (iPad in portrait) puts the actions under the
      // title rather than cutting the primary's label short.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .center, spacing: 10) {
          titleBlock
          Spacer(minLength: 8)
          columnActions
        }
        VStack(alignment: .leading, spacing: 12) {
          titleBlock
          HStack(spacing: 10) { columnActions }
        }
      }
      if let subtitle, !subtitle.isEmpty {
        Text(subtitle).font(.system(size: 14)).foregroundStyle(AglynColor.secondaryText).lineLimit(2)
          .textSelection(.enabled)
      }
    }
    // 20 under the crumbs (Figma 13:483: crumbs at 24, the head at 60).
    .padding(.top, 20)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("record-header")
  }

  private var titleBlock: some View {
    HStack(alignment: .center, spacing: 10) {
      if let imageURL { AglynDetailTile(imageURL: imageURL, systemImage: systemImage, size: 54) }
      VStack(alignment: .leading, spacing: 6) {
        Text(title).font(.system(size: 22, weight: .bold)).foregroundStyle(AglynColor.textPrimary).lineLimit(2)
          .accessibilityAddTraits(.isHeader)
          .textSelection(.enabled)
        if let status { StatusChip(status.text, tone: status.tone) }
      }
    }
  }

  @ViewBuilder
  private var columnActions: some View {
    if !more.isEmpty { AglynRecordMoreMenu(more, square: true) }
    if let primary {
      Button(role: primary.destructive ? .destructive : nil) {
        primary.run()
      } label: {
        if primary.busy {
          ProgressView().controlSize(.small).frame(minWidth: 36, minHeight: 36)
        } else {
          AglynPrimaryHeaderButton.face(primary.label, systemImage: primary.systemImage).fixedSize()
        }
      }
      .buttonStyle(.plain)
      .opacity(primary.enabled ? 1 : 0.5)
      .disabled(!primary.enabled || primary.busy)
      .accessibilityIdentifier(primary.id)
    }
  }

  private var touch: some View {
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
                // The icon is drawn in the button's own text color: a list row would tint it the accent, the button's fill.
                Label {
                  Text(primary.label).lineLimit(1)
                } icon: {
                  Image(systemName: primary.systemImage).foregroundStyle(AglynColor.primaryContrast)
                }
                .frame(minHeight: 24)
              }
            }
            .buttonStyle(.aglynProminent)
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
  /// The detail column's 36-point square ⋯ (Figma 13:483) rather than the system's bordered button.
  let square: Bool

  public init(_ actions: [AglynRecordAction], square: Bool = false) {
    self.actions = actions
    self.square = square
  }

  public var body: some View {
    let plain = actions.filter { !$0.destructive }
    let destructive = actions.filter(\.destructive)
    Menu {
      ForEach(plain) { item(for: $0) }
      if !plain.isEmpty && !destructive.isEmpty { Divider() }
      ForEach(destructive) { item(for: $0) }
    } label: {
      if square {
        Label("More actions", systemImage: "ellipsis")
          .labelStyle(.iconOnly)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .frame(width: 36, height: 36)
          .background(
            RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.paper))
          .overlay(
            RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
              .strokeBorder(AglynColor.borderStrong))
          .contentShape(Rectangle())
      } else {
        Label("More actions", systemImage: "ellipsis")
          .labelStyle(.iconOnly)
          .frame(minWidth: 28, minHeight: 24)
      }
    }
    .menuStyle(.button)
    .modifier(RecordMoreButtonStyle(square: square))
    .menuIndicator(.hidden)
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

/// A section that stays folded until opened (Customer details, Shipments, Timeline and notes): its heading,
/// with a count when there is one, as a row that opens it.
public struct AglynFoldedSection<Content: View>: View {
  @Environment(\.aglynPlainRecord) private var plain
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
    if plain { plainBody } else { groupedBody }
  }

  /// The Mac and iPad detail column's fold (Figma Section/Folded): a 49-point row under a hairline, its chevron at the
  /// content's edge with the title after it (a plain list would hang a disclosure triangle in the gutter).
  @ViewBuilder
  private var plainBody: some View {
    Section {
      Button {
        withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
      } label: {
        HStack(spacing: 12) {
          Image(systemName: "chevron.right")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(AglynColor.secondaryText)
            .rotationEffect(.degrees(open ? 90 : 0))
            .frame(width: 16)
          Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(AglynColor.textPrimary)
          Spacer(minLength: AglynSpace.one)
          if let count, count > 0 {
            Text("\(count)").font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).monospacedDigit()
          }
        }
        .frame(minHeight: 49)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .overlay(alignment: .top) { AglynHairline() }
      .accessibilityElement(children: .combine)
      .accessibilityValue(open ? "Open" : "Folded")
      .accessibilityIdentifier(identifier ?? "fold-\(title)")
      if open { content }
    }
  }

  private var groupedBody: some View {
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

private struct RecordMoreButtonStyle: ViewModifier {
  let square: Bool

  func body(content: Content) -> some View {
    if square { content.buttonStyle(.plain) } else { content.buttonStyle(.aglynSecondary) }
  }
}

/// A record's sections. On a phone a grouped Form; on the Mac and iPad Figma's plain detail column (Orders 13:483):
/// the sections on the surface, 40 points from the column's edges, no boxes, prominent section titles, and hairlines
/// only where a row draws one (a total, a folded section).
public struct AglynRecordForm<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  let content: Content

  public init(@ViewBuilder content: () -> Content) { self.content = content() }

  public var body: some View {
    if wide {
      List {
        content
          .listRowSeparator(.hidden)
          // On the column's content edges, as every column's (`AglynContentInsets`).
          .listRowInsets(AglynContentInsets.listRow())
          .listRowBackground(Color.clear)
      }
      .listStyle(.plain)
      .headerProminence(.increased)
      .scrollContentBackground(.hidden)
      .background(AglynColor.paper)
      .environment(\.defaultMinListRowHeight, 40)
      .environment(\.aglynPlainRecord, true)
    } else {
      Form { content }
        .formStyle(.grouped)
        .aglynListBackground()
    }
  }
}

/// The detail column's hairline (Figma border/subtle, 1 point), drawn by the row that owns it.
public struct AglynHairline: View {
  public init() {}

  public var body: some View {
    Rectangle().fill(AglynColor.divider).frame(height: 1).accessibilityHidden(true)
  }
}

/// A plain detail column's section title (Figma 13:483: 17 semibold in the primary text color).
public struct AglynRecordSectionTitle: View {
  @Environment(\.aglynPlainRecord) private var plain
  let title: String

  public init(_ title: String) { self.title = title }

  public var body: some View {
    if plain {
      // A row, not the section's header, so it lines up with the rows under it.
      Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(AglynColor.textPrimary).textCase(nil)
        .padding(.top, 20)
        .accessibilityAddTraits(.isHeader)
    } else {
      Text(title)
    }
  }
}

extension EnvironmentValues {
  /// Inside an `AglynRecordForm`'s plain detail column (Mac and iPad).
  @Entry public var aglynPlainRecord: Bool = false
}
