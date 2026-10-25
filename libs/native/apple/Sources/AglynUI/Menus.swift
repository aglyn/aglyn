// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A menu drawn as a popover's content (Figma Menus 2:4, Mac / Popover / Account 16:142): sizes for the Mac's compact
/// menu and the iPad's touch one. An `NSMenu` cannot hold a photo or an inline control, so a menu that needs them is
/// drawn with these parts instead.
public enum AglynMenuMetrics {
  #if os(macOS)
    /// The menu's width and the padding inside its edge.
    public static let width: CGFloat = 300
    public static let padding: CGFloat = 6
    /// A row (Figma Menu/Row): height, inner padding, the gap after its icon, text and icon sizes, hover radius.
    public static let rowHeight: CGFloat = 30
    public static let rowPadding: CGFloat = 10
    public static let rowGap: CGFloat = 10
    public static let rowText: CGFloat = 13
    public static let rowIcon: CGFloat = 16
    public static let rowRadius: CGFloat = 6
    /// A row naming a person (Menu/Account row): height, photo, the address under the name.
    public static let personRowHeight: CGFloat = 40
    public static let personPhoto: CGFloat = 24
    public static let detailText: CGFloat = 12
    /// A section's caption ("Accounts", Menu/Section title): its text and the space around it.
    public static let captionText: CGFloat = 12
    public static let captionPadding = EdgeInsets(top: 8, leading: 10, bottom: 4, trailing: 10)
    /// A divider's space above and below its hairline (Menu/Divider).
    public static let dividerGap: CGFloat = 4
    /// The profile header (Menu/Header, Kind=Profile 310:1885): padding, photo, name, gap between photo and words.
    public static let headerPadding: CGFloat = 12
    public static let headerPhoto: CGFloat = 56
    public static let headerName: CGFloat = 15
    public static let headerGap: CGFloat = 12
    /// A small secondary button (Edit profile): its height and side padding.
    public static let smallButtonHeight: CGFloat = 28
    public static let smallButtonPadding: CGFloat = 10
    /// The inline segmented picker (Menu/Appearance 310:2015): one segment, its icon, the track's inset.
    public static let segment = CGSize(width: 30, height: 22)
    public static let segmentIcon: CGFloat = 12
    public static let segmentInset: CGFloat = 2
    public static let segmentRadius: CGFloat = 4
    public static let inlineControlRowHeight: CGFloat = 32
  #else
    public static let width: CGFloat = 340
    public static let padding: CGFloat = 8
    public static let rowHeight: CGFloat = 40
    public static let rowPadding: CGFloat = 12
    public static let rowGap: CGFloat = 12
    public static let rowText: CGFloat = 15
    public static let rowIcon: CGFloat = 18
    public static let rowRadius: CGFloat = 8
    public static let personRowHeight: CGFloat = 50
    public static let personPhoto: CGFloat = 30
    public static let detailText: CGFloat = 13
    public static let captionText: CGFloat = 13
    public static let captionPadding = EdgeInsets(top: 10, leading: 12, bottom: 4, trailing: 12)
    public static let dividerGap: CGFloat = 6
    public static let headerPadding: CGFloat = 14
    public static let headerPhoto: CGFloat = 64
    public static let headerName: CGFloat = 17
    public static let headerGap: CGFloat = 14
    public static let smallButtonHeight: CGFloat = 32
    public static let smallButtonPadding: CGFloat = 12
    public static let segment = CGSize(width: 38, height: 28)
    public static let segmentIcon: CGFloat = 14
    public static let segmentInset: CGFloat = 2
    public static let segmentRadius: CGFloat = 6
    public static let inlineControlRowHeight: CGFloat = 40
  #endif
}

/// One row of a drawn menu (Figma Menu/Row): a line icon, its label, an optional value at the trailing edge, the hover
/// ground under the pointer. `role: .destructive` draws it in the error color.
public struct AglynMenuRow<Trailing: View>: View {
  let title: String
  let systemImage: String?
  let role: ButtonRole?
  let action: () -> Void
  let trailing: Trailing

  public init(
    _ title: String, systemImage: String? = nil, role: ButtonRole? = nil, action: @escaping () -> Void,
    @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.systemImage = systemImage
    self.role = role
    self.action = action
    self.trailing = trailing()
  }

  public var body: some View {
    let tint = role == .destructive ? AglynColor.error : AglynColor.textPrimary
    AglynMenuButton(height: AglynMenuMetrics.rowHeight, action: action) {
      if let systemImage {
        Image(systemName: systemImage).font(.system(size: AglynMenuMetrics.rowText))
          .foregroundStyle(tint)
          .frame(width: AglynMenuMetrics.rowIcon, height: AglynMenuMetrics.rowIcon)
          .accessibilityHidden(true)
      }
      Text(title).font(.system(size: AglynMenuMetrics.rowText)).foregroundStyle(tint).lineLimit(1)
      Spacer(minLength: 0)
      trailing
    }
  }
}

/// A row's value at its trailing edge ("Xylophone"), in the secondary text color.
public struct AglynMenuValue: View {
  let text: String
  public init(_ text: String) { self.text = text }
  public var body: some View {
    Text(text).font(.system(size: AglynMenuMetrics.rowText)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
  }
}

/// A drawn menu's button: its content in the row's inset, the hover ground with the row's radius.
public struct AglynMenuButton<Content: View>: View {
  let height: CGFloat
  let action: () -> Void
  let content: Content
  @State private var hovered = false

  public init(height: CGFloat = AglynMenuMetrics.rowHeight, action: @escaping () -> Void, @ViewBuilder content: () -> Content) {
    self.height = height
    self.action = action
    self.content = content()
  }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: AglynMenuMetrics.rowGap) { content }
        .padding(.horizontal, AglynMenuMetrics.rowPadding)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .background(
          RoundedRectangle(cornerRadius: AglynMenuMetrics.rowRadius, style: .continuous)
            .fill(hovered ? AglynColor.hover : Color.clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
  }
}

/// A drawn menu's divider (Figma Menu/Divider): a hairline with space above and below.
public struct AglynMenuDivider: View {
  public init() {}
  public var body: some View {
    Rectangle().fill(AglynColor.divider).frame(height: 1)
      .padding(.vertical, AglynMenuMetrics.dividerGap)
      .accessibilityHidden(true)
  }
}

/// A drawn menu's section caption ("Accounts").
public struct AglynMenuCaption: View {
  let title: String
  public init(_ title: String) { self.title = title }
  public var body: some View {
    Text(title).font(.system(size: AglynMenuMetrics.captionText, weight: .semibold))
      .foregroundStyle(AglynColor.secondaryText)
      .padding(AglynMenuMetrics.captionPadding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

/// A row naming a person (Figma Menu/Account row): their photo, name and address, a check on the one in use.
public struct AglynMenuPersonRow: View {
  let name: String
  let detail: String?
  let initials: String
  let photoURL: URL?
  let current: Bool
  let action: () -> Void

  public init(
    name: String, detail: String?, initials: String, photoURL: URL?, current: Bool, action: @escaping () -> Void
  ) {
    self.name = name
    self.detail = detail
    self.initials = initials
    self.photoURL = photoURL
    self.current = current
    self.action = action
  }

  public var body: some View {
    AglynMenuButton(height: AglynMenuMetrics.personRowHeight, action: action) {
      AglynAccountAvatar(initials: initials, photoURL: photoURL, size: AglynMenuMetrics.personPhoto)
      VStack(alignment: .leading, spacing: 0) {
        Text(name).font(.system(size: AglynMenuMetrics.rowText, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary).lineLimit(1)
        if let detail {
          Text(detail).font(.system(size: AglynMenuMetrics.detailText))
            .foregroundStyle(AglynColor.secondaryText).lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      if current {
        Image(systemName: "checkmark").font(.system(size: AglynMenuMetrics.detailText, weight: .semibold))
          .foregroundStyle(AglynColor.tint)
          .frame(width: AglynMenuMetrics.rowIcon, height: AglynMenuMetrics.rowIcon)
          .accessibilityHidden(true)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(current ? .isSelected : [])
  }
}

/// The person at the top of their account menu (Figma Menu/Header, Kind=Profile 310:1885): their photo, name and
/// address, and Edit profile.
public struct AglynProfileHeader: View {
  let name: String
  let email: String?
  let initials: String
  let photoURL: URL?
  let editProfile: (() -> Void)?

  public init(name: String, email: String?, initials: String, photoURL: URL?, editProfile: (() -> Void)?) {
    self.name = name
    self.email = email
    self.initials = initials
    self.photoURL = photoURL
    self.editProfile = editProfile
  }

  public var body: some View {
    HStack(spacing: AglynMenuMetrics.headerGap) {
      AglynAccountAvatar(initials: initials, photoURL: photoURL, size: AglynMenuMetrics.headerPhoto)
      VStack(alignment: .leading, spacing: 2) {
        Text(name).font(.system(size: AglynMenuMetrics.headerName, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary).lineLimit(1)
        if let email, email != name {
          Text(email).font(.system(size: AglynMenuMetrics.detailText))
            .foregroundStyle(AglynColor.secondaryText).lineLimit(1)
        }
        if let editProfile {
          Button(action: editProfile) {
            Text("Edit profile").font(.system(size: AglynMenuMetrics.rowText, weight: .medium))
              .foregroundStyle(AglynColor.textPrimary)
              .padding(.horizontal, AglynMenuMetrics.smallButtonPadding)
              .frame(height: AglynMenuMetrics.smallButtonHeight)
              .background(
                RoundedRectangle(cornerRadius: AglynMenuMetrics.rowRadius, style: .continuous)
                  .strokeBorder(AglynColor.borderStrong))
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .padding(.top, AglynMenuMetrics.dividerGap + 2)
          .accessibilityIdentifier("account-edit-profile")
        }
      }
      Spacer(minLength: 0)
    }
    .padding(AglynMenuMetrics.headerPadding)
  }
}

/// One choice of an inline segmented picker: its icon and its name for assistive technology.
public struct AglynMenuSegment<Value: Hashable>: Identifiable {
  public let value: Value
  public let systemImage: String
  public let label: String
  public var id: Value { value }

  public init(_ value: Value, systemImage: String, label: String) {
    self.value = value
    self.systemImage = systemImage
    self.label = label
  }
}

/// A row with an inline segmented picker at its trailing edge (Figma Menu/Appearance 310:2015: Light, Dark, System).
public struct AglynMenuSegmentedRow<Value: Hashable>: View {
  let title: String
  let systemImage: String
  let segments: [AglynMenuSegment<Value>]
  @Binding var selection: Value

  public init(_ title: String, systemImage: String, segments: [AglynMenuSegment<Value>], selection: Binding<Value>) {
    self.title = title
    self.systemImage = systemImage
    self.segments = segments
    self._selection = selection
  }

  public var body: some View {
    HStack(spacing: AglynMenuMetrics.rowGap) {
      Image(systemName: systemImage).font(.system(size: AglynMenuMetrics.rowText))
        .foregroundStyle(AglynColor.textPrimary)
        .frame(width: AglynMenuMetrics.rowIcon, height: AglynMenuMetrics.rowIcon)
        .accessibilityHidden(true)
      Text(title).font(.system(size: AglynMenuMetrics.rowText)).foregroundStyle(AglynColor.textPrimary).lineLimit(1)
      Spacer(minLength: 0)
      HStack(spacing: AglynMenuMetrics.segmentInset) {
        ForEach(segments) { segment in
          let picked = segment.value == selection
          Button {
            selection = segment.value
          } label: {
            Image(systemName: segment.systemImage)
              .font(.system(size: AglynMenuMetrics.segmentIcon, weight: picked ? .semibold : .regular))
              .foregroundStyle(picked ? AglynColor.textPrimary : AglynColor.secondaryText)
              .frame(width: AglynMenuMetrics.segment.width, height: AglynMenuMetrics.segment.height)
              .background(
                RoundedRectangle(cornerRadius: AglynMenuMetrics.segmentRadius, style: .continuous)
                  .fill(picked ? AglynColor.paper : Color.clear)
                  .shadow(color: picked ? AglynColor.divider : .clear, radius: 1, y: 0.5))
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .help(segment.label)
          .accessibilityLabel(segment.label)
          .accessibilityAddTraits(picked ? .isSelected : [])
        }
      }
      .padding(AglynMenuMetrics.segmentInset)
      .background(
        RoundedRectangle(cornerRadius: AglynMenuMetrics.rowRadius, style: .continuous).fill(AglynColor.sunken))
    }
    .padding(.horizontal, AglynMenuMetrics.rowPadding)
    .frame(minHeight: AglynMenuMetrics.inlineControlRowHeight)
  }
}
