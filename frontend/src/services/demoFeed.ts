/**
 * Local demo feed.
 *
 * Used only when the backend cannot be reached. It runs a cut-down version of
 * the same idea - a lumped physics expectation driven by throttle, altitude,
 * OAT and airspeed, and an observed value that drifts away from it on one
 * cylinder - so the interface stays fully demonstrable with no server.
 *
 * Everything it emits is tagged DEMO. It is never presented as measured data,
 * and it never claims to be NGAFID.
 */

import type { AlertFrame, MissionFrame, ResidualFrame, TelemetryFrame } from '../types'

const PHASES: Array<{ name: string; duration: number; alt: number; ias: number; thr: number }> = [
  { name: 'TAKEOFF', duration: 90, alt: 900, ias: 72, thr: 1.0 },
  { name: 'CLIMB', duration: 420, alt: 12800, ias: 88, thr: 0.92 },
  { name: 'TRANSIT', duration: 900, alt: 14200, ias: 104, thr: 0.78 },
  { name: 'ISR LOITER', duration: 1800, alt: 15400, ias: 84, thr: 0.62 },
  { name: 'RTB', duration: 700, alt: 12000, ias: 108, thr: 0.7 },
  { name: 'DESCENT', duration: 420, alt: 4200, ias: 112, thr: 0.42 },
  { name: 'APPROACH', duration: 220, alt: 900, ias: 78, thr: 0.5 },
]

const TOTAL = PHASES.reduce((sum, p) => sum + p.duration, 0)

const CHT_BIAS = [0, -2.1, 1.4, -1.0]
const EGT_BIAS = [0, -6.0, 4.0, -3.0]

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u
}

function smooth(u: number) {
  return u * u * (3 - 2 * u)
}

/** Deterministic low-amplitude noise: reproducible across reloads. */
function noise(seed: number, scale: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x) - 0.5) * 2 * scale
}

export interface DemoState {
  t: number
  phase: string
  channels: Record<string, number>
  expected: Record<string, number>
  inputs: Record<string, number>
  powerFraction: number
  altitude: number
  ias: number
  progress: number
}

export class DemoFeed {
  private t = 0
  /** Degradation depth on cylinder 3, 0..1. Ramps in over the sortie. */
  private degradation = 0.35

  step(dt: number): DemoState {
    this.t = (this.t + dt) % TOTAL
    this.degradation = Math.min(1, this.degradation + dt / 9000)

    let elapsed = 0
    let phase = PHASES[0]
    let local = 0
    let prev = PHASES[0]
    for (let i = 0; i < PHASES.length; i += 1) {
      const p = PHASES[i]
      if (this.t <= elapsed + p.duration) {
        phase = p
        prev = PHASES[Math.max(0, i - 1)]
        local = (this.t - elapsed) / p.duration
        break
      }
      elapsed += p.duration
    }

    const u = smooth(Math.min(1, local))
    const altitude = lerp(prev.alt, phase.alt, u) + noise(this.t * 0.7, 22)
    const ias = lerp(prev.ias, phase.ias, u) + noise(this.t * 1.1, 0.8)
    const throttle = lerp(prev.thr, phase.thr, u)
    const oat = 15 - 0.00198 * altitude + noise(this.t * 0.3, 0.4)

    // --- physics expectation (lumped, the same shape as the backend model) --
    const densityRatio = Math.max(0.35, (1 - 6.875e-6 * altitude) ** 4.2561)
    const map = 29.92 * densityRatio * (0.32 + 0.68 * throttle)
    const rpm = 700 + 2000 * throttle * (0.86 + 0.14 * densityRatio)
    const powerFraction = Math.max(0.05, Math.min(1, (map / 29.4) * (rpm / 2700) * 1.06))
    const fuelFlow = 1.4 + 15.2 * powerFraction
    const coolingAir = Math.max(0.42, Math.min(1.5, (ias + 40) / 150)) * Math.sqrt(densityRatio)
    const chtBase = oat + (233 * powerFraction) / coolingAir
    const egtBase = 600 + 190 * powerFraction

    const expected: Record<string, number> = {
      rpm,
      map_inhg: map,
      fuel_flow_gph: fuelFlow,
      oil_press_psi: 24 + 46 * Math.min(1, rpm / 2400),
      oil_temp_c: 38 + 58 * powerFraction + 0.22 * (oat - 15),
      vibration_g: 0.28 + 0.62 * powerFraction,
      inj_timing_deg: 20 + 4 * powerFraction,
    }
    for (let i = 0; i < 4; i += 1) {
      expected[`cht_${i + 1}`] = chtBase + CHT_BIAS[i]
      expected[`egt_${i + 1}`] = egtBase + EGT_BIAS[i]
    }

    // --- observed: physics + measurement noise, plus a cylinder-3 fault -----
    const channels: Record<string, number> = {}
    for (const [key, value] of Object.entries(expected)) {
      channels[key] = value + noise(this.t * 3.3 + key.length * 7, value * 0.0045 + 0.25)
    }
    const fault = 17.5 * this.degradation * (0.55 + 0.45 * powerFraction)
    channels.cht_3 += fault
    channels.egt_3 += fault * 1.55
    channels.vibration_g += 0.16 * this.degradation

    channels.oat_c = oat
    channels.altitude_ft = altitude
    channels.ias_kt = ias

    return {
      t: this.t,
      phase: phase.name,
      channels,
      expected,
      inputs: { throttle, mixture: 0.62, altitude_ft: altitude, oat_c: oat, ias_kt: ias },
      powerFraction,
      altitude,
      ias,
      progress: this.t / TOTAL,
    }
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(TOTAL, t))
  }

  get duration() {
    return TOTAL
  }
}

const RESIDUAL_KEYS = [
  'rpm', 'map_inhg', 'fuel_flow_gph', 'oil_press_psi', 'oil_temp_c',
  'cht_1', 'cht_2', 'cht_3', 'cht_4', 'egt_1', 'egt_2', 'egt_3', 'egt_4',
  'vibration_g', 'inj_timing_deg',
]

const SCALES: Record<string, number> = {
  rpm: 8, map_inhg: 0.2, fuel_flow_gph: 0.25, oil_press_psi: 0.8, oil_temp_c: 0.9,
  cht_1: 0.7, cht_2: 0.7, cht_3: 0.7, cht_4: 0.7,
  egt_1: 3, egt_2: 3, egt_3: 3, egt_4: 3,
  vibration_g: 0.03, inj_timing_deg: 0.2,
}

const UNITS: Record<string, string> = {
  rpm: 'rpm', map_inhg: 'inHg', fuel_flow_gph: 'gph', oil_press_psi: 'psi', oil_temp_c: '°C',
  cht_1: '°C', cht_2: '°C', cht_3: '°C', cht_4: '°C',
  egt_1: '°C', egt_2: '°C', egt_3: '°C', egt_4: '°C',
  vibration_g: 'g rms', inj_timing_deg: '°BTDC',
}

const drift: Record<string, number> = {}
const cusum: Record<string, number> = {}

function regimeOf(power: number, alt: number) {
  const p = power < 0.4 ? 'LOW PWR' : power < 0.65 ? 'CRUISE PWR' : power < 0.85 ? 'HIGH PWR' : 'MAX PWR'
  const a = alt < 5000 ? 'LOW ALT' : alt < 11000 ? 'MID ALT' : 'HIGH ALT'
  return `${p} / ${a}`
}

export function demoFrames(state: DemoState) {
  const residuals: ResidualFrame['channels'] = {}
  const wire: Record<string, { r: number; z: number; e: number; c: number }> = {}

  for (const key of RESIDUAL_KEYS) {
    const observed = state.channels[key]
    const expected = state.expected[key]
    if (observed === undefined || expected === undefined) continue
    const residual = observed - expected
    const scale = SCALES[key] ?? 1
    drift[key] = drift[key] === undefined ? residual : drift[key] * 0.985 + residual * 0.015
    const z = residual / scale
    cusum[key] = Math.max(0, (cusum[key] ?? 0) * 0.999 + (Math.abs(z) - 0.75))
    residuals[key] = {
      key,
      observed,
      expected,
      residual,
      normalised: z,
      ewma: drift[key],
      cusum: cusum[key],
      scale,
      unit: UNITS[key] ?? '',
    }
    wire[key] = {
      r: +residual.toFixed(2),
      z: +z.toFixed(2),
      e: +drift[key].toFixed(2),
      c: +cusum[key].toFixed(1),
    }
  }

  const chtDrifts = [1, 2, 3, 4].map((i) => residuals[`cht_${i}`]?.ewma ?? 0)
  const chtMean = chtDrifts.reduce((a, b) => a + b, 0) / 4
  const regime = regimeOf(state.powerFraction, state.altitude)

  const cylinders = [1, 2, 3, 4].map((i) => {
    const cht = residuals[`cht_${i}`]
    const egt = residuals[`egt_${i}`]
    const asymmetry = (cht?.ewma ?? 0) - chtMean
    const health = Math.max(28, 100 - Math.abs(asymmetry) * 3.4)
    return {
      index: i,
      health: +health.toFixed(1),
      status: health > 92 ? 'NORMAL' : health > 78 ? 'DEGRADING' : health > 60 ? 'WARNING' : 'CRITICAL',
      cht_observed: +(cht?.observed ?? 0).toFixed(1),
      cht_expected: +(cht?.expected ?? 0).toFixed(1),
      cht_residual: +(cht?.residual ?? 0).toFixed(1),
      cht_drift: +(cht?.ewma ?? 0).toFixed(2),
      egt_observed: +(egt?.observed ?? 0).toFixed(1),
      egt_expected: +(egt?.expected ?? 0).toFixed(1),
      egt_residual: +(egt?.residual ?? 0).toFixed(1),
      egt_drift: +(egt?.ewma ?? 0).toFixed(2),
      trim_divergence_pct: +(asymmetry / 40).toFixed(2),
      asymmetry_c: +asymmetry.toFixed(2),
      margin_to_redline_c: +(260 - (cht?.observed ?? 0)).toFixed(1),
    }
  })

  const worst = cylinders.reduce((a, b) => (a.health < b.health ? a : b))
  const healthIndex = +(cylinders.reduce((s, c) => s + c.health, 0) / 4).toFixed(1)
  const status =
    healthIndex > 92 ? 'NORMAL' : healthIndex > 80 ? 'DEGRADED' : healthIndex > 65 ? 'WARNING' : 'CRITICAL'

  const score = Math.max(0, Math.min(1, Math.abs(worst.asymmetry_c) / 14))
  const confidence = Math.max(0, Math.min(0.94, score * 0.86 + 0.06))
  const abstained = confidence < 0.45

  const engine = {
    engine_id: 'AERO-01',
    health_index: healthIndex,
    status,
    reason: abstained
      ? 'Evidence below diagnosis threshold'
      : `Cylinder ${worst.index} CHT residual increasing`,
    confidence: abstained ? null : +confidence.toFixed(4),
    model_state: 'DEMO',
    model_gated: true,
    sync_pct: 97.4,
    cylinders,
    anomaly_count: abstained ? 0 : 1,
    advisory_count: abstained ? 0 : 1,
    threshold_count: 0,
    prognosis: null,
    health_history: [],
    phase: state.phase,
    regime,
    power_pct: +(state.powerFraction * 100).toFixed(1),
    power_hp: +(state.powerFraction * 180).toFixed(1),
  }

  const telemetry: TelemetryFrame = {
    tick: {
      t: +state.t.toFixed(1),
      wall_clock: new Date().toISOString(),
      flight_id: 'DEMO',
      phase: state.phase,
      regime,
      channels: state.channels,
      expected: state.expected,
      residuals: wire,
      inputs: state.inputs,
      power_fraction: state.powerFraction,
      power_hp: state.powerFraction * 180,
      tas_kt: state.ias * 1.16,
      steady: true,
      sync_pct: 97.4,
    },
    engine: engine as any,
    provenance: { real: 0, simulated: 18 },
    datalink: {
      connected: true,
      status: 'DEMO FEED',
      last_valid: new Date().toISOString(),
      lost_at: null,
      rate_hz: 1,
      twin_state: 'SYNCHRONISED (DEMO)',
      diagnostics_state: 'ACTIVE',
    },
    source: {
      id: 'DEMO_LOCAL',
      label: 'LOCAL DEMO GENERATOR',
      kind: 'DEMO',
      provenance: 'DEMO',
      detail:
        'Backend unreachable. Every value on screen is generated in the browser by a reduced physics model and is labelled DEMO. No measured data is being displayed.',
      rate_hz: 1,
    },
  }

  const residualFrame: ResidualFrame = {
    t: +state.t.toFixed(1),
    sync_pct: 97.4,
    channels: residuals,
    estimator: {
      state: 'DEMO',
      volumetric_efficiency: 0.982,
      cooling_effectiveness: 0.965,
      cylinder_trim: cylinders.map((c) => c.trim_divergence_pct / 100),
    },
    asymmetry: {
      cht: +Math.max(...chtDrifts).toFixed(2),
      egt: +Math.max(...[1, 2, 3, 4].map((i) => residuals[`egt_${i}`]?.ewma ?? 0)).toFixed(2),
    },
    steady: true,
    regime,
  }

  const alerts: AlertFrame = {
    anomalies: score < 0.12 ? [] : [
      {
        id: `DEMO-CYL${worst.index}`,
        rank: 1,
        title: `CYLINDER ${worst.index} CHT`,
        subsystem: 'THERMAL / PER-CYLINDER',
        cylinder: worst.index,
        severity: score > 0.8 ? 'HIGH' : score > 0.55 ? 'MEDIUM' : 'LOW',
        score: +score.toFixed(4),
        confidence: +confidence.toFixed(4),
        confidence_raw: +confidence.toFixed(4),
        calibrated: false,
        abstained,
        abstain_reason: abstained ? 'Insufficient residual persistence in demo mode.' : null,
        mechanism: 'exhaust_valve_distress',
        mechanism_label: 'Early exhaust valve distress',
        mechanism_qualifier: abstained ? 'ABSTAIN' : 'LIKELY',
        summary: `CHT-${worst.index} residual ${worst.asymmetry_c > 0 ? '+' : ''}${worst.asymmetry_c.toFixed(1)} °C against physics expectation.`,
        residual: worst.cht_residual,
        residual_unit: '°C',
        trend: worst.asymmetry_c > 1 ? 'DRIFTING' : 'STABLE',
        regimes: [regime],
        regime_count: 1,
        flights: 1,
        samples: Math.round(state.t),
        first_seen_t: 0,
        last_seen_t: +state.t.toFixed(1),
        contributions: [
          {
            feature: 'cht_asymmetry_c',
            label: `CHT-${worst.index} residual asymmetry`,
            value: worst.asymmetry_c,
            unit: '°C',
            contribution: 0.62,
          },
          {
            feature: 'egt_asymmetry_c',
            label: `EGT-${worst.index} residual asymmetry`,
            value: worst.egt_drift,
            unit: '°C',
            contribution: 0.24,
          },
        ],
        supporting: { demo: true },
        learned: {},
      },
    ],
    advisories: [],
    threshold: [],
    engine_state: status,
    engine_reason: engine.reason,
  }

  const mission: MissionFrame = {
    mission: {
      id: 'ISR-047',
      name: 'PERSISTENT SURVEILLANCE',
      uav_id: 'UAV-01',
      engine_id: 'AERO-01',
      airframe: 'MALE UAV / PUSHER CONFIGURATION',
      profile_id: 'DEMO',
      flight_id: 'DEMO',
      started_at: new Date().toISOString(),
      status: 'DEMO',
      phase: state.phase,
      elapsed_s: Math.round(state.t),
      duration_s: 4550,
      progress: state.progress,
      sector: 'TRAINING SECTOR ALPHA',
      position: {
        x: 18 + 150 * state.progress,
        y: 22 + 122 * state.progress,
        heading: 45,
        leg: state.phase,
        grid: 'AL 0000 0000',
        distance_to_base_km: +(190 * state.progress).toFixed(1),
      },
    },
    altitude_ft: Math.round(state.altitude),
    ias_kt: +state.ias.toFixed(1),
    rpm: Math.round(state.channels.rpm),
    oat_c: +state.channels.oat_c.toFixed(1),
    power_pct: +(state.powerFraction * 100).toFixed(1),
    demo_active: true,
    time_scale: 1,
  }

  return { telemetry, residualFrame, alerts, mission }
}
