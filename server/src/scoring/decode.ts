import type { PlayerSamples, RunPayload, StageProjection } from "../validate.js"

/**
 * Base64 columns to typed arrays, once at boot.
 *
 * The payload is stored column-wise so it decodes straight into typed arrays
 * with no parsing. Decoding happens here and nowhere else, so the scorer works
 * in numbers and never touches an encoding.
 */

export interface DecodedSamples {
  playerId: number
  /** Column order of `games`. */
  stats: string[]
  nGames: number
  /** nGames x stats.length, row-major. NaN means "not measured", never zero. */
  games: Float32Array
  matchId: Float64Array
  heroId: Int32Array
  won: Uint8Array
  durationSeconds: Int32Array
  firstBloodTime: Int32Array
  /** Unix seconds. */
  startTime: Float64Array
  gameWeight: Float32Array
  warnings: string[]
  /** matchId -> row, so a duo can be joined without scanning. */
  rowOfMatch: Map<number, number>
}

export interface DecodedProjection {
  teamId: number
  nShapeSamples: number
  maxSeries: number
  /** nShapeSamples x maxSeries, 0-padded: games in each series. */
  series: Int8Array
  /** Same shape: did that series go the full distance. */
  decider: Uint8Array
  expectedSeries: number
  eliminationRisk: number
  advanceProb: number
}

const buf = (b64: string) => Buffer.from(b64, "base64")

function bigIntsToFloats(b: Buffer): Float64Array {
  // Match ids and unix seconds are int64 on the wire. Both sit far inside the
  // 2^53 a double represents exactly, so this loses nothing and spares every
  // downstream comparison from BigInt.
  const view = new BigInt64Array(b.buffer, b.byteOffset, b.byteLength / 8)
  const out = new Float64Array(view.length)
  for (let i = 0; i < view.length; i++) out[i] = Number(view[i])
  return out
}

function decodeSamples(s: PlayerSamples): DecodedSamples {
  const games = buf(s.games)
  const matchId = bigIntsToFloats(buf(s.matchId))
  const rowOfMatch = new Map<number, number>()
  for (let i = 0; i < matchId.length; i++) rowOfMatch.set(matchId[i]!, i)

  const int32 = (b64: string) => {
    const b = buf(b64)
    return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  }

  return {
    playerId: s.playerId,
    stats: s.stats,
    nGames: s.nGames,
    games: new Float32Array(games.buffer, games.byteOffset, games.byteLength / 4),
    matchId,
    heroId: int32(s.heroId),
    won: new Uint8Array(buf(s.won)),
    durationSeconds: int32(s.durationSeconds),
    firstBloodTime: int32(s.firstBloodTime),
    startTime: bigIntsToFloats(buf(s.startTime)),
    gameWeight: (() => {
      const b = buf(s.gameWeight)
      return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
    })(),
    warnings: s.sampleWarnings,
    rowOfMatch,
  }
}

function decodeProjection(p: StageProjection): DecodedProjection {
  return {
    teamId: p.teamId,
    nShapeSamples: p.nShapeSamples,
    maxSeries: p.maxSeries,
    series: new Int8Array(buf(p.seriesSamples)),
    decider: new Uint8Array(buf(p.deciderSamples)),
    expectedSeries: p.expectedSeries,
    eliminationRisk: p.eliminationRisk,
    advanceProb: p.swiss?.advanceProb ?? p.bracket?.winProb ?? 0,
  }
}

/** Everything the scorer needs, decoded once and shared by every request. */
export interface RunIndex {
  samplesOf: Map<number, DecodedSamples>
  projectionOf: Map<number, DecodedProjection>
  statColumn: Map<string, number>
}

export function indexRun(payload: RunPayload): RunIndex {
  const samplesOf = new Map<number, DecodedSamples>()
  for (const s of payload.playerSamples) samplesOf.set(s.playerId, decodeSamples(s))

  const projectionOf = new Map<number, DecodedProjection>()
  for (const p of payload.stageProjections) projectionOf.set(p.teamId, decodeProjection(p))

  // Column order is identical across players -- the publisher writes one list --
  // so the lookup is built once.
  const statColumn = new Map<string, number>()
  const first = payload.playerSamples[0]
  if (first) first.stats.forEach((name, i) => statColumn.set(name, i))

  return { samplesOf, projectionOf, statColumn }
}
