/**
 * The single source of truth for the interface.
 *
 * Live frames arrive over four websockets. If those cannot be established the
 * store starts the local demo generator instead and flips `mode` to DEMO, so
 * every panel keeps rendering and every value on screen is labelled for what
 * it is. Nothing in the UI reads the network directly.
 */

import { create } from 'zustand'
import { api, onConnectivity } from '../services/api'
import { DemoFeed, demoFrames } from '../services/demoFeed'
import { connectAll, topicSocket, type SocketState } from '../services/ws'
import type {
  AlertFrame, Anomaly, EventEntry, MissionFrame, ResidualFrame, Sector,
  SystemStatus, TelemetryFrame,
} from '../types'

export type Mode = 'LIVE' | 'DEMO' | 'CONNECTING'

/** The console's own entry gate. BOOT -> the short startup card; READY -> the
 *  console itself. The full first-entry film is a route (/intro), not a phase:
 *  reaching the console at all means the film is behind us. */
export type IntroPhase = 'BOOT' | 'READY'

/** The persistent 3D stage parks either in the corner card or in the Command
 *  Center hero. Both are the same never-unmounted canvas. */
export type Dock = 'CORNER' | 'HERO'

const INTRO_KEY = 'aerotwin_intro_seen'

export function introSeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === 'true'
  } catch {
    // Private browsing or a blocked storage partition. Treat as a returning
    // operator rather than forcing the full sequence on every load.
    return true
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, 'true')
  } catch {
    /* nothing to do - the intro simply replays next time */
  }
}

const HISTORY = 240

export interface TrendPoint {
  t: number
  [key: string]: number
}

interface TwinStore {
  mode: Mode
  socketState: SocketState
  status: SystemStatus | null
  telemetry: TelemetryFrame | null
  residuals: ResidualFrame | null
  alerts: AlertFrame | null
  mission: MissionFrame | null
  sector: Sector | null
  log: EventEntry[]

  /** Rolling series for the charts, keyed by channel. */
  history: Record<string, TrendPoint[]>
  healthTrail: Array<{ t: number; health: number }>

  selectedCylinder: number
  selectedAnomaly: string | null
  flightMode: 'DASHBOARD' | 'TRANSITION_OUT' | 'MISSION' | 'TRANSITION_IN'
  cameraMode: string
  demoRunning: boolean
  bootDone: boolean
  /** Entry gate: the cinematic intro, the short boot, then the console. */
  introPhase: IntroPhase
  /** Where the persistent 3D stage is parked when not in mission mode. */
  dock: Dock
  /** The narrated fault story. Step -1 means not running. */
  storyStep: number
  /** Collapsed corner card, so the overlay can never hide a control. */
  cornerCollapsed: boolean

  start: () => void
  setCylinder: (index: number) => void
  setAnomaly: (id: string | null) => void
  enterMission: () => void
  exitMission: () => void
  setCameraMode: (mode: string) => void
  setBootDone: (v: boolean) => void
  setIntroPhase: (phase: IntroPhase) => void
  replayIntro: () => void
  setDock: (dock: Dock) => void
  setStoryStep: (step: number) => void
  toggleCorner: () => void
  refreshStatus: () => Promise<void>
  toggleDemo: () => Promise<void>
  topAnomaly: () => Anomaly | null
}

let started = false
let demoTimer: number | null = null
let watchdog: number | null = null
const feed = new DemoFeed()

export const useTwin = create<TwinStore>((set, get) => ({
  mode: 'CONNECTING',
  socketState: 'CLOSED',
  status: null,
  telemetry: null,
  residuals: null,
  alerts: null,
  mission: null,
  sector: null,
  log: [],
  history: {},
  healthTrail: [],
  selectedCylinder: 3,
  selectedAnomaly: null,
  flightMode: 'DASHBOARD',
  cameraMode: 'FOLLOW',
  demoRunning: false,
  bootDone: false,
  introPhase: 'BOOT',
  dock: 'CORNER',
  storyStep: -1,
  cornerCollapsed: false,

  start: () => {
    if (started) return
    started = true

    const pushHistory = (frame: TelemetryFrame) => {
      const { history, healthTrail } = get()
      const next: Record<string, TrendPoint[]> = { ...history }
      const t = frame.tick.t
      const keys = Object.keys(frame.tick.channels)
      for (const key of keys) {
        const observed = frame.tick.channels[key]
        const expected = frame.tick.expected?.[key]
        const residual = frame.tick.residuals?.[key]?.r
        const series = next[key] ? next[key].slice(-HISTORY + 1) : []
        series.push({
          t,
          observed,
          expected: expected ?? observed,
          residual: residual ?? 0,
        })
        next[key] = series
      }
      const trail = [...healthTrail.slice(-HISTORY + 1), { t, health: frame.engine.health_index }]
      set({ history: next, healthTrail: trail })
    }

    // -- live sockets ----------------------------------------------------
    topicSocket('telemetry').subscribe((message) => {
      if (!message?.tick) return
      stopDemo()
      set({ mode: 'LIVE', telemetry: message as TelemetryFrame })
      pushHistory(message as TelemetryFrame)
    })

    topicSocket('residuals').subscribe((message) => {
      if (!message?.channels) return
      set({ residuals: message as ResidualFrame })
    })

    topicSocket('alerts').subscribe((message) => {
      if (!message?.anomalies) return
      set({ alerts: message as AlertFrame })
      if (message.log) set({ log: message.log })
      const current = get().selectedAnomaly
      if (!current && message.anomalies.length) {
        set({ selectedAnomaly: message.anomalies[0].id })
      }
    })

    topicSocket('mission').subscribe((message) => {
      if (!message?.mission) return
      set({ mission: message as MissionFrame })
    })

    topicSocket('telemetry').onState((state) => set({ socketState: state }))
    connectAll()

    // -- fallback watchdog: no live frame within 6 s means demo mode -----
    watchdog = window.setTimeout(() => {
      if (!get().telemetry) startDemo()
    }, 6000)

    onConnectivity((up) => {
      if (!up && !get().telemetry) startDemo()
    })

    void get().refreshStatus()
    void api.sector().then((sector) => sector && set({ sector }))
    window.setInterval(() => void get().refreshStatus(), 8000)

    function startDemo() {
      if (demoTimer !== null) return
      set({ mode: 'DEMO' })
      demoTimer = window.setInterval(() => {
        const state = feed.step(1.6)
        const frames = demoFrames(state)
        set({
          telemetry: frames.telemetry,
          residuals: frames.residualFrame,
          alerts: frames.alerts,
          mission: frames.mission,
        })
        pushHistory(frames.telemetry)
      }, 220)
    }

    function stopDemo() {
      if (watchdog !== null) {
        window.clearTimeout(watchdog)
        watchdog = null
      }
      if (demoTimer !== null) {
        window.clearInterval(demoTimer)
        demoTimer = null
      }
    }
  },

  setCylinder: (index) => set({ selectedCylinder: index }),
  setAnomaly: (id) => set({ selectedAnomaly: id }),
  enterMission: () => {
    if (get().flightMode !== 'DASHBOARD') return
    set({ flightMode: 'TRANSITION_OUT' })
    window.setTimeout(() => set({ flightMode: 'MISSION', cameraMode: 'CINEMATIC' }), 1500)
  },
  exitMission: () => {
    if (get().flightMode !== 'MISSION') return
    set({ flightMode: 'TRANSITION_IN' })
    window.setTimeout(() => set({ flightMode: 'DASHBOARD', cameraMode: 'FOLLOW' }), 1300)
  },
  setCameraMode: (mode) => set({ cameraMode: mode }),
  setBootDone: (v) => set({ bootDone: v }),

  setIntroPhase: (phase) => {
    markIntroSeen()
    set({ introPhase: phase, bootDone: phase === 'READY' })
  },

  replayIntro: () => {
    // Leaving mission mode first, or the stage would animate its rect while
    // the intro owns the screen. The caller navigates to /intro.
    set({ flightMode: 'DASHBOARD', cameraMode: 'FOLLOW', bootDone: false })
  },

  setDock: (dock) => set({ dock }),

  setStoryStep: (step) => set({ storyStep: step }),
  toggleCorner: () => set((s) => ({ cornerCollapsed: !s.cornerCollapsed })),

  refreshStatus: async () => {
    const status = await api.systemStatus()
    if (status) set({ status, demoRunning: !!status.demo_active })
  },

  toggleDemo: async () => {
    const running = get().demoRunning
    const result = running ? await api.stopDemo() : await api.startDemo()
    if (result) set({ demoRunning: !running })
    await get().refreshStatus()
  },

  topAnomaly: () => {
    const alerts = get().alerts
    if (!alerts?.anomalies?.length) return null
    const selected = get().selectedAnomaly
    return alerts.anomalies.find((a) => a.id === selected) ?? alerts.anomalies[0]
  },
}))

/** Convenience selectors so components subscribe to the narrowest slice.
 *  Each returns a referentially stable value - zustand v5 re-renders on
 *  identity, so a selector that builds a new array every call spins. */
/**
 * Whether the channels arriving right now were measured.
 *
 * A channel's registry provenance says whether it *can* be measured - that is a
 * property of the contract. Whether it *was* depends on which source has the
 * live seat, and only the source descriptor knows that. Everything that renders
 * a REAL badge has to pass through here, or the badge ends up on the output of
 * the simulator.
 */
export const selectSourceIsReal = (s: TwinStore) =>
  s.telemetry?.source?.provenance === 'REAL'

export const selectCylinders = (s: TwinStore) => s.telemetry?.engine.cylinders
export const selectHealth = (s: TwinStore) => s.telemetry?.engine.health_index ?? null
export const selectPhase = (s: TwinStore) => s.telemetry?.tick.phase ?? 'GROUND'
