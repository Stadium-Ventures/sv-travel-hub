# Maptive vs sv-travel-hub Coverage Diff

_Generated for the Kent renewal-pitch meeting (2026-06-09)._

**Source:** `maptive-export-cPDy380mMWcyPWRt.xlsx` (5,071 game rows, downloaded 2026-06-08).
**SV master roster:** 86 active (non-coach) players.
**Maptive roster:** 84 players represented in the export.

---

## Roster sync gap

### Likely typos / name drift (4)

These appear in both lists but spelled differently. Maptive's roster needs cleanup.

| SV master roster | Maptive |
|---|---|
| `Alexander Smith` | `Alex Smith` |
| `Cam Flukey` | `Cameron Flukey` |
| `Sam Mitchell` | `Sammy Mitchell` |
| `Zack Johnson` | `Zach Johnson` |

### In SV roster but NOT in Maptive (6)

Players on your sheet who Maptive doesn't know about — Kent can't see their games there.

| Player | Level | Org |
|---|---|---|
| Bennett Edwards | NCAA | Georgia Southern |
| Cole Katayama-Stall | NCAA | University of Portland |
| David Hagaman | Pro | Arizona Diamondbacks |
| Ethan Lay | NCAA | Sacramento State |
| Forrest Wall | Pro | Retired |
| Luke Fithian | NCAA | Rutgers |

### In Maptive but NOT in SV roster (4)

Stale entries — likely former clients or contractor mistakes.

- `Cole Cleveland` (57 games loaded)
- `Greyson Wuis` (10 games loaded)
- `Lucas Lawerence` (33 games loaded)
- `Lukas Klipper` (2 games loaded)

---

## Top-coverage players in Maptive

Players with the most games loaded. Verify our app shows similar counts:

| Player | Maptive game count | Level (Maptive) |
|---|---|---|
| Sterlin Thompson | 160 | Pro |
| Tanner Gordon | 160 | Pro |
| Garrett Whitlock | 154 | Pro |
| Najer Victor | 144 | Pro |
| Austin Amaral | 137 | Pro |
| Carter Johnson | 133 | Pro |
| Jake Munroe | 132 | Pro |
| Michael Dattalo | 132 | Pro |
| Cade Doughty | 115 | Pro |
| Blake Rambusch | 113 | Pro |
| Peyton Glavine | 113 | Pro |
| Davis Sharpe | 112 | Pro |
| Jack Cebert | 111 | Pro |
| Justin Riemer | 111 | Pro |
| Dax Kilby | 106 | Pro |

## JUCO coverage

Maptive has **43 JUCO games** across 1 player(s): Dominic Woodward.

Verify our app's NCAA pipeline includes JUCO leagues for this player.

## Date range

Maptive: **Jan 23, 2026 → Sep 27, 2026** (~8 months).

---

## What this tells us about Maptive's data pipeline

**bg_accuracy distribution:**

- `APPROXIMATE`: 5068 rows (99.9%)
- `ROOFTOP`: 3 rows (0.1%)

`APPROXIMATE` is Google geocoding's city-level back-resolution from a venue name. `ROOFTOP` means precise building.

**Inferences:**

1. **Almost entirely city-level geocoded.** If this were fed from MLB Stats API or D1Baseball, venues would carry precise coordinates from the source. The 99.9% APPROXIMATE rate suggests Maptive received a CSV with city/state strings and Google's geocoder back-resolved each to a city centroid.

2. **4 name spelling drift cases.** Auto-feeds maintain consistent keys; humans transcribing names produce these kinds of typos.

3. **Sparse schema (9 columns).** No game IDs, no source URLs, no metadata. A scraped or API dataset would carry more.

**Most likely:** A human (SV ops or a contractor) periodically compiles schedules into a CSV/Excel and re-uploads to Maptive. Updates are batch, not real-time.

**Open question (Tom to confirm):** Who maintains this upload, and how often?

---

## How sv-travel-hub compares

| Capability | Maptive (per this export) | sv-travel-hub |
|---|---|---|
| Pro/MiLB schedules | Manual entry, batch refresh | **Live MLB Stats API** |
| NCAA D1 schedules | Manual entry | Bundled D1Baseball (regenerable script) |
| HS schedules | Manual entry | Bundled MaxPreps + Google Sheet fallback |
| Summer collegiate (CCBL/MLBD) | Possibly absent | **Live MLB Stats API** |
| Venue geocoding | City-level (APPROXIMATE) | Precise venue coords (MLB API + NCAA venue table) |
| Roster sync | Drifted (18 name mismatches) | Live from Google Sheet |
| JUCO | 43 games (1 player) | Same pipeline as NCAA |

**Summary:** sv-travel-hub wins on freshness in 5 of 7 categories. The Maptive export is useful for cross-checking specific players but should not be treated as source of truth — it lags reality.
