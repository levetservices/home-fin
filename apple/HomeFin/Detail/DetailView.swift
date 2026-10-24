import HomeFinKit
import SwiftUI

/// A title's page, as Netflix shows it: a sheet with the artwork on top, Play and Download, the
/// action row, then Episodes / More Like This.
struct DetailView: View {
    var item: Item
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TitlePage(itemId: item.id, close: { dismiss() })
                .navigationDestination(for: Item.self) { other in
                    TitlePage(itemId: other.isEpisode ? (other.seriesId ?? other.id) : other.id, close: { dismiss() })
                }
        }
        .tint(.white)
    }
}

/// One title's content (pushed again for More Like This).
struct TitlePage: View {
    var itemId: String
    var close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @Environment(\.dismiss) private var pop
    @State private var item: Item?
    @State private var similar: [Item] = []
    @State private var seasons: [Item] = []
    @State private var season: Item?
    @State private var episodes: [Item] = []
    @State private var next: Item?
    @State private var tab = Section.episodes
    @State private var showRating = false
    @State private var castExpanded = false
    @State private var error: String?
    @Namespace private var tabs

    enum Section: String, CaseIterable { case episodes = "Episodes", moreLikeThis = "More Like This" }

    var body: some View {
        ScrollView {
            if let item {
                VStack(alignment: .leading, spacing: 0) {
                    header(item)
                    VStack(alignment: .leading, spacing: 14) {
                        info(item)
                        buttons(item)
                        if let overview = item.overview {
                            Text(overview).font(.system(size: 15)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                        }
                        credits(item)
                        actionRow(item)
                        sections(item)
                    }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.top, 14)
                    .frame(maxWidth: 900, alignment: .leading)
                }
                .padding(.bottom, 40)
                .transition(.opacity)
            } else if let error {
                ContentUnavailableView("Couldn't load this title", systemImage: "exclamationmark.triangle", description: Text(error))
                    .padding(.top, 140)
            } else {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity).padding(.top, 240)
            }
        }
        .scrollIndicators(.hidden)
        .ignoresSafeArea(edges: .top)
        .background(Color.black)
        .foregroundStyle(.white)
        .hideNavigationBar()
        .task(id: itemId) { await load() }
        .task(id: season?.id) { await loadEpisodes() }
    }

    // MARK: header

    private func header(_ item: Item) -> some View {
        ZStack(alignment: .topTrailing) {
            Artwork(url: model.jellyfin?.backdropURL(item, maxWidth: compact ? 1200 : 1920))
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 70)
                }
                .overlay(alignment: .bottomLeading) {
                    if let logo = model.jellyfin?.logoURL(item) {
                        Artwork(url: logo, contentMode: .fit)
                            .frame(maxWidth: compact ? 200 : 320, maxHeight: compact ? 60 : 100, alignment: .bottomLeading)
                            .shadow(color: .black.opacity(0.6), radius: 8)
                            .padding(Theme.gutter)
                    }
                }
                .clipped()
            GlassGroup(spacing: 10) {
                HStack(spacing: 10) {
                    if canGoBack {
                        GlassCircleButton(systemImage: "chevron.left", size: 40, clear: true, label: "Back") { pop() }
                        Spacer()
                    }
                    RoutePickerButton()
                        .frame(width: 40, height: 40)
                        .clearGlass(in: Circle())
                    GlassCircleButton(systemImage: "xmark", size: 40, clear: true, label: "Close", action: close)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
        }
    }

    /// Pushed from More Like This (rather than the first page of the sheet).
    private var canGoBack: Bool { itemId != model.detail?.id }

    private func info(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.name ?? "").font(.system(size: compact ? 24 : 30, weight: .bold))
            HStack(spacing: 10) {
                if let year = item.productionYear { Text(String(year)) }
                RatingBadge(rating: item.officialRating)
                if item.isSeries {
                    Text(item.childCount == 1 ? (item.status == "Ended" ? "Limited Series" : "1 Season") : "\(item.childCount ?? 0) Seasons")
                } else if item.runTimeTicks != nil {
                    Text(item.runtimeSeconds.runtimeText)
                }
                QualityBadges(badges: item.badges)
            }
            .font(.system(size: 15))
            .foregroundStyle(Theme.secondary)
        }
    }

    private func buttons(_ item: Item) -> some View {
        let target = item.isSeries ? next : item
        let resuming = (target?.resumeSeconds ?? 0) > 0
        return VStack(alignment: .leading, spacing: 10) {
            Button { if let target { model.play(target) } } label: {
                Label(resuming ? "Resume" : "Play", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(height: 48))
            .disabled(target == nil)
            if item.isSeries, let next, let code = next.episodeCode {
                Text("\(code) \(next.name ?? "")").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.secondary)
            }
            if let target, let progress = target.progress, resuming {
                HStack(spacing: 10) {
                    ProgressBar(value: progress).frame(maxWidth: 200)
                    Text("\((target.runtimeSeconds * (1 - progress)).runtimeText) left").font(.caption).foregroundStyle(Theme.secondary)
                }
            }
            if let target, !item.isSeries || next != nil {
                DownloadButton(item: target, style: .wide)
            }
        }
        .frame(maxWidth: compact ? .infinity : 420)
    }

    @ViewBuilder private func credits(_ item: Item) -> some View {
        let cast = (item.people ?? []).filter { $0.type == "Actor" }.map(\.name)
        let makers = (item.people ?? []).filter { $0.type == "Director" || $0.type == "Creator" }
        VStack(alignment: .leading, spacing: 4) {
            if !cast.isEmpty {
                Button { withAnimation(Theme.spring) { castExpanded.toggle() } } label: {
                    let shown = castExpanded ? cast : Array(cast.prefix(3))
                    Text("Cast: \(shown.joined(separator: ", "))\(cast.count > 3 && !castExpanded ? " … more" : "")")
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
            if let maker = makers.first {
                Text("\(maker.type == "Creator" || item.isSeries ? "Creator" : "Director"): \(makers.prefix(2).map(\.name).joined(separator: ", "))")
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Theme.secondary)
    }

    private func actionRow(_ item: Item) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ActionButton(title: "My List", symbol: item.userData?.isFavorite == true ? "checkmark" : "plus") { toggleList() }
            ActionButton(title: "Rate", symbol: ratingSymbol(item)) { withAnimation(Theme.spring) { showRating.toggle() } }
                .overlay(alignment: .top) {
                    if showRating {
                        RatingPicker(current: item.userData?.likes) { rate($0) }
                            .offset(y: -64)
                            .transition(.scale(scale: 0.6, anchor: .bottom).combined(with: .opacity))
                    }
                }
                .zIndex(1)
            ShareLink(item: model.jellyfin?.webURL(for: item) ?? URL(string: "https://jellyfin.org")!,
                      subject: Text(item.name ?? ""), message: Text("Watch \(item.name ?? "this") on Home Fin")) {
                ActionLabel(title: "Share", symbol: "paperplane")
            }
            .buttonStyle(PressScaleStyle())
            .frame(maxWidth: .infinity)
            if item.isSeries, !episodes.isEmpty {
                SeasonDownloadButton(episodes: episodes)
            }
        }
        .padding(.top, 6)
    }

    private func ratingSymbol(_ item: Item) -> String {
        switch item.userData?.likes {
        case true: return "hand.thumbsup.fill"
        case false: return "hand.thumbsdown.fill"
        default: return "hand.thumbsup"
        }
    }

    @ViewBuilder private func sections(_ item: Item) -> some View {
        let available = item.isSeries ? Section.allCases : [.moreLikeThis]
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 26) {
                ForEach(available, id: \.self) { section in
                    Button {
                        withAnimation(Theme.spring) { tab = section }
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            ZStack {
                                if currentTab(item) == section {
                                    Rectangle().fill(Theme.brand).frame(height: 4).matchedGeometryEffect(id: "tab", in: tabs)
                                } else {
                                    Color.clear.frame(height: 4)
                                }
                            }
                            Text(section.rawValue)
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(currentTab(item) == section ? .white : Theme.secondary)
                        }
                        .fixedSize()
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 14)

            if currentTab(item) == .episodes {
                episodeList(item).transition(.opacity)
            } else {
                moreLikeThis.transition(.opacity)
            }
        }
    }

    private func currentTab(_ item: Item) -> Section {
        item.isSeries ? tab : .moreLikeThis
    }

    private func episodeList(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                if seasons.count > 1 {
                    Menu {
                        ForEach(seasons) { candidate in
                            Button(candidate.name ?? "Season") { withAnimation(Theme.spring) { season = candidate } }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Text(season?.name ?? "Season")
                            Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold))
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .padding(.horizontal, 16)
                        .frame(height: 38)
                        .glass(in: Capsule(), interactive: true)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                } else {
                    Text(item.childCount == 1 && item.status == "Ended" ? "Limited Series" : (season?.name ?? ""))
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.secondary)
                }
                Spacer()
            }
            ForEach(episodes) { episode in
                EpisodeRow(episode: episode)
                    .transition(.opacity)
            }
        }
    }

    private var moreLikeThis: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 104 : 140), spacing: 8)], spacing: 10) {
            ForEach(similar) { other in
                NavigationLink(value: other) { PosterCard(item: other, width: nil) }
                    .buttonStyle(CardButtonStyle())
            }
        }
    }

    // MARK: data

    private func load() async {
        guard let jellyfin = model.jellyfin else { return }
        do {
            let loaded = try await jellyfin.item(itemId)
            withAnimation(.easeOut(duration: 0.3)) { item = loaded }
            async let similarItems = jellyfin.similar(to: itemId, limit: 18)
            if loaded.isSeries {
                async let seasonList = jellyfin.seasons(seriesId: itemId)
                async let upNext = jellyfin.episodeToPlay(seriesId: itemId)
                seasons = (try? await seasonList) ?? []
                let nextEpisode = try? await upNext
                // Full details (media streams) so the Download button knows what it's fetching.
                next = await nextEpisode.asyncMap { (try? await jellyfin.item($0.id)) ?? $0 }
                season = seasons.first { $0.id == next?.seasonId } ?? seasons.first
            }
            similar = (try? await similarItems) ?? []
        } catch {
            model.handle(error)
            self.error = error.localizedDescription
        }
    }

    private func loadEpisodes() async {
        guard let season, let jellyfin = model.jellyfin else { return }
        let list = (try? await jellyfin.episodes(seriesId: itemId, seasonId: season.id)) ?? []
        withAnimation(.easeOut(duration: 0.25)) { episodes = list }
    }

    private func toggleList() {
        guard var current = item else { return }
        let listed = !(current.userData?.isFavorite ?? false)
        if current.userData == nil { current.userData = UserItemData() }
        current.userData?.isFavorite = listed
        withAnimation(Theme.spring) { item = current }
        Task {
            try? await model.jellyfin?.setFavourite(current.id, listed)
            model.homeRevision += 1
        }
    }

    private func rate(_ likes: Bool?) {
        guard var current = item else { return }
        if current.userData == nil { current.userData = UserItemData() }
        current.userData?.likes = likes
        withAnimation(Theme.spring) {
            item = current
            showRating = false
        }
        Task {
            try? await model.jellyfin?.setRating(current.id, likes: likes)
            model.homeRevision += 1
        }
    }
}

extension Optional {
    fileprivate func asyncMap<T>(_ transform: (Wrapped) async -> T) async -> T? {
        guard let value = self else { return nil }
        return await transform(value)
    }
}

/// A round-iconed action under the buttons: My List, Rate, Share, Download.
struct ActionButton: View {
    var title: String
    var symbol: String
    var action: () -> Void

    var body: some View {
        Button(action: action) { ActionLabel(title: title, symbol: symbol) }
            .buttonStyle(PressScaleStyle())
            .frame(maxWidth: .infinity)
    }
}

struct ActionLabel: View {
    var title: String
    var symbol: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .regular))
                .contentTransition(.symbolEffect(.replace))
                .frame(height: 28)
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

/// Netflix's rating bubble: thumbs down / up on a glass capsule above Rate.
struct RatingPicker: View {
    var current: Bool?
    var pick: (Bool?) -> Void

    var body: some View {
        GlassGroup(spacing: 6) {
            HStack(spacing: 6) {
                thumb("hand.thumbsdown", filled: current == false, label: "Not for me") { pick(current == false ? nil : false) }
                thumb("hand.thumbsup", filled: current == true, label: "I like this") { pick(current == true ? nil : true) }
            }
            .padding(6)
            .glass(in: Capsule())
        }
    }

    private func thumb(_ symbol: String, filled: Bool, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: filled ? symbol + ".fill" : symbol)
                .font(.system(size: 20))
                .frame(width: 46, height: 46)
                .background(Circle().fill(filled ? Color.white.opacity(0.22) : .clear))
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label)
    }
}

/// An episode: still with a play circle and progress, number, title, runtime, Download; then the
/// synopsis. Tapping the still plays it.
struct EpisodeRow: View {
    var episode: Item
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Button { model.play(episode) } label: {
                    Artwork(url: model.jellyfin?.landscapeURL(episode, maxWidth: 400, preferEpisodeStill: true))
                        .frame(width: 130, height: 73)
                        .overlay { PlayCircle(size: 32) }
                        .overlay(alignment: .bottom) {
                            if let progress = episode.progress { ProgressBar(value: progress).padding(.horizontal, 5).padding(.bottom, 4) }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(CardButtonStyle())
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(episode.indexNumber.map { "\($0). " } ?? "")\(episode.name ?? "")")
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(2)
                    if episode.runTimeTicks != nil {
                        Text(episode.runtimeSeconds.runtimeText).font(.system(size: 13)).foregroundStyle(Theme.secondary)
                    }
                }
                Spacer(minLength: 0)
                DownloadButton(item: episode, style: .icon)
            }
            if let overview = episode.overview {
                Text(overview).font(.system(size: 14)).foregroundStyle(Theme.secondary).lineLimit(4)
            }
        }
    }
}
