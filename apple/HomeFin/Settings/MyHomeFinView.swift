import HomeFinKit
import SwiftUI

/// Netflix's "My Netflix": the profile in the header (tap for Profiles & settings), Downloads,
/// Continue Watching, what you've liked and My List.
struct MyHomeFinView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var continuing: [Item] = []
    @State private var liked: [Item] = []
    @State private var myList: [Item] = []
    @State private var scrolled = false
    @State private var showProfiles: Bool = {
        #if DEBUG
        return DemoMode.isOn && ["profilesSheet", "settings"].contains(DemoMode.screen)
        #else
        return false
        #endif
    }()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    NavigationLink(value: Destination.downloads) { downloadsCard }
                        .buttonStyle(PressScaleStyle())
                        .padding(.horizontal, Theme.gutter)
                    if !continuing.isEmpty {
                        row("Continue Watching") {
                            ForEach(continuing) { ContinueCard(item: $0) }
                        }
                    }
                    if !liked.isEmpty {
                        row("Series & Films You've Liked") {
                            ForEach(liked) { LikedCard(item: $0) }
                        }
                    }
                    if !myList.isEmpty {
                        row("My List", seeAll: true) {
                            ForEach(myList) { ShowCard(item: $0) }
                        }
                    }
                    if continuing.isEmpty && liked.isEmpty && myList.isEmpty {
                        Text("Titles you add to My List, rate or start watching will show up here.")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.secondary)
                            .padding(.horizontal, Theme.gutter)
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .trackScrolled($scrolled)
            .pinnedHeader(scrolled: scrolled) {
                TabHeader {
                    Button { showProfiles = true } label: {
                        HStack(spacing: 10) {
                            AvatarView(preset: model.avatar(for: model.currentProfile), name: model.viewerName, size: 34)
                            Text(model.viewerName).font(.system(size: 28, weight: .bold)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 15, weight: .bold))
                        }
                    }
                    .buttonStyle(PressScaleStyle())
                    .accessibilityHint("Profiles and settings")
                }
            }
            .homeFinBackground()
            .hideNavigationBar()
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .downloads: DownloadsView(showsClose: false)
                case .myList: MyListView()
                }
            }
            .task(id: model.homeRevision) { await load() }
            .sheet(isPresented: $showProfiles) {
                ProfilesSheet()
                    .environment(model)
                    .presentationBackground(Color(hex: "#1c1c1c"))
                    .presentationCornerRadius(28)
            }
        }
    }

    enum Destination: Hashable { case downloads, myList }

    private var downloadsCard: some View {
        let count = model.downloads.records(for: model.userId).count
        return HStack(spacing: 18) {
            Image(systemName: "arrow.down.to.line")
                .font(.system(size: 24, weight: .medium))
                .frame(width: 40)
            VStack(alignment: .leading, spacing: 4) {
                Text("Downloads").font(.system(size: 18, weight: .semibold))
                Text(count == 0 ? "Series and films that you download appear here." : "\(count) download\(count == 1 ? "" : "s") on this device")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.secondary)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 17, weight: .semibold))
        }
        .foregroundStyle(.white)
        .padding(18)
        .glass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func row<Content: View>(_ title: String, seeAll: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.system(size: 19, weight: .bold))
                Spacer()
                if seeAll {
                    NavigationLink(value: Destination.myList) {
                        HStack(spacing: 4) {
                            Text("See All")
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                        }
                        .font(.system(size: 16))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Theme.gutter)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 8) { content() }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func load() async {
        guard let jellyfin = model.jellyfin else { return }
        async let resume = jellyfin.resume()
        async let likes = jellyfin.liked()
        async let favourites = jellyfin.favourites()
        let loaded = (try? await resume) ?? []
        let likedItems = (try? await likes) ?? []
        let listed = (try? await favourites) ?? []
        withAnimation(.easeOut(duration: 0.3)) {
            continuing = loaded
            liked = likedItems
            myList = listed
        }
    }
}

/// A liked title with Share underneath, as on My Netflix.
struct LikedCard: View {
    var item: Item
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            Button { model.show(item) } label: {
                PosterCard(item: item, width: 112, showsRibbon: false)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: Theme.cardRadius, topTrailingRadius: Theme.cardRadius))
            }
            .buttonStyle(CardButtonStyle())
            ShareLink(item: model.jellyfin?.webURL(for: item) ?? URL(string: "https://jellyfin.org")!,
                      message: Text("Watch \(item.name ?? "this") on Home Fin")) {
                Label("Share", systemImage: "paperplane")
                    .labelStyle(TightLabelStyle())
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 112, height: 40)
            }
            .buttonStyle(.plain)
            .background(Theme.surface)
            .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: Theme.cardRadius, bottomTrailingRadius: Theme.cardRadius))
        }
    }
}

/// My List, all of it.
struct MyListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isCompactLayout) private var compact
    @State private var items: [Item] = []
    @State private var scrolled = false

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 8)], spacing: 10) {
                ForEach(items) { item in
                    Button { model.show(item) } label: { PosterCard(item: item, width: nil) }
                        .buttonStyle(CardButtonStyle())
                        .contextMenu { TitleMenu(item: item) }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 40)
        }
        .trackScrolled($scrolled)
        .pinnedHeader(scrolled: scrolled) {
            HStack(spacing: 12) {
                GlassCircleButton(systemImage: "chevron.left", size: 40, label: "Back") { dismiss() }
                Text("My List").font(.system(size: 24, weight: .bold))
                Spacer()
            }
            .padding(.horizontal, Theme.gutter)
            .frame(height: 56)
        }
        .homeFinBackground()
        .hideNavigationBar()
        .task(id: model.homeRevision) {
            items = (try? await model.jellyfin?.favourites(limit: 200)) ?? []
        }
    }
}
