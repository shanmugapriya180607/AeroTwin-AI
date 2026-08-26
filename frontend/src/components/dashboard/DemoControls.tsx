/**
 * Replay and demonstration controls.
 *
 * START DEMO drives the backend's scripted sortie: the engine begins healthy,
 * conditions change, the actual state drifts away from the physics
 * expectation, the residual grows, the detector activates, the explanation and
 * the advisory follow. The aircraft never crashes - the story is early
 * detection, not failure.
 */

import { useState } from 'react'
import { Clapperboard, Gauge, Pause, Play, Radio, Sparkles } from 'lucide-react'
import { api } from '../../services/api'
import { useTwin } from '../../store/useTwin'
import { launchStory } from '../demo/DemoStory'

const SPEEDS = [1, 20, 60, 200]

export function DemoControls() {
  const status = useTwin((s) => s.status)
  const refreshStatus = useTwin((s) => s.refreshStatus)
  const demoRunning = useTwin((s) => s.demoRunning)
  const toggleDemo = useTwin((s) => s.toggleDemo)
  const mode = useTwin((s) => s.mode)
  const storyRunning = useTwin((s) => s.storyStep) >= 0
  const setStoryStep = useTwin((s) => s.setStoryStep)
  const [busy, setBusy] = useState(false)

  const paused = status?.paused ?? false
  const scale = status?.time_scale ?? 20
  const disabled = mode === 'DEMO'

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    await fn()
    await refreshStatus()
    setBusy(false)
  }

  return (
    <div className="row row--tight">
      <div className="btn-group" title={disabled ? 'Backend unavailable - replay rate is fixed in demo mode' : 'Replay rate'}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn btn--sm ${Math.round(scale) === s ? 'btn--active' : ''}`}
            disabled={busy || disabled}
            onClick={() => run(() => api.setSpeed(s))}
          >
            {s}×
          </button>
        ))}
      </div>

      <button
        className="btn btn--icon"
        disabled={busy || disabled}
        title={paused ? 'Resume replay' : 'Pause replay'}
        onClick={() => run(() => (paused ? api.resume() : api.pause()))}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>

      <button
        className="btn btn--icon"
        disabled={busy || disabled}
        title={
          status?.datalink?.connected
            ? 'Simulate data link interruption - the twin holds rather than guessing'
            : 'Restore data link'
        }
        onClick={() => run(() => api.setDatalink(!status?.datalink?.connected))}
      >
        <Radio size={14} color={status?.datalink?.connected ? undefined : 'var(--crit)'} />
      </button>

      <button
        className={`btn btn--sm ${demoRunning ? 'btn--danger' : ''}`}
        disabled={busy || disabled}
        title="Run the backend's scripted sortie: healthy, then a developing deviation"
        onClick={() => run(toggleDemo)}
      >
        {demoRunning ? <Gauge size={13} /> : <Sparkles size={13} />}
        {demoRunning ? 'Stop demo' : 'Start demo'}
      </button>

      {/* The narrated version: ninety seconds, sensor to advisory, with the
          live evidence shown at each beat. */}
      <button
        className={`btn btn--sm ${storyRunning ? 'btn--danger' : 'btn--primary'}`}
        title="Narrated demonstration - the whole chain in ninety seconds"
        onClick={() => (storyRunning ? setStoryStep(-1) : void launchStory())}
      >
        <Clapperboard size={13} />
        {storyRunning ? 'Stop story' : 'Run story'}
      </button>
    </div>
  )
}
