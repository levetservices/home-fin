import Foundation

// MARK: - Jellyfin

/// The parts of Jellyfin's BaseItemDto the app uses (films, series, seasons, episodes, libraries, people).
public struct Item: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String?
    public var type: String?
    public var overview: String?
    public var productionYear: Int?
    public var officialRating: String?
    public var communityRating: Double?
    public var runTimeTicks: Int64?
    public var genres: [String]?
    public var imageTags: [String: String]?
    public var backdropImageTags: [String]?
    public var parentBackdropItemId: String?
    public var parentBackdropImageTags: [String]?
    public var parentThumbItemId: String?
    public var parentThumbImageTag: String?
    public var parentLogoItemId: String?
    public var parentLogoImageTag: String?
    public var seriesId: String?
    public var seriesName: String?
    public var seriesPrimaryImageTag: String?
    public var seasonId: String?
    public var indexNumber: Int?
    public var parentIndexNumber: Int?
    public var childCount: Int?
    public var collectionType: String?
    public var status: String?
    public var dateCreated: String?
    public var premiereDate: String?
    public var userData: UserItemData?
    public var people: [Person]?
    public var mediaSources: [MediaSource]?

    enum CodingKeys: String, CodingKey {
        case id = "Id", name = "Name", type = "Type", overview = "Overview", productionYear = "ProductionYear"
        case officialRating = "OfficialRating", communityRating = "CommunityRating", runTimeTicks = "RunTimeTicks"
        case genres = "Genres", imageTags = "ImageTags", backdropImageTags = "BackdropImageTags"
        case parentBackdropItemId = "ParentBackdropItemId", parentBackdropImageTags = "ParentBackdropImageTags"
        case parentThumbItemId = "ParentThumbItemId", parentThumbImageTag = "ParentThumbImageTag"
        case parentLogoItemId = "ParentLogoItemId", parentLogoImageTag = "ParentLogoImageTag"
        case seriesId = "SeriesId", seriesName = "SeriesName", seriesPrimaryImageTag = "SeriesPrimaryImageTag", seasonId = "SeasonId"
        case indexNumber = "IndexNumber", parentIndexNumber = "ParentIndexNumber", childCount = "ChildCount"
        case collectionType = "CollectionType", status = "Status", dateCreated = "DateCreated"
        case premiereDate = "PremiereDate", userData = "UserData", people = "People", mediaSources = "MediaSources"
    }

    public init(id: String, name: String? = nil, type: String? = nil) {
        self.id = id
        self.name = name
        self.type = type
    }

    public var isSeries: Bool { type == "Series" }
    public var isEpisode: Bool { type == "Episode" }
    public var isMovie: Bool { type == "Movie" }

    /// Where playback should pick up, in seconds (0 when unwatched or finished).
    public var resumeSeconds: Double {
        guard let ticks = userData?.playbackPositionTicks, ticks > 0, userData?.played != true else { return 0 }
        return Double(ticks) / ticksPerSecond
    }

    /// 0…1 progress for the red bar under Continue Watching cards.
    public var progress: Double? {
        if let percent = userData?.playedPercentage, percent > 0, percent < 100 { return percent / 100 }
        guard let ticks = userData?.playbackPositionTicks, let total = runTimeTicks, total > 0, ticks > 0 else { return nil }
        return min(1, Double(ticks) / Double(total))
    }

    /// "S2:E4" for episodes.
    public var episodeCode: String? {
        guard isEpisode, let season = parentIndexNumber, let episode = indexNumber else { return nil }
        return "S\(season):E\(episode)"
    }
}

public let ticksPerSecond: Double = 10_000_000

public struct UserItemData: Codable, Hashable, Sendable {
    public var playbackPositionTicks: Int64?
    public var playedPercentage: Double?
    public var played: Bool?
    public var isFavorite: Bool?
    public var likes: Bool?
    public var unplayedItemCount: Int?
    public var lastPlayedDate: String?

    public init(playbackPositionTicks: Int64? = nil, playedPercentage: Double? = nil, played: Bool? = nil,
                isFavorite: Bool? = nil, likes: Bool? = nil, unplayedItemCount: Int? = nil, lastPlayedDate: String? = nil) {
        self.playbackPositionTicks = playbackPositionTicks
        self.playedPercentage = playedPercentage
        self.played = played
        self.isFavorite = isFavorite
        self.likes = likes
        self.unplayedItemCount = unplayedItemCount
        self.lastPlayedDate = lastPlayedDate
    }

    enum CodingKeys: String, CodingKey {
        case playbackPositionTicks = "PlaybackPositionTicks", playedPercentage = "PlayedPercentage", played = "Played"
        case isFavorite = "IsFavorite", likes = "Likes", unplayedItemCount = "UnplayedItemCount", lastPlayedDate = "LastPlayedDate"
    }
}

public struct Person: Codable, Hashable, Sendable {
    public var id: String?
    public var name: String
    public var role: String?
    public var type: String?

    enum CodingKeys: String, CodingKey {
        case id = "Id", name = "Name", role = "Role", type = "Type"
    }
}

public struct MediaSource: Codable, Hashable, Sendable {
    public var id: String?
    public var container: String?
    public var supportsDirectPlay: Bool?
    public var supportsDirectStream: Bool?
    public var supportsTranscoding: Bool?
    public var transcodingUrl: String?
    public var mediaStreams: [MediaStream]?

    enum CodingKeys: String, CodingKey {
        case id = "Id", container = "Container", supportsDirectPlay = "SupportsDirectPlay"
        case supportsDirectStream = "SupportsDirectStream", supportsTranscoding = "SupportsTranscoding"
        case transcodingUrl = "TranscodingUrl", mediaStreams = "MediaStreams"
    }
}

public struct MediaStream: Codable, Hashable, Sendable {
    public var type: String?
    public var codec: String?
    public var language: String?
    public var displayTitle: String?
    public var index: Int?
    public var height: Int?

    enum CodingKeys: String, CodingKey {
        case type = "Type", codec = "Codec", language = "Language", displayTitle = "DisplayTitle", index = "Index", height = "Height"
    }
}

public struct ItemsResult: Codable, Sendable {
    public var items: [Item]
    public var totalRecordCount: Int?

    enum CodingKeys: String, CodingKey {
        case items = "Items", totalRecordCount = "TotalRecordCount"
    }
}

public struct JellyfinUser: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var primaryImageTag: String?
    public var policy: Policy?

    public struct Policy: Codable, Hashable, Sendable {
        public var isAdministrator: Bool?
        enum CodingKeys: String, CodingKey { case isAdministrator = "IsAdministrator" }
    }

    enum CodingKeys: String, CodingKey {
        case id = "Id", name = "Name", primaryImageTag = "PrimaryImageTag", policy = "Policy"
    }

    public var isAdministrator: Bool { policy?.isAdministrator == true }
}

public struct AuthenticationResult: Codable, Sendable {
    public var accessToken: String
    public var user: JellyfinUser
    public var serverId: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "AccessToken", user = "User", serverId = "ServerId"
    }
}

public struct PublicSystemInfo: Codable, Sendable {
    public var serverName: String?
    public var version: String?
    public var id: String?

    enum CodingKeys: String, CodingKey {
        case serverName = "ServerName", version = "Version", id = "Id"
    }
}

public struct PlaybackInfoResponse: Codable, Sendable {
    public var mediaSources: [MediaSource]
    public var playSessionId: String?

    enum CodingKeys: String, CodingKey {
        case mediaSources = "MediaSources", playSessionId = "PlaySessionId"
    }
}

// MARK: - Home Fin accounts service (camelCase JSON)

public struct HomeFinAccount: Codable, Hashable, Sendable {
    public var id: Int
    public var email: String
    public var name: String
    public var isAdmin: Bool
    public var disabled: Bool
    public var requestPolicy: String?
}

public struct HomeFinProfile: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var name: String
    public var avatar: String
    public var maturity: String
    public var locked: Bool
    public var jellyfinUserId: String
    public var position: Int?

    public init(id: Int, name: String, avatar: String, maturity: String, locked: Bool, jellyfinUserId: String, position: Int? = nil) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.maturity = maturity
        self.locked = locked
        self.jellyfinUserId = jellyfinUserId
        self.position = position
    }

    public var isKids: Bool { maturity == "kids" }
}

public struct HomeFinMe: Codable, Sendable {
    public var account: HomeFinAccount
    public var profiles: [HomeFinProfile]
}

/// A preset avatar: an emoji on a two-colour gradient.
public struct AvatarPreset: Codable, Hashable, Sendable {
    public var key: String
    public var emoji: String
    public var from: String
    public var to: String
}

public struct HomeFinConfig: Codable, Sendable {
    public var enabled: Bool
    public var serverName: String?
    public var allowInvites: Bool?
}

public struct Trending: Codable, Sendable {
    public struct Entry: Codable, Hashable, Sendable {
        public var id: String
        public var viewers: Int
        public var plays: Int
    }
    public var days: Int
    public var series: [Entry]
    public var movies: [Entry]
}

public struct RequestsConfig: Codable, Sendable {
    public var enabled: Bool
    public var movies: Bool
    public var tv: Bool
    public var policy: String
    public var isAdmin: Bool
}

/// A film or show from Radarr / Sonarr's search.
public struct MediaResult: Codable, Hashable, Identifiable, Sendable {
    public var type: String
    public var id: Int
    public var title: String
    public var year: Int?
    public var overview: String
    public var poster: String?
    public var backdrop: String?
    public var genres: [String]
    public var runtime: Int?
    public var network: String?
    public var rating: String?
    public var seasons: [Int]?
    public var state: String?
    public var progress: Int?

    public var key: String { "\(type)-\(id)" }

    public init(type: String, id: Int, title: String, year: Int? = nil, overview: String = "", poster: String? = nil,
                backdrop: String? = nil, genres: [String] = [], runtime: Int? = nil, network: String? = nil,
                rating: String? = nil, seasons: [Int]? = nil, state: String? = nil, progress: Int? = nil) {
        self.type = type
        self.id = id
        self.title = title
        self.year = year
        self.overview = overview
        self.poster = poster
        self.backdrop = backdrop
        self.genres = genres
        self.runtime = runtime
        self.network = network
        self.rating = rating
        self.seasons = seasons
        self.state = state
        self.progress = progress
    }
}

public struct MediaRequest: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var type: String
    public var mediaId: Int
    public var title: String
    public var year: Int?
    public var poster: String?
    public var seasons: [Int]?
    public var status: String
    public var state: String?
    public var progress: Int?
    public var requestedBy: String
    public var decidedBy: String?
    public var reason: String?
    public var createdAt: String
}

public struct RequestLists: Codable, Sendable {
    public var mine: [MediaRequest]
    public var household: [MediaRequest]
}

public struct RequestQueue: Codable, Sendable {
    public var pending: [MediaRequest]
    public var failed: [MediaRequest]
    public var recent: [MediaRequest]
}
