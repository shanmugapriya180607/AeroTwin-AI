/**
 * Flight model for the 3D scene.
 *
 * The UAV does not orbit a pivot - it flies. A waypoint follower steers toward
 * the active leg, the bank angle comes out of the turn rate rather than being
 * animated for looks, and altitude and speed track the mission phase reported
 * by the twin. The result is that what the operator sees in 3D is the same
 * sortie the telemetry page is charting.
 *
 * World units: 1 unit = 1 km of sector grid. Altitude is exaggerated 4x,
 * because a MALE UAV at 15,000 ft over a 200 km sector is otherwise a dot on
 * a flat plane.
 */

import * as THREE from 'three'
import { ALT_EXAGGERATION, FT_TO_KM, terrainHeight } from './terrain'

export { ALT_EXAGGERATION, FT_TO_KM }

/** Minimum clearance held above the terrain, in world units (~90 m). */
const GROUND_CLEARANCE = 0.36

/** Vertical rate limits, ft/s of rendered time. */
const MAX_CLIMB_FPS = 900
const MAX_DESCENT_FPS = 1100

export interface RouteLeg {
  id: string
  x: number
  y: number
  altitudeFt: number
  speedKt: number
}

export interface FlightState {
  position: THREE.Vector3
  heading: number          // radians, 0 = +Z (north)
  bank: number             // radians
  pitch: number            // radians
  speedKt: number
  altitudeFt: number
  legIndex: number
  legLabel: string
  distanceToNextKm: number
  progress: number
}

const KT_TO_KM_S = 1.852 / 3600

export class FlightDynamics {
  state: FlightState
  private route: RouteLeg[] = []
  private target = 0
  private turnRate = 0
  private travelled = 0
  private totalLength = 1

  constructor() {
    this.state = {
      position: new THREE.Vector3(18, 0.02, 22),
      heading: Math.PI * 0.25,
      bank: 0,
      pitch: 0,
      speedKt: 0,
      altitudeFt: 0,
      legIndex: 0,
      legLabel: 'BASE ALPHA',
      distanceToNextKm: 0,
      progress: 0,
    }
  }

  setRoute(route: RouteLeg[]) {
    if (!route.length) return
    this.route = route
    this.totalLength = route.reduce((sum, leg, i) => {
      if (i === 0) return 0
      const prev = route[i - 1]
      return sum + Math.hypot(leg.x - prev.x, leg.y - prev.y)
    }, 0) || 1
    if (this.target === 0) {
      const first = route[0]
      this.state.position.set(
        first.x,
        Math.max(
          terrainHeight(first.x, first.y) + GROUND_CLEARANCE,
          first.altitudeFt * FT_TO_KM * ALT_EXAGGERATION,
        ),
        first.y,
      )
      this.target = 1
    }
  }

  /** Snap toward an authoritative position from the backend, gently. */
  reconcile(x: number, y: number, altitudeFt: number, blend = 0.02) {
    const targetY = Math.max(
      terrainHeight(x, y) + GROUND_CLEARANCE,
      altitudeFt * FT_TO_KM * ALT_EXAGGERATION,
    )
    this.state.position.x += (x - this.state.position.x) * blend
    this.state.position.z += (y - this.state.position.z) * blend
    this.state.position.y += (targetY - this.state.position.y) * blend * 2
  }

  /**
   * Jump straight to a cruise state.
   *
   * The model does not integrate while the stage is parked behind the intro,
   * so on the way out the aircraft would otherwise be sitting on the runway
   * while the telemetry says ISR loiter at 14,000 ft. This puts it where the
   * mission says it is instead of flying a fifteen-second climb nobody asked
   * to watch.
   */
  warmStart(altitudeFt: number, speedKt: number) {
    const s = this.state
    if (altitudeFt <= s.altitudeFt) return
    s.altitudeFt = altitudeFt
    s.speedKt = Math.max(s.speedKt, speedKt)
    const ground = terrainHeight(s.position.x, s.position.z)
    s.position.y = Math.max(
      ground + GROUND_CLEARANCE,
      s.altitudeFt * FT_TO_KM * ALT_EXAGGERATION,
    )
  }

  step(dt: number, commandedAltFt: number, commandedSpeedKt: number) {
    if (!this.route.length) return this.state
    const s = this.state
    const leg = this.route[Math.min(this.target, this.route.length - 1)]

    // --- steering ------------------------------------------------------
    const dx = leg.x - s.position.x
    const dz = leg.y - s.position.z
    const distance = Math.hypot(dx, dz)
    s.distanceToNextKm = distance

    const desired = Math.atan2(dx, dz)
    let error = desired - s.heading
    while (error > Math.PI) error -= Math.PI * 2
    while (error < -Math.PI) error += Math.PI * 2

    // Proportional heading hold with a rate limit - a MALE UAV does not
    // snap onto a new heading, it rolls into a standard-rate turn.
    const maxRate = 0.16                              // rad/s
    const commandedRate = Math.max(-maxRate, Math.min(maxRate, error * 0.55))
    this.turnRate += (commandedRate - this.turnRate) * Math.min(1, dt * 1.6)
    s.heading += this.turnRate * dt

    // Bank follows the turn: tan(phi) = V * omega / g
    const speedMs = Math.max(1, s.speedKt * 0.5144)
    const bankTarget = Math.atan((speedMs * this.turnRate) / 9.81)
    s.bank += (Math.max(-0.62, Math.min(0.62, bankTarget)) - s.bank) * Math.min(1, dt * 2.2)

    // --- speed ---------------------------------------------------------
    const speedTarget = Math.max(0, commandedSpeedKt)
    s.speedKt += (speedTarget - s.speedKt) * Math.min(1, dt * 0.35)

    // --- altitude ------------------------------------------------------
    // The twin replays a sortie far faster than real time, so the rendered
    // aircraft has to climb faster than a real one or it sits at circuit
    // height while the telemetry says it is in the ISR orbit. The rate is
    // still limited, so the motion reads as a climb rather than a jump.
    const altTarget = Math.max(0, commandedAltFt)
    const altError = altTarget - s.altitudeFt
    const climbRate = Math.max(-MAX_DESCENT_FPS, Math.min(MAX_CLIMB_FPS, altError * 0.65))
    s.altitudeFt += climbRate * dt
    s.pitch += ((climbRate / 2600) - s.pitch) * Math.min(1, dt * 1.4)
    s.pitch = Math.max(-0.16, Math.min(0.2, s.pitch))

    // --- integrate -----------------------------------------------------
    const groundSpeedKmS = s.speedKt * KT_TO_KM_S
    const step = groundSpeedKmS * dt
    s.position.x += Math.sin(s.heading) * step
    s.position.z += Math.cos(s.heading) * step

    // Altitude is above the airbase datum, and the ground rises downrange, so
    // the rendered height is floored against the terrain beneath the aircraft.
    // Without this the UAV flies through the ridge on the climb-out leg.
    const ground = terrainHeight(s.position.x, s.position.z)
    s.position.y = Math.max(
      ground + GROUND_CLEARANCE,
      s.altitudeFt * FT_TO_KM * ALT_EXAGGERATION,
    )

    this.travelled += step
    s.progress = Math.min(1, this.travelled / this.totalLength)

    // --- waypoint capture ----------------------------------------------
    if (distance < Math.max(2.5, groundSpeedKmS * 12)) {
      this.target = (this.target + 1) % this.route.length
      s.legIndex = this.target
      s.legLabel = this.route[this.target].id
      if (this.target === 0) this.travelled = 0
    }

    return s
  }

  get activeLeg() {
    return this.route[Math.min(this.target, this.route.length - 1)]
  }

  get routeLength() {
    return this.route.length
  }
}

/** Default sector route, used until the backend's sector plan arrives. */
export const FALLBACK_ROUTE: RouteLeg[] = [
  { id: 'BASE', x: 18, y: 22, altitudeFt: 900, speedKt: 72 },
  { id: 'WP-01', x: 48, y: 74, altitudeFt: 12800, speedKt: 92 },
  { id: 'WP-02', x: 104, y: 118, altitudeFt: 14400, speedKt: 104 },
  { id: 'ISR', x: 168, y: 144, altitudeFt: 15400, speedKt: 86 },
  { id: 'ISR-A', x: 182, y: 156, altitudeFt: 15400, speedKt: 86 },
  { id: 'ISR-B', x: 168, y: 162, altitudeFt: 15400, speedKt: 86 },
  { id: 'ISR-C', x: 154, y: 150, altitudeFt: 15400, speedKt: 86 },
  { id: 'WP-03', x: 112, y: 66, altitudeFt: 11000, speedKt: 108 },
  { id: 'RTB', x: 46, y: 34, altitudeFt: 3600, speedKt: 96 },
]

export function routeFromSector(waypoints: Array<{ id: string; x: number; y: number }>, orbit: Array<{ x: number; y: number }>): RouteLeg[] {
  if (!waypoints.length) return FALLBACK_ROUTE
  const altitudeFor = (id: string) => {
    if (id === 'BASE') return 900
    if (id === 'WP-01') return 12800
    if (id === 'WP-02') return 14400
    if (id.startsWith('ISR')) return 15400
    if (id === 'WP-03') return 11000
    return 3600
  }
  const speedFor = (id: string) => (id.startsWith('ISR') ? 86 : id === 'BASE' ? 74 : 100)

  const legs: RouteLeg[] = []
  for (const wp of waypoints) {
    if (wp.id === 'ISR') {
      // Fly the published orbit rather than cutting the corner.
      const sampled = orbit.filter((_, i) => i % 8 === 0)
      sampled.forEach((point, i) => {
        legs.push({ id: `ISR-${i}`, x: point.x, y: point.y, altitudeFt: 15400, speedKt: 86 })
      })
      continue
    }
    legs.push({
      id: wp.id,
      x: wp.x,
      y: wp.y,
      altitudeFt: altitudeFor(wp.id),
      speedKt: speedFor(wp.id),
    })
  }
  return legs.length ? legs : FALLBACK_ROUTE
}

/**
 * One flight model instance for the whole application.
 *
 * The 3D stage integrates it and the HUD reads it, so the numbers on the
 * overlay are the same numbers driving the aircraft rather than a second
 * animation that happens to look similar.
 */
export const flightDynamics = new FlightDynamics()
