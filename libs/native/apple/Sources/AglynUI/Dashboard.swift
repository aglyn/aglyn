// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Spacing on the console's scale: multiples of its 8-point unit.
public enum AglynSpace {
  public static func of(_ steps: CGFloat) -> CGFloat { AglynTokens.spacing * steps }
  /// 4
  public static let half = of(0.5)
  /// 8
  public static let one = of(1)
  /// 12
  public static let oneAndHalf = of(1.5)
  /// 16
  public static let two = of(2)
  /// 24
  public static let three = of(3)
  /// 32
  public static let four = of(4)
}

/// Corner radii: the console's radius for small controls, and the card radius built on it.
public enum AglynRadius {
  public static let control = AglynTokens.radius * 2
  public static let card = AglynTokens.radius * 3
}

extension View {
  /// The kit's card surface: paper, a hairline in the divider color, the card radius.
  public func aglynCardSurface() -> some View {
    background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous).strokeBorder(AglynColor.divider)
      )
  }
}

/// An SF Symbol on a tinted rounded square: the kit's icon for tiles, cards and rows.
public struct IconBadge: View {
  let systemImage: String
  let tone: AglynTone
  let size: CGFloat
  let circle: Bool

  public init(_ systemImage: String, tone: AglynTone = .info, size: CGFloat = 32, circle: Bool = false) {
    self.systemImage = systemImage
    self.tone = tone
    self.size = size
    self.circle = circle
  }

  private var color: Color { tone == .neutral ? AglynColor.tint : tone.color }

  public var body: some View {
    Image(systemName: systemImage)
      .font(.system(size: size * 0.5, weight: .semibold))
      .foregroundStyle(color)
      .frame(width: size, height: size)
      .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: circle ? size / 2 : AglynRadius.control, style: .continuous))
      .accessibilityHidden(true)
  }
}

/// A section's title above its content, with an optional trailing action.
public struct AglynSectionHeader<Accessory: View>: View {
  let title: String
  let accessory: Accessory

  public init(_ title: String, @ViewBuilder accessory: () -> Accessory = { EmptyView() }) {
    self.title = title
    self.accessory = accessory()
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
      Spacer()
      accessory.font(AglynFont.subheadline)
    }
  }
}

/// A site at the top of a dashboard: its workspace, name and address, a
/// status chip, and the visit and switch actions.
public struct SiteHeaderCard: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  let workspace: String?
  let name: String
  let address: String?
  let status: (text: String, tone: AglynTone)?
  let detail: String?
  let loading: Bool
  let onVisit: (() -> Void)?
  let onSwitch: () -> Void

  public init(
    workspace: String?, name: String, address: String?, status: (text: String, tone: AglynTone)?,
    detail: String? = nil, loading: Bool = false, onVisit: (() -> Void)?, onSwitch: @escaping () -> Void
  ) {
    self.workspace = workspace
    self.name = name
    self.address = address
    self.status = status
    self.detail = detail
    self.loading = loading
    self.onVisit = onVisit
    self.onSwitch = onSwitch
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      HStack(alignment: .top, spacing: AglynSpace.two) {
        if !typeSize.isAccessibilitySize {
          IconBadge("globe", tone: .neutral, size: 52, circle: true)
        }
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          if typeSize.isAccessibilitySize, let status { StatusChip(status.text, tone: status.tone) }
          if let workspace {
            Text(workspace).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          Text(name).font(AglynFont.title).lineLimit(2)
          if let address, let url = URL(string: "https://\(address)/") {
            Link(address, destination: url).font(AglynFont.body)
          }
          if let detail {
            Text(detail).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
        }
        .redacted(reason: loading ? .placeholder : [])
        Spacer(minLength: 0)
        if !typeSize.isAccessibilitySize, let status { StatusChip(status.text, tone: status.tone) }
      }
      ViewThatFits(in: .horizontal) {
        HStack(spacing: AglynSpace.oneAndHalf) { buttons }
        VStack(alignment: .leading, spacing: AglynSpace.one) { buttons }
      }
    }
    .padding(AglynSpace.two)
    .aglynCardSurface()
  }

  @ViewBuilder
  private var buttons: some View {
    if let onVisit {
      Button(action: onVisit) {
        Label("Visit site", systemImage: "arrow.up.right.square")
          .foregroundStyle(AglynColor.primaryContrast)
      }
      .buttonStyle(.borderedProminent)
      .tint(AglynColor.primary)
      .controlSize(.large)
      .accessibilityIdentifier("home-visit-site")
    }
    Button(action: onSwitch) {
      Label("Switch site", systemImage: "arrow.left.arrow.right")
    }
    .buttonStyle(.bordered)
    .controlSize(.large)
    .help("Switch workspace or site (⌘K)")
    .accessibilityIdentifier("home-switcher")
  }
}

/// A quick action: an icon in a tinted circle above its label; the whole tile is the button.
public struct QuickActionTile: View {
  let title: String
  let systemImage: String
  let action: () -> Void

  public init(_ title: String, systemImage: String, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      VStack(spacing: AglynSpace.oneAndHalf) {
        IconBadge(systemImage, tone: .neutral, size: 40, circle: true)
        Text(title).font(AglynFont.strongSubheadline).foregroundStyle(.primary).lineLimit(2)
          .multilineTextAlignment(.center).minimumScaleFactor(0.85)
      }
      .frame(maxWidth: .infinity, minHeight: 88)
      .padding(.vertical, AglynSpace.oneAndHalf)
      .padding(.horizontal, AglynSpace.half)
      .aglynCardSurface()
      .contentShape(RoundedRectangle(cornerRadius: AglynRadius.card))
    }
    .buttonStyle(AglynPressableStyle())
    .accessibilityLabel(title)
  }
}

/// A dashboard metric: icon and title, a big figure, a caption. The whole
/// card is the button, and its chevron says so.
public struct MetricCard: View {
  let title: String
  let systemImage: String
  let tone: AglynTone
  let value: String?
  let caption: String
  let actionLabel: String?
  let failed: String?
  let action: (() -> Void)?

  /// `value` nil draws the loading placeholder; `failed` replaces the figure with why it could not be read.
  public init(
    _ title: String, systemImage: String, tone: AglynTone = .neutral, value: String?, caption: String,
    actionLabel: String? = nil, failed: String? = nil, action: (() -> Void)? = nil
  ) {
    self.title = title
    self.systemImage = systemImage
    self.tone = tone
    self.value = value
    self.caption = caption
    self.actionLabel = actionLabel
    self.failed = failed
    self.action = action
  }

  public var body: some View {
    Button {
      action?()
    } label: {
      VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
        HStack(alignment: .center) {
          IconBadge(systemImage, tone: tone, size: 40, circle: true)
          Spacer(minLength: AglynSpace.one)
          if action != nil {
            Image(systemName: "chevron.right").font(AglynFont.body.weight(.semibold)).foregroundStyle(.secondary)
              .accessibilityHidden(true)
          }
        }
        Text(title).font(AglynFont.strongSubheadline).foregroundStyle(.secondary)
        if let failed {
          Label(failed, systemImage: "exclamationmark.triangle").font(AglynFont.subheadline)
            .foregroundStyle(AglynColor.error)
        } else {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(value ?? "00").font(AglynFont.figure).foregroundStyle(.primary)
            Text(caption).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          .redacted(reason: value == nil ? .placeholder : [])
        }
      }
      .padding(AglynSpace.two)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .aglynCardSurface()
      .contentShape(RoundedRectangle(cornerRadius: AglynRadius.card))
    }
    .buttonStyle(AglynPressableStyle())
    .disabled(action == nil)
    .accessibilityElement(children: .combine)
    .accessibilityHint(actionLabel ?? "")
  }
}

/// One row of an activity list: a type icon, title, subtitle, relative time, and an unread dot.
public struct ActivityRow: View {
  let title: String
  let subtitle: String?
  let time: String?
  let systemImage: String
  let tone: AglynTone
  let unread: Bool

  public init(
    _ title: String, subtitle: String?, time: String?, systemImage: String, tone: AglynTone, unread: Bool
  ) {
    self.title = title
    self.subtitle = subtitle
    self.time = time
    self.systemImage = systemImage
    self.tone = tone
    self.unread = unread
  }

  public var body: some View {
    HStack(alignment: .top, spacing: AglynSpace.oneAndHalf) {
      IconBadge(systemImage, tone: tone, size: 36, circle: true)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: AglynSpace.one) {
          Text(title).font(unread ? AglynFont.body.weight(.semibold) : AglynFont.body)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let time { Text(time).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Circle().fill(unread ? AglynColor.tint : .clear).frame(width: 8, height: 8).padding(.top, 8)
        .accessibilityHidden(true)
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityValue(unread ? "Unread" : "")
  }
}

/// Adaptive columns that fill the row: as many as fit at `minimum` wide.
public struct AglynGrid<Content: View>: View {
  let minimum: CGFloat
  let content: Content

  public init(minimum: CGFloat = 150, @ViewBuilder content: () -> Content) {
    self.minimum = minimum
    self.content = content()
  }

  public var body: some View {
    LazyVGrid(
      columns: [GridItem(.adaptive(minimum: minimum), spacing: AglynSpace.oneAndHalf, alignment: .top)],
      spacing: AglynSpace.oneAndHalf
    ) {
      content
    }
  }
}

/// Dashboard cards in rows that always fill the width: as many columns as
/// fit at `minimum` (at most `maxColumns`), each row's cards sharing its
/// width, so a row with fewer cards (a lone card, a short last row) stretches
/// instead of leaving a gap. Cards in a row get the row's height. A card
/// marked `aglynGridFullWidth()` takes a row of its own. The Android kit's
/// `DashboardGrid` lays out the same way.
public struct AglynCardGrid: Layout {
  let minimum: CGFloat
  let maxColumns: Int
  let spacing: CGFloat

  public init(minimum: CGFloat = 160, maxColumns: Int = 3, spacing: CGFloat = AglynSpace.oneAndHalf) {
    self.minimum = minimum
    self.maxColumns = max(1, maxColumns)
    self.spacing = spacing
  }

  /// How many columns fit in `width`.
  public func columns(for width: CGFloat) -> Int {
    min(maxColumns, max(1, Int((width + spacing) / (minimum + spacing))))
  }

  /// The subview indices of each row.
  func rows(_ subviews: Subviews, columns: Int) -> [[Int]] {
    var rows: [[Int]] = []
    for index in subviews.indices {
      let full = subviews[index][AglynGridFullWidth.self]
      if full || columns == 1 || rows.isEmpty || rows[rows.count - 1].count >= columns
        || subviews[rows[rows.count - 1][0]][AglynGridFullWidth.self]
      {
        rows.append([index])
      } else {
        rows[rows.count - 1].append(index)
      }
    }
    return rows
  }

  private func measure(_ width: CGFloat, _ subviews: Subviews) -> [(items: [Int], itemWidth: CGFloat, height: CGFloat)] {
    rows(subviews, columns: columns(for: width)).map { row in
      let itemWidth = (width - spacing * CGFloat(row.count - 1)) / CGFloat(row.count)
      let height = row.map { subviews[$0].sizeThatFits(ProposedViewSize(width: itemWidth, height: nil)).height }.max() ?? 0
      return (row, itemWidth, height)
    }
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard !subviews.isEmpty else { return .zero }
    let width = proposal.width ?? (minimum * CGFloat(min(maxColumns, subviews.count)))
    let rows = measure(width, subviews)
    let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: width, height: height)
  }

  public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in measure(bounds.width, subviews) {
      var x = bounds.minX
      for index in row.items {
        subviews[index].place(
          at: CGPoint(x: x, y: y), anchor: .topLeading,
          proposal: ProposedViewSize(width: row.itemWidth, height: row.height))
        x += row.itemWidth + spacing
      }
      y += row.height + spacing
    }
  }
}

private struct AglynGridFullWidth: LayoutValueKey {
  static let defaultValue = false
}

extension View {
  /// In an `AglynCardGrid`, gives this card a row of its own.
  public func aglynGridFullWidth(_ full: Bool = true) -> some View {
    layoutValue(key: AglynGridFullWidth.self, value: full)
  }
}

/// A card holding rows separated by hairlines, for short lists on a dashboard.
public struct AglynListCard<Item: Identifiable, Row: View>: View {
  let items: [Item]
  let row: (Item) -> Row

  public init(_ items: [Item], @ViewBuilder row: @escaping (Item) -> Row) {
    self.items = items
    self.row = row
  }

  public var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
        row(item)
          .padding(.horizontal, AglynSpace.two)
          .padding(.vertical, AglynSpace.oneAndHalf)
        if index < items.count - 1 {
          Divider().padding(.leading, AglynSpace.two)
        }
      }
    }
    .aglynCardSurface()
  }
}

/// Presses dim and shrink a touch, with a selection haptic.
public struct AglynPressableStyle: ButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .opacity(configuration.isPressed ? 0.85 : 1)
      .animation(.snappy(duration: 0.15), value: configuration.isPressed)
      .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, pressed in pressed }
  }
}

extension View {
  /// A list on the console's page color, its rows on paper: the kit's list look in light and dark.
  public func aglynListBackground() -> some View {
    scrollContentBackground(.hidden).background(AglynColor.page)
  }

  /// A list row on the console's paper surface.
  public func aglynListRow() -> some View {
    listRowBackground(AglynColor.paper)
  }
}
