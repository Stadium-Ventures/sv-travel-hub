import { useMemo } from 'react'
import { useRosterStore } from '../../../store/rosterStore'
import { useScheduleStore } from '../../../store/scheduleStore'
import { resolveMLBTeamId, resolveNcaaName } from '../../../data/aliases'

export interface VenuePlayer {
  name: string
  tier: number
  level: string
}

// Build a mapping from venue key → player names at that venue
export function useVenuePlayerMap() {
  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)

  return useMemo(() => {
    const map = new Map<string, VenuePlayer[]>()

    function add(key: string, name: string, tier: number, level: string) {
      const existing = map.get(key)
      const entry = { name, tier, level }
      if (existing) {
        if (!existing.some((e) => e.name === name)) existing.push(entry)
      } else {
        map.set(key, [entry])
      }
    }

    // ST venues: key = "st-{teamId}" → Pro players via parent org
    for (const p of players) {
      if (p.level !== 'Pro') continue
      const orgId = resolveMLBTeamId(p.org)
      if (!orgId) continue
      add(`st-${orgId}`, p.playerName, p.tier, 'Pro')
    }

    // NCAA venues: key = "ncaa-{school lowercase}" → NCAA players via canonical name
    for (const p of players) {
      if (p.level !== 'NCAA') continue
      const canonical = resolveNcaaName(p.org)
      if (!canonical) continue
      add(`ncaa-${canonical.toLowerCase()}`, p.playerName, p.tier, 'NCAA')
    }

    // HS venues: key = "hs-{school|state}" → HS players by org+state
    for (const p of players) {
      if (p.level !== 'HS') continue
      const key = `hs-${p.org.toLowerCase().trim()}|${p.state.toLowerCase().trim()}`
      add(key, p.playerName, p.tier, 'HS')
    }

    // Pro venues from schedule: key = "pro-{venue-name}" → players from game data
    const proVenuePlayers = new Map<string, Set<string>>()
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      const existing = proVenuePlayers.get(key)
      if (existing) {
        for (const name of game.playerNames) existing.add(name)
      } else {
        proVenuePlayers.set(key, new Set(game.playerNames))
      }
    }
    for (const [key, names] of proVenuePlayers) {
      for (const name of names) {
        const player = players.find((p) => p.playerName === name)
        add(key, name, player?.tier ?? 4, 'Pro')
      }
    }

    return map
  }, [players, proGames])
}
