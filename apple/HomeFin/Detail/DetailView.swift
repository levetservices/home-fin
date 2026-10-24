import HomeFinKit
import SwiftUI

/// A title's page: Netflix's More Info as a full screen.
struct DetailView: View {
    var itemId: String
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var item: Item?
    @State private var similar: [Item] = []
    @State private var seasons: [Item] = []
    @State private var season: Item?
    @State private var episodes: [Item] = []
    @State private var next: Item?
    @State private var error: String?
    @State private var appeared = false

    var body: some View {
        ScrollView {
            if let item {
                VStack(alignment: .leading, spacing: 18) {
                    header(item)
                    VStack(alignment: .leading, spacing: 16) {
                        info(item)
                        actions(item)
                        if let overview = item.overview { Text(overview).font(.system(size: 15)).foregroundStyle(Theme.text) }
                        credits(item)
                        if item.isSeries { episodeList }
                        if !similar.isEmpty { moreLikeThis }
                    }
                    .padding(.horizontal, Theme.gutter)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 12)
                }
                .padding(.bottom, 40)
            } else if let error {
                ContentUnavailableView("Couldn't load this title", systemImage: "exclamationmark.triangle", description: Text(error))
                    .padding(.top, 120)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 200)
            }
        }
        .ignoresSafeArea(edges: .top)
        .homeFinBackground()
        .foregroundStyle(.white)
        .inlineNavigationTitle()
        .transparentNavigationBar()
        .task(id: itemId) { await load() }
        .task(id: season?.id) { await loadEpisodes() }
    }

    // MARK: sections

    private func header(_ item: Item) -> some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(url: model.jellyfin?.backdropURL(item, maxWidth: compact ? 1080 : 1920))
                .frame(maxWidth: .infinity)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipped()
            LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom)
            if let logo = model.jellyfin?.logoURL(item) {
                Artwork(url: logo, contentMode: .fit)
                    .frame(maxWidth: compact ? 220 : 380, maxHeight: compact ? 70 : 120, alignment: .bottomLeading)
                    .padding(Theme.gutter)
            }
        }
    }

    private func info(_ item: Item) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.jellyfin?.logoURL(item) == nil {
                Text(item.name ?? "").font(.system(size: compact ? 26 : 34, weight: .heavy))
            }
            HStack(spacing: 10) {
                if let year = item.productionYear { Text(String(year)) }
                RatingBadge(rating: item.officialRating)
                if item.isSeries, let seasons = item.childCount {
                    Text(seasons == 1 ? "1 Season" : "\(seasons) Seasons")
                } else if let ticks = item.runTimeTicks {
                    Text(Self.runtime(ticks))
                }
                if let score = item.communityRating {
                    Label(String(format: "%.1f", score), systemImage: "star.fill").labelStyle(.titleAndIcon)
                }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.secondary)
        }
    }

    private func actions(_ item: Item) -> some View {
        let target = item.isSeries ? next : item
        let resuming = (target?.resumeSeconds ?? 0) > 0
        return VStack(alignment: .leading, spacing: 14) {
            Button { if let target { model.play(target) } } label: {
                Label(resuming ? "Resume" : "Play", systemImage: "play.fill")
                    .frame(maxWidth: compact ? .infinity : 220)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(target == nil)
            if item.isSeries, let next, let code = next.episodeCode {
                Text("\(code) \(next.name ?? "")").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.secondary)
            }
            if let target, let progress = target.progress, resuming {
                HStack(spacing: 10) {
                    ProgressBar(value: progress).frame(width: 160)
                    Text("\(Self.runtime(Int64(Double(target.runTimeTicks ?? 0) * (1 - progress)))) left")
                        .font(.caption).foregroundStyle(Theme.secondary)
                }
            }
            HStack(spacing: 34) {
                CircleAction(title: "My List", symbol: item.userData?.isFavorite == true ? "checkmark" : "plus") { toggleList() }
                CircleAction(title: "Like", symbol: item.userData?.likes == true ? "hand.thumbsup.fill" : "hand.thumbsup") { rate(true) }
                CircleAction(title: "Not for me", symbol: item.userData?.likes == false ? "hand.thumbsdown.fill" : "hand.thumbsdown") { rate(false) }
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder private func credits(_ item: Item) -> some View {
        let cast = (item.people ?? []).filter { $0.type == "Actor" }.prefix(5).map(\.name)
        let directors = (item.people ?? []).filter { $0.type == "Director" }.prefix(2).map(\.name)
        VStack(alignment: .leading, spacing: 4) {
            if !cast.isEmpty { creditLine("Starring", cast.joined(separator: ", ")) }
            if !directors.isEmpty { creditLine("Director", directors.joined(separator: ", ")) }
            if let genres = item.genres, !genres.isEmpty { creditLine("Genres", genres.joined(separator: ", ")) }
        }
    }

    private func creditLine(_ label: String, _ value: String) -> some View {
        (Text("\(label): ").foregroundStyle(Color(white: 0.47)) + Text(value).foregroundStyle(Theme.secondary))
            .font(.system(size: 13))
    }

    private var episodeList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Episodes").font(.system(size: 20, weight: .bold))
                Spacer()
                if seasons.count > 1 {
                    Menu {
                        ForEach(seasons) { candidate in
                            Button(candidate.name ?? "Season") { withAnimation(Theme.spring) { season = candidate } }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(season?.name ?? "Season")
                            Image(systemName: "chevron.down").font(.caption)
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.raised))
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                } else if let name = season?.name {
                    Text(name).foregroundStyle(Theme.secondary)
                }
            }
            ForEach(episodes) { episode in
                EpisodeRow(episode: episode) { model.play(episode) }
                    .transition(.opacity)
            }
        }
        .padding(.top, 8)
    }

    private var moreLikeThis: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("More Like This").font(.system(size: 20, weight: .bold))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 10)], spacing: 12) {
                ForEach(similar) { other in
                    NavigationLink(value: other) { PosterCard(item: other, width: compact ? 104 : 150) }
                        .buttonStyle(CardButtonStyle())
                }
            }
        }
        .padding(.top, 8)
    }

    // MARK: data

    private func load() async {
        guard let jellyfin = model.jellyfin else { return }
        do {
            let loaded = try await jellyfin.item(itemId)
            withAnimation(.easeOut(duration: 0.3)) { item = loaded }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.9).delay(0.05)) { appeared = true }
            async let similarItems = jellyfin.similar(to: itemId, limit: 12)
            if loaded.isSeries {
                async let seasonList = jellyfin.seasons(seriesId: itemId)
                async let upNext = jellyfin.episodeToPlay(seriesId: itemId)
                seasons = (try? await seasonList) ?? []
                next = try? await upNext
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
        let next = !(current.userData?.isFavorite ?? false)
        if current.userData == nil { current.userData = UserItemData() }
        current.userData?.isFavorite = next
        withAnimation(Theme.spring) { item = current }
        Task {
            try? await model.jellyfin?.setFavourite(current.id, next)
            model.homeRevision += 1
        }
    }

    private func rate(_ like: Bool) {
        guard var current = item else { return }
        // Tapping the same thumb again clears it.
        let value: Bool? = current.userData?.likes == like ? nil : like
        if current.userData == nil { current.userData = UserItemData() }
        current.userData?.likes = value
        withAnimation(Theme.spring) { item = current }
        Task {
            try? await model.jellyfin?.setRating(current.id, likes: value)
            model.homeRevision += 1
        }
    }

    static func runtime(_ ticks: Int64) -> String {
        let minutes = Int(Double(ticks) / ticksPerSecond / 60)
        if minutes < 60 { return "\(max(1, minutes))m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }
}

/// A round outlined button with a caption: My List, Like, Not for me.
struct CircleAction: View {
    var title: String
    var symbol: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 20))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 30, height: 30)
                Text(title).font(.system(size: 11)).foregroundStyle(Theme.secondary)
            }
        }
        .buttonStyle(CardButtonStyle())
    }
}

/// An episode: still with progress, number and title, runtime and synopsis. Tap to play.
struct EpisodeRow: View {
    var episode: Item
    var play: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        Button(action: play) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    ZStack(alignment: .bottom) {
                        Artwork(url: model.jellyfin?.landscapeURL(episode, maxWidth: 400, preferEpisodeStill: true))
                            .frame(width: 136, height: 77)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        Image(systemName: "play.circle").font(.system(size: 26, weight: .light)).padding(.bottom, 22)
                        if let progress = episode.progress { ProgressBar(value: progress).padding(.horizontal, 4).padding(.bottom, 3) }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(episode.indexNumber.map { "\($0). " } ?? "")\(episode.name ?? "")")
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(2)
                        if let ticks = episode.runTimeTicks {
                            Text(DetailView.runtime(ticks)).font(.caption).foregroundStyle(Theme.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if episode.userData?.played == true {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.secondary)
                    }
                }
                if let overview = episode.overview {
                    Text(overview).font(.system(size: 13)).foregroundStyle(Theme.secondary).lineLimit(3).multilineTextAlignment(.leading)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
