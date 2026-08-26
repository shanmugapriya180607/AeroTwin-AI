import { Suspense, lazy, useEffect, useRef } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { introSeen, useTwin } from './store/useTwin'
import { NavRail, TopBar } from './components/layout/Shell'
import { CornerUav } from './components/uav/CornerUav'
import { UavStage } from './components/uav/UavStage'
import { MissionHud } from './components/mission/MissionHud'
import { BootSequence } from './components/cinematic/BootSequence'
import { DemoControls } from './components/dashboard/DemoControls'
import { DemoStory } from './components/demo/DemoStory'
import { Loading } from './components/ui/Primitives'
import { RenderBoundary } from './components/ui/Boundary'

import CommandCenter from './pages/CommandCenter'

const DigitalTwin = lazy(() => import('./pages/DigitalTwin'))
const EngineHealth = lazy(() => import('./pages/EngineHealth'))
const Telemetry = lazy(() => import('./pages/Telemetry'))
const Anomalies = lazy(() => import('./pages/Anomalies'))
const Prognostics = lazy(() => import('./pages/Prognostics'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const Simulation = lazy(() => import('./pages/Simulation'))
const MissionControl = lazy(() => import('./pages/MissionControl'))
const Architecture = lazy(() => import('./pages/Architecture'))
const DataModels = lazy(() => import('./pages/DataModels'))
const Validation = lazy(() => import('./pages/Validation'))

/* The two cinematic routes each carry a renderer, a scene and an engine
   assembly. Splitting them out keeps all of that off the returning operator's
   path to the console. */
const IntroExperience = lazy(() =>
  import('./components/intro/IntroExperience').then((m) => ({ default: m.IntroExperience })),
)
const UavShowcase = lazy(() => import('./pages/UavShowcase'))

/**
 * Route change is a camera move, not a cut.
 *
 * Each screen enters from the direction of the subject it is about: the twin
 * and the engine push in toward the machine, the mission screens pull out
 * toward the sector, the reference screens slide laterally.
 */
const ENTRY: Record<string, { x?: number; y?: number; scale?: number }> = {
  '/': { y: 10, scale: 0.996 },
  '/dashboard': { y: 10, scale: 0.996 },
  '/twin': { scale: 0.965 },
  '/engine': { scale: 0.965 },
  '/telemetry': { y: 12 },
  '/anomalies': { y: 12 },
  '/prognostics': { y: 12 },
  '/maintenance': { scale: 0.972 },
  '/simulation': { scale: 1.028 },
  '/mission': { scale: 1.035 },
  '/architecture': { x: 22 },
  '/data': { x: 22 },
  '/validation': { x: 22 },
}

function PageFrame({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const entry = ENTRY[location.pathname] ?? { y: 10 }

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, filter: 'blur(5px)', ...entry }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** A single instrument sweep across the screen when the route changes. */
function RouteSweep() {
  const location = useLocation()
  return (
    <AnimatePresence>
      <motion.div
        key={location.pathname}
        className="route-sweep"
        initial={{ opacity: 0.5, scaleX: 0 }}
        animate={{ opacity: 0, scaleX: 1 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      />
    </AnimatePresence>
  )
}

/* -------------------------------------------------------------- routes --- */

/** The film. Entering it hands over to the aircraft showcase. */
function IntroRoute() {
  const navigate = useNavigate()
  const setIntroPhase = useTwin((s) => s.setIntroPhase)

  return (
    <RenderBoundary label="intro">
      <Suspense fallback={<div className="intro-preload" />}>
        <IntroExperience
          onEnter={() => {
            setIntroPhase('READY')
            navigate('/uav')
          }}
        />
      </Suspense>
    </RenderBoundary>
  )
}

function ShowcaseRoute() {
  return (
    <Suspense fallback={<div className="intro-preload" />}>
      <UavShowcase />
    </Suspense>
  )
}

/* ------------------------------------------------------------- console --- */

function Console() {
  const introPhase = useTwin((s) => s.introPhase)
  const setIntroPhase = useTwin((s) => s.setIntroPhase)
  const flightMode = useTwin((s) => s.flightMode)
  /* The narrated demonstration takes the fullscreen frame for itself. Its own
     chrome replaces the mission HUD, which would otherwise fight it for the
     same four corners. */
  const storyRunning = useTwin((s) => s.storyStep) >= 0
  const location = useLocation()
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)

  const inMission = flightMode === 'MISSION' || flightMode === 'TRANSITION_OUT'
  const dashboardVisible = flightMode === 'DASHBOARD' || flightMode === 'TRANSITION_IN'

  /* The route drives the ambient wash behind the console, so moving between
     screens reads as moving between environments. */
  useEffect(() => {
    document.body.dataset.route = location.pathname
  }, [location.pathname])

  return (
    <>
      {introPhase === 'BOOT' && (
        <BootSequence
          onDone={() => setIntroPhase('READY')}
          onReplay={() => navigate('/intro')}
        />
      )}

      {/* The dashboard recedes rather than disappearing, so the UAV reads as
          flying past it rather than replacing it. */}
      <motion.div
        className="shell"
        animate={{
          opacity: inMission ? 0 : 1,
          scale: inMission ? 1.06 : 1,
          filter: inMission ? 'blur(9px)' : 'blur(0px)',
        }}
        transition={{ duration: inMission ? 1.1 : 0.75, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: inMission ? 'none' : 'auto' }}
        aria-hidden={inMission}
      >
        <TopBar actions={<DemoControls />} />
        <NavRail />
        <main className="shell__main">
          <RouteSweep />
          <Suspense fallback={<Loading height={280} />}>
            <PageFrame>
              <Routes>
                <Route path="/dashboard" element={<CommandCenter />} />
                <Route path="/twin" element={<DigitalTwin />} />
                <Route path="/engine" element={<EngineHealth />} />
                <Route path="/telemetry" element={<Telemetry />} />
                <Route path="/anomalies" element={<Anomalies />} />
                <Route path="/prognostics" element={<Prognostics />} />
                <Route path="/maintenance" element={<Maintenance />} />
                <Route path="/simulation" element={<Simulation />} />
                <Route path="/mission" element={<MissionControl />} />
                <Route path="/architecture" element={<Architecture />} />
                <Route path="/data" element={<DataModels />} />
                <Route path="/validation" element={<Validation />} />
                <Route path="*" element={<CommandCenter />} />
              </Routes>
            </PageFrame>
          </Suspense>
        </main>
      </motion.div>

      {/* The frame for the shared 3D stage. Hidden in mission mode, but the
          stage under it never unmounts. */}
      <CornerUav ref={cardRef} hidden={!dashboardVisible} />

      <UavStage cardRef={cardRef} />

      <AnimatePresence>
        {flightMode === 'MISSION' && !storyRunning && <MissionHud />}
      </AnimatePresence>

      <DemoStory />
    </>
  )
}

/* ----------------------------------------------------------------- app --- */

export default function App() {
  const start = useTwin((s) => s.start)
  const navigate = useNavigate()
  const location = useLocation()

  /* The twin streams from the moment the tab opens, whichever experience is
     on screen: the showcase reads the same numbers the console does. */
  useEffect(() => {
    start()
  }, [start])

  /* The entry gate.
   *
   * A first-time visitor gets the whole film; anyone who has seen it lands on
   * the console. This is a redirect rather than a route of its own on purpose:
   * a `/` route would unmount the console every time something navigated home,
   * taking the never-unmounted 3D stage and the flight model with it. */
  const gated = useRef(false)
  useEffect(() => {
    if (gated.current) return
    gated.current = true
    if (location.pathname === '/' && !introSeen()) navigate('/intro', { replace: true })
  }, [location.pathname, navigate])

  return (
    <Routes>
      <Route path="/intro" element={<IntroRoute />} />
      <Route path="/uav" element={<ShowcaseRoute />} />
      <Route path="*" element={<Console />} />
    </Routes>
  )
}
