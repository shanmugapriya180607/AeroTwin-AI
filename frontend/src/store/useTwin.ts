/**
 * The single source of truth for the interface.
 *
 * Frames arrive over four websockets from the ground-station backend. If those
 * cannot be established the store attaches the local transport instead and
 * flips `mode` to DEMO, so every panel keeps rendering and every value on
 * screen is labelled for what it is. Nothing in the UI reads the network
 * directly.
 *
 * What this file does *not* own any more is time. Every timer that advanced
 * simulation state used to live here - a 220 ms interval driving the local
 * model, a watchdog, a status poll - and the one driving the model knew
 * nothing about the paused flag, which is why PAUSE did not pause. The clock
 * now lives in `simulation/SimulationEngine`, this store subscribes to it, and
 * frames that arrive while the simulation is held are dropped at the gate.
 */

import { create } from 'zustand'
import { api, onConnectivity } from '../services/api'
import { connectAll, topicSocket, type SocketState } from '../services/ws'
import {
  LiveTransport, LocalTransport, simulation, type SimulationSnapshot,
} from '../simulation'
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

/** How long to wait for a live frame before concluding there is no backend. */
const LIVE_GRACE_MS = 6000

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
  /** True while the backend is replaying the compressed demonstration sortie
   *  rather than a routine one. Distinct from the simulation status. */
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

  /** Simulation control. Every one of these goes through the engine; nothing
   *  in the UI commands the backend directly. */
  startDemo: () => Promise<void>
  pauseSim: () => Promise<void>
  resumeSim: () => Promise<void>
  /** Pull the frame the twin is holding at. Used after PAUSE and STEP, where
   *  no frame arrives over the socket by design. */
  syncHeldFrame: () => Promise<void>
  /** Release a backend left held by an earlier session. */
  releaseIfHeld: () => Promise<void>
  stopSim: () => Promise<void>
  resetSim: () => Promise<void>
  stepSim: () => Promise<void>
  setSpeed: (speed: number) => Promise<void>

  topAnomaly: () => Anomaly | null
}

let started = false
/** Set once a live frame has been seen, so the grace timer knows not to fall
 *  back and the reconnect path knows which transport belongs in the seat. */
let liveSeen = false
let graceTimer: number | null = null
let statusPoll: number | null = null

const live = new LiveTransport(false)
const liveDemo = new LiveTransport(true)
const local = new LocalTransport()

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
      // An abstained frame contributes no point. A gap in the trend is the
      // truth; a zero would be a health verdict the twin declined to give.
      const health = frame.engine.health_index
      const trail = health === null || health === undefined
        ? healthTrail
        : [...healthTrail.slice(-HISTORY + 1), { t, health }]
      set({ history: next, healthTrail: trail })
    }

    // -- the local model -------------------------------------------------
    // One listener, fired by the engine's clock and only while it is running.
    // This is the whole of the local feed's timing: it has none of its own.
    simulation.onAdvance(() => {
      if (simulation.transportKind !== 'LOCAL') return
      const frames = local.frames()
      set({
        telemetry: frames.telemetry,
        residuals: frames.residualFrame,
        alerts: frames.alerts,
        mission: frames.mission,
      })
      pushHistory(frames.telemetry)
    })

    // -- live sockets ----------------------------------------------------
    topicSocket('telemetry').subscribe((message) => {
      if (!message?.tick) return
      onLiveFrame()
      // The gate. A frame that arrives after PAUSE - already in flight when
      // the command went out - must not move a single number on screen.
      if (!simulation.observeFrame(message.tick.t)) return
      set({ mode: 'LIVE', telemetry: message as TelemetryFrame })
      pushHistory(message as TelemetryFrame)
    })

    topicSocket('residuals').subscribe((message) => {
      if (!message?.channels) return
      if (simulation.getState().status !== 'running') return
      set({ residuals: message as ResidualFrame })
    })

    topicSocket('alerts').subscribe((message) => {
      if (!message?.anomalies) return
      if (simulation.getState().status !== 'running') return
      set({ alerts: message as AlertFrame })
      if (message.log) set({ log: message.log })
      const current = get().selectedAnomaly
      if (!current && message.anomalies.length) {
        set({ selectedAnomaly: message.anomalies[0].id })
      }
    })

    topicSocket('mission').subscribe((message) => {
      if (!message?.mission) return
      if (simulation.getState().status !== 'running') return
      // The sortie length is only known once the backend has said what it is
      // replaying; until then the progress bar has no honest denominator.
      simulation.setTotalSteps(Number(message.mission?.duration_s) || 0)
      set({ mission: message as MissionFrame })
    })

    topicSocket('telemetry').onState((state) => set({ socketState: state }))

    simulation.attach(live)
    connectAll()

    /** The backend answered. Take the live seat and adopt the sortie already
     *  in progress rather than making the operator press START to see it. */
    function onLiveFrame() {
      if (liveSeen) return
      liveSeen = true
      if (graceTimer !== null) {
        window.clearTimeout(graceTimer)
        graceTimer = null
      }
      simulation.attach(live)
      simulation.adopt(Number(get().mission?.mission?.duration_s) || 0)
      set({ mode: 'LIVE' })
      // The ground station keeps its paused flag between console sessions, so
      // a pause left over from an earlier one would open this console onto a
      // sortie where nothing moves. Opening it is an intent to watch, so a
      // held stream is released rather than presented frozen.
      void get().releaseIfHeld()
    }

    /** No backend. Hand the seat to the in-browser model so the console is
     *  demonstrable on a static host, and label everything DEMO. */
    function fallBackToLocal() {
      if (liveSeen || simulation.transportKind === 'LOCAL') return
      simulation.attach(local)
      simulation.adopt(local.feed.duration)
      set({ mode: 'DEMO' })
    }

    graceTimer = window.setTimeout(() => {
      graceTimer = null
      if (!get().telemetry) fallBackToLocal()
    }, LIVE_GRACE_MS)

    onConnectivity((up) => {
      if (!up && !get().telemetry) fallBackToLocal()
    })

    void get().refreshStatus()
    void api.sector().then((sector) => sector && set({ sector }))
    statusPoll = window.setInterval(() => void get().refreshStatus(), 8000)
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
    // Captured before the request goes out. If the operator issues a command
    // while it is in flight, the answer describes a state that no longer
    // exists and must not be allowed to reverse the command.
    const epoch = simulation.commandEpoch
    const status = await api.systemStatus()
    if (!status) return
    set({ status, demoRunning: !!status.demo_active })
    // In LIVE mode the backend owns the clock, so it is the authority on
    // whether anything is advancing. This is what catches a server paused or
    // released from somewhere else - another tab, a restart, a stale session.
    simulation.reconcile(!!status.paused, epoch)
  },

  // -- simulation control -------------------------------------------------

  /**
   * START DEMO.
   *
   * Runs the full start-up sequence against whichever transport is available,
   * and falls back to the local model if the backend refuses or disappears
   * mid-start. It never leaves the operator with a button that did nothing:
   * either the simulation starts, or the failure is on screen with its reason.
   */
  startDemo: async () => {
    set({ history: {}, healthTrail: [], alerts: null })
    if (liveSeen || simulation.transportKind === 'LIVE') {
      simulation.attach(liveDemo)
      await simulation.restart()
      if (simulation.getState().status !== 'error') {
        await get().refreshStatus()
        return
      }
      // The backend went away between the last frame and this command.
      liveSeen = false
    }
    simulation.attach(local)
    set({ mode: 'DEMO' })
    await simulation.restart()
  },

  pauseSim: async () => {
    await simulation.pause()
    // The frame the twin is actually holding at. The websocket will not send
    // another - that is what being held means - so it is pulled once here,
    // and the panels show the sample the index refers to.
    if (simulation.transportKind === 'LIVE') await get().syncHeldFrame()
  },

  resumeSim: async () => {
    await simulation.resume()
    await get().refreshStatus()
  },

  stopSim: async () => {
    await simulation.stop()
    await get().refreshStatus()
  },

  resetSim: async () => {
    await simulation.reset()
    set({
      history: {}, healthTrail: [], alerts: null, residuals: null,
      selectedAnomaly: null, demoRunning: false,
    })
    await get().refreshStatus()
  },

  stepSim: async () => {
    await simulation.step()
    // The backend advanced one sample while held, so the websocket will not
    // push. Pull the frame the step produced.
    if (simulation.transportKind === 'LIVE') await get().syncHeldFrame()
  },

  releaseIfHeld: async () => {
    const status = await api.systemStatus()
    if (!status?.paused) return
    await simulation.release()
    await get().refreshStatus()
  },

  syncHeldFrame: async () => {
    const [frame, residuals, alerts] = await Promise.all([
      api.telemetry(), api.residuals(), api.anomalies(),
    ])
    if (frame?.tick) {
      set({ telemetry: frame as TelemetryFrame })
      pushHistoryExternal(frame as TelemetryFrame)
    }
    if (residuals?.channels) set({ residuals: residuals as ResidualFrame })
    if (alerts?.anomalies) set({ alerts: alerts as AlertFrame })
  },

  setSpeed: async (speed) => {
    await simulation.setSpeed(speed)
    await get().refreshStatus()
  },

  topAnomaly: () => {
    const alerts = get().alerts
    if (!alerts?.anomalies?.length) return null
    const selected = get().selectedAnomaly
    return alerts.anomalies.find((a) => a.id === selected) ?? alerts.anomalies[0]
  },
}))

/** The history push, reachable from an action rather than only from the
 *  socket handler. STEP is the one path that produces a frame without one. */
function pushHistoryExternal(frame: TelemetryFrame) {
  const { history, healthTrail } = useTwin.getState()
  const next: Record<string, TrendPoint[]> = { ...history }
  const t = frame.tick.t
  for (const key of Object.keys(frame.tick.channels)) {
    const series = next[key] ? next[key].slice(-HISTORY + 1) : []
    series.push({
      t,
      observed: frame.tick.channels[key],
      expected: frame.tick.expected?.[key] ?? frame.tick.channels[key],
      residual: frame.tick.residuals?.[key]?.r ?? 0,
    })
    next[key] = series
  }
  const health = frame.engine.health_index
  useTwin.setState({
    history: next,
    healthTrail: health === null || health === undefined
      ? healthTrail
      : [...healthTrail.slice(-HISTORY + 1), { t, health }],
  })
}

/** Release the store's own timers. The engine releases its own. */
export function disposeTwin(): void {
  if (graceTimer !== null) window.clearTimeout(graceTimer)
  if (statusPoll !== null) window.clearInterval(statusPoll)
  graceTimer = null
  statusPoll = null
  simulation.dispose()
  started = false
}

/** Keep a snapshot of the simulation on the store for components that already
 *  subscribe here, without making them import the engine as well. */
export function simulationSnapshot(): SimulationSnapshot {
  return simulation.getState()
}

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
