/*
This file contains the code for the Discover Artist feature:
- Get recommended new artists based on your top 5 listening genres (you select one)
- You choose how many artists to see at once
*/

"use client"
import { useSession } from "next-auth/react"
import { useEffect, useState } from "react"
import Image from "next/image"

// Define basic data structure for Artist object (returned by Spotify)
interface Artist {
  id: string
  name: string
  images: { url: string }[]
  genres: string[]
  popularity: number
}

// Extends Artist object with extra discovery info
interface DiscoveryArtist extends Artist {
  reason: string
  relatedTo?: string
}

// Session object from NextAuth with access token used to authenticate Spotify API requests
interface SpotifySession {
  token: {
    access_token: string
  }
}

// Raw Artist item (structure returned by search/top artists function in Spotify)
interface SpotifyArtistItem {
  id: string
  name: string
  images: { url: string }[]
  genres: string[]
  popularity: number
}

// Fisher-Yates shuffle, used to pick a random sample of matched artists without repeats
function shuffleArray<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/*
Main component for the ArtistDiscovery feature
- Fetches top 25 artists, extracts top 5 genres from these artists
- Lets users select one of these top 5 genres and how many artists to see
- Displays new artists whose own genre tags actually match the selected genre
*/
export default function ArtistDiscovery() {
  // Get spotify access token from Session
  const { data: session, status } = useSession() as {
    data: SpotifySession | null
    status: string
  }
  // Component state
  const [loading, setLoading] = useState(false) // tracks if app is currently fetching new artists
  const [initialLoading, setInitialLoading] = useState(true) // tracks if app is still loading
  const [error, setError] = useState<string | null>(null) // stores auth/session-level error message
  const [genreError, setGenreError] = useState<string | null>(null) // stores genre-search-specific error message
  const [noExactMatches, setNoExactMatches] = useState(false) // true when the strict genre search came up empty
  const [discoveredArtists, setDiscoveredArtists] = useState<DiscoveryArtist[]>([]) // most recently discovered artists
  const [userTopGenres, setUserTopGenres] = useState<string[]>([]) // array of user's top genres
  const [userTopArtists, setUserTopArtists] = useState<Artist[]>([]) // array of user's top artists
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null) // genre user selects to discover new artists in
  const [artistCount, setArtistCount] = useState(5) // how many artists to recommend at once (1-10)

  // What to do based on the authentication status
  useEffect(() => {
    // Reset state when session changes
    if (status === "unauthenticated") {
      setDiscoveredArtists([])
      setUserTopGenres([])
      setUserTopArtists([])
      setSelectedGenre(null)
      setInitialLoading(false)
      setError(null)
      setGenreError(null)
      setNoExactMatches(false)
      return
    }

    // Fetch user's top artists and their genres
    const fetchUserTopArtists = async () => {
      // Check if there is a valid access token
      if (!session?.token?.access_token) {
        setError("No session token available")
        setInitialLoading(false)
        return
      }

      try {
        setError(null) // Reset any previous errors
        // Get top artists
        const response = await fetch(
          "https://api.spotify.com/v1/me/top/artists?limit=25&time_range=medium_term",
          {
            headers: {
              Authorization: `Bearer ${session.token.access_token}`,
            },
          }
        )

        // Error handling and error messages
        if (!response.ok) {
          if (response.status === 429) {
            setError(
              "Please wait a moment - we're getting your data too quickly. Try again in a few seconds."
            )
            setInitialLoading(false)
            return
          } else if (response.status === 401) {
            setError(
              "Your session has expired. Please sign out and sign in again."
            )
            setInitialLoading(false)
            return
          }
          throw new Error(`Failed to fetch top artists: ${response.status}`)
        }

        const data = await response.json()

        // More error work: if Spotify returns an error object as a response
        if (data.error) {
          setError(
            `Spotify is temporarily unavailable. Please try again in a moment.`
          )
          setInitialLoading(false)
          return
        }

        // More error work: no data returned (or not enough listening data collected for the user)
        if (!data.items || data.items.length === 0) {
          setError("No top artists found")
          setInitialLoading(false)
          return
        }

        // Get complete artist details including genres with rate limiting protection
        const artistsWithDetails = await Promise.all(
          data.items.map(async (artist: SpotifyArtistItem) => {
            try {
              const artistResponse = await fetch(
                `https://api.spotify.com/v1/artists/${artist.id}`,
                {
                  headers: {
                    Authorization: `Bearer ${session.token.access_token}`,
                  },
                }
              )
              if (!artistResponse.ok) {
                if (artistResponse.status === 429) {
                  console.warn(
                    `Rate limited for artist ${artist.name}, skipping...`
                  )
                  return null
                }
                console.warn(
                  `Failed to fetch details for artist ${artist.name}`
                )
                return null
              }
              return await artistResponse.json()
            } catch (error) {
              console.warn(
                `Failed to fetch details for artist ${artist.name}:`,
                error
              )
              return null
            }
          })
        )

        // Filter out null values from rate-limited or failed requests
        const validArtists = artistsWithDetails.filter(
          (artist) => artist !== null
        )

        if (validArtists.length === 0) {
          setError(
            "Please wait a moment - we're getting your data too quickly. Try again in a few seconds."
          )
          setInitialLoading(false)
          return
        }

        setUserTopArtists(validArtists) // Save top artists to state

        // Extract and count genres
        const genreMap = new Map<string, number>()
        validArtists.forEach((artist: Artist) => {
          artist.genres.forEach((genre) => {
            genreMap.set(genre, (genreMap.get(genre) || 0) + 1)
          })
        })

        // Get top 5 genres
        const topGenres = Array.from(genreMap.entries())
          .sort((a, b) => b[1] - a[1]) // Sort by frequency
          .slice(0, 5) // Take top 5
          .map(([genre]) => genre) // Extract genre names from top 5

        setUserTopGenres(topGenres) // Save to state
        setError(null)
      } catch (error) {
        console.error("Error fetching top artists:", error)
        setError(
          error instanceof Error ? error.message : "Failed to fetch top artists"
        )
      } finally {
        setInitialLoading(false) // Mark loading as done
      }
    }

    if (status === "authenticated" && session?.token?.access_token) {
      fetchUserTopArtists()
    }
  }, [session, status])

  // Get up to `artistCount` new artists from the selected genre.
  // `loose` controls whether a genre must match exactly (default) or just partially overlap.
  const getArtistsFromGenre = async (genre: string, loose: boolean = false) => {
    // Check if there is a valid access token
    if (!session?.token?.access_token) {
      setError("No session token available")
      return
    }

    try {
      setLoading(true)
      setError(null)
      setGenreError(null)
      setSelectedGenre(genre)
      if (!loose) setNoExactMatches(false)

      // Search for artists in the selected genre, building a query
      const searchUrl = new URL("https://api.spotify.com/v1/search")
      searchUrl.searchParams.append("q", `genre:"${genre}"`)
      searchUrl.searchParams.append("type", "artist")
      searchUrl.searchParams.append("limit", "50") // max 50 results
      searchUrl.searchParams.append("market", "US") // in the US market

      const response = await fetch(searchUrl.toString(), {
        headers: {
          Authorization: `Bearer ${session.token.access_token}`,
          "Content-Type": "application/json",
        },
      })

      // Error handling
      if (!response.ok) {
        if (response.status === 429) {
          setError(
            "Please wait a moment - we're getting your data too quickly. Try again in a few seconds."
          )
          setLoading(false)
          return
        } else if (response.status === 401) {
          setError(
            "Your session has expired. Please sign out and sign in again."
          )
          setLoading(false)
          return
        }
        const errorText = await response.text()
        console.error("Search API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          url: searchUrl.toString(),
        })
        setError(`Failed to search for artists in genre ${genre}`)
        setLoading(false)
        return
      }

      const data = await response.json()

      if (data.error) {
        setError(
          `Spotify is temporarily unavailable. Please try again in a moment.`
        )
        setLoading(false)
        return
      }

      if (
        !data.artists ||
        !data.artists.items ||
        data.artists.items.length === 0
      ) {
        setGenreError(`No artists found in genre "${genre}"`)
        setDiscoveredArtists([])
        setLoading(false)
        return
      }

      // Exclude artists already in the user's top artists
      const candidates = (data.artists.items as SpotifyArtistItem[]).filter(
        (artist) =>
          artist && artist.id && !userTopArtists.some((top) => top.id === artist.id)
      )

      // Spotify's `genre:` search filter is a loose relevance search, not an exact tag
      // match, so we verify each candidate's own genre list actually contains the
      // selected genre before recommending it (this is what previously let unrelated
      // artists, e.g. Indian pop artists for a "k-pop" search, slip through).
      const targetGenre = genre.toLowerCase()
      const matches = candidates.filter((artist) =>
        loose
          ? artist.genres.some(
              (g) =>
                g.toLowerCase().includes(targetGenre) ||
                targetGenre.includes(g.toLowerCase())
            )
          : artist.genres.some((g) => g.toLowerCase() === targetGenre)
      )

      if (matches.length === 0) {
        setNoExactMatches(!loose)
        setGenreError(
          loose
            ? `No artists found even with a broader match for "${genre}".`
            : `No artists are tagged exactly with "${genre}". Spotify's genre tags can be inconsistent for this genre.`
        )
        setDiscoveredArtists([])
        setLoading(false)
        return
      }

      // Pick a random, non-repeating sample of the matched artists
      const picked = shuffleArray(matches).slice(0, artistCount)

      const results: DiscoveryArtist[] = picked.map((artist) => {
        const commonGenres = artist.genres.filter((g) =>
          userTopGenres.includes(g)
        )
        return {
          ...artist,
          reason: loose
            ? `Broad match for "${genre}" (tagged: ${
                artist.genres.slice(0, 3).join(", ") || "no listed genres"
              })`
            : commonGenres.length > 0
            ? `Shares genres with your favorites: ${commonGenres.join(", ")}`
            : `Tagged with your selected genre: ${genre}`,
        }
      })

      setDiscoveredArtists(results)
      setGenreError(null)
      setNoExactMatches(false)
    } catch (error) {
      console.error("Error in getArtistsFromGenre:", error)
      setError(
        error instanceof Error ? error.message : "Failed to fetch artists"
      )
    } finally {
      setLoading(false)
    }
  }

  // Handles retries by clearing errors and triggering the fetching
  const handleRetry = () => {
    setError(null)
    setInitialLoading(true)
    // The useEffect will handle the actual fetching by reacting to the setInitialLoading state
  }

  // Display loading state
  if (status === "loading" || initialLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Artist Discovery</h2>
        <div className="text-white">Loading your top artists...</div>
      </div>
    )
  }

  // Display prompt for user to sign in if not signed in
  if (status === "unauthenticated") {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Artist Discovery</h2>
        <div className="text-white">Please sign in to discover new artists</div>
      </div>
    )
  }

  // Show error message and retry button if the initial/auth-level request fails
  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Artist Discovery</h2>
        <div className="text-red-400 mb-4">{error}</div>
        <button
          onClick={handleRetry}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // The main interface for Artist Discovery display and genre selection
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-2xl font-bold text-white mb-4">Artist Discovery</h2>

      { /* Genre selection menu */ }
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white mb-3">
          Select a Genre
        </h3>
        <div className="flex items-center gap-4 flex-wrap">
          <select
            value={selectedGenre || ""}
            onChange={(e) => setSelectedGenre(e.target.value)}
            className="bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            disabled={loading}
          >
            <option value="">Choose a genre...</option>
            {userTopGenres.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-white text-sm">
            How many?
            <input
              type="number"
              min={1}
              max={10}
              value={artistCount}
              onChange={(e) =>
                setArtistCount(
                  Math.min(10, Math.max(1, Number(e.target.value) || 1))
                )
              }
              disabled={loading}
              className="w-16 bg-gray-700 text-white px-2 py-2 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </label>

          <button
            onClick={() =>
              selectedGenre && getArtistsFromGenre(selectedGenre)
            }
            disabled={loading || !selectedGenre}
            className={`px-6 py-2 bg-green-500 text-white rounded-lg transition-colors ${
              loading || !selectedGenre
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-green-600"
            }`}
          >
            {loading ? "Finding..." : "Discover New Artists"}
          </button>
        </div>
      </div>

      { /* Genre-search-specific error, with a fallback to broader matching */ }
      {genreError && (
        <div className="bg-gray-700 rounded-lg p-4 mb-4">
          <p className="text-red-300 mb-3">{genreError}</p>
          {noExactMatches && selectedGenre && (
            <button
              onClick={() => getArtistsFromGenre(selectedGenre, true)}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              Try broader matches
            </button>
          )}
        </div>
      )}

      { /* If loading, show loading message, otherwise display new artists */ }
      {loading ? (
        <div className="text-white">Finding new artists...</div>
      ) : discoveredArtists.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {discoveredArtists.map((artist) => (
            <div key={artist.id} className="bg-gray-700 rounded-lg p-6">
              <div className="flex items-center space-x-4">
                {artist.images?.[0] && (
                  <Image
                    src={artist.images[0].url}
                    alt={artist.name}
                    width={96}
                    height={96}
                    className="rounded-lg"
                  />
                )}
                <div>
                  <h3 className="text-xl font-semibold text-white">
                    {artist.name}
                  </h3>
                  <p className="text-gray-300 mt-2 text-sm">{artist.reason}</p>
                  {artist.genres.length > 0 && (
                    <p className="text-gray-400 text-sm mt-2">
                      Genres: {artist.genres.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !genreError ? (
        <p className="text-gray-300">
          Select a genre and click &quot;Discover New Artists&quot; to find new
          music!
        </p>
      ) : null}
    </div>
  )
}
