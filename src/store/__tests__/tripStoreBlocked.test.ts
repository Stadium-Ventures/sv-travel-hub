import { describe, it, expect, beforeEach, vi } from 'vitest'

// Review 2026-10-16, item 7: with a priority player set and no Trip origin,
// Generate said "Pick a Trip origin (or add a priority player)" even when
// the real cause was unloaded schedules or no game in the date range.

const rosterState = { players: [] as Array<Record<string, unknown>> }
const scheduleState = { proGames: [] as unknown[], ncaaGames: [] as unknown[], hsGames: [] as unknown[] }
vi.mock('../rosterStore', () => ({ useRosterStore: { getState: () => rosterState } }))
vi.mock('../scheduleStore', () => ({ useScheduleStore: { getState: () => scheduleState } }))
vi.mock('../venueStore', () => ({ useVenueStore: { getState: () => ({}) } }))
vi.mock('../heartbeatStore', () => ({ useHeartbeatStore: { getState: () => ({}) } }))
vi.mock('../summerStore', () => ({ useSummerStore: { getState: () => ({ summerGames: [] }) } }))

const { useTripStore } = await import('../tripStore')

// Synthetic data only.
const PRO = { playerName: 'Test Pro', level: 'Pro' }
function game(date: string, playerNames: string[]) {
  return { date, playerNames, venue: { name: 'Test Park', coords: { lat: 30, lng: -90 } } }
}

beforeEach(() => {
  rosterState.players = [PRO]
  scheduleState.proGames = []
  scheduleState.ncaaGames = []
  scheduleState.hsGames = []
  useTripStore.setState({
    computing: false, tripPlan: null, progressStep: '', progressDetail: '',
    homeBase: null, homeBaseName: '', priorityPlayers: ['Test Pro'], pinnedGame: null,
    startDate: '2026-10-20', endDate: '2026-10-30',
  })
})

describe('generateTrips blocked messages', () => {
  it('schedules not loaded: says so before asking for an origin', async () => {
    await useTripStore.getState().generateTrips()
    const s = useTripStore.getState()
    expect(s.progressStep).toBe('Blocked')
    expect(s.progressDetail).toMatch(/missing schedule data/)
    expect(s.progressDetail).toMatch(/Test Pro \(Pro\)/)
    expect(s.progressDetail).not.toMatch(/Trip origin/)
  })

  it('schedules loaded but no game in range: names the player and the dates', async () => {
    scheduleState.proGames = [game('2026-11-15', ['Test Pro'])]
    await useTripStore.getState().generateTrips()
    const s = useTripStore.getState()
    expect(s.progressStep).toBe('Blocked')
    expect(s.progressDetail).toMatch(/Test Pro has no games loaded between 2026-10-20 and 2026-10-30/)
    expect(s.progressDetail).not.toMatch(/add a priority player/)
    expect(s.progressDetail).not.toMatch(/[–—…]|\.\.\./)
  })

  it('no priority player and no origin: still asks for an origin', async () => {
    useTripStore.setState({ priorityPlayers: [] })
    await useTripStore.getState().generateTrips()
    expect(useTripStore.getState().progressDetail).toMatch(/Pick a Trip origin/)
  })
})
