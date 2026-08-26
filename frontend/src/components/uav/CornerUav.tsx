/**
 * The corner UAV card.
 *
 * It is a frame, not a renderer: the actual WebGL canvas lives in UavStage and
 * is positioned over this element. That is what lets the aircraft fly out of
 * the corner rather than being replaced by a different scene.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react'
import { useTwin } from '../../store/useTwin'
import { flightDynamics } from './flight'

export const CornerUav = forwardRef<HTMLDivElement, { hidden?: boolean }>(({ hidden = false }, ref) => {
  const cardRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => cardRef.current as HTMLDivElement)
  const enterMission = useTwin((s) => s.enterMission)
  const collapsed = useTwin((s) => s.cornerCollapsed)
  const toggleCorner = useTwin((s) => s.toggleCorner)
  const mission = useTwin((s) => s.mission)
  const telemetry = useTwin((s) => s.telemetry)
  const mode = useTwin((s) => s.mode)
  const dock = useTwin((s) => s.dock)
  const [docked, setDocked] = useState(false)

  const altRef = useRef<HTMLSpanElement>(null)
  const iasRef = useRef<HTMLSpanElement>(null)
  const rpmRef = useRef<HTMLSpanElement>(null)

  /* Read the flight model directly each frame. These three numbers change
     every tick and re-rendering the card for them would be wasteful. */
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const s = flightDynamics.state
      if (altRef.current) altRef.current.textContent = Math.round(s.altitudeFt).toLocaleString()
      if (iasRef.current) iasRef.current.textContent = s.speedKt.toFixed(0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (rpmRef.current) {
      const rpm = telemetry?.tick?.channels?.rpm ?? mission?.rpm ?? 0
      rpmRef.current.textContent = Math.round(rpm).toLocaleString()
    }
  }, [telemetry, mission])

  /* On the Command Center the card docks into the hero slot instead of sitting
     in the corner.
     
     It stays a fixed-position element in the body rather than moving into the
     slot, because the console shell is its own stacking context and anything
     inside it renders underneath the shared canvas. Instead the card is driven
     onto the slot's rectangle each frame - the same rectangle the 3D stage
     tracks - so the frame and the aircraft inside it stay locked together
     through scrolling and resizing. */
  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    if (dock !== 'HERO') {
      setDocked(false)
      card.style.left = ''
      card.style.top = ''
      card.style.width = ''
      card.style.height = ''
      card.style.right = ''
      card.style.bottom = ''
      return
    }

    let raf = 0
    const follow = () => {
      const slot = document.getElementById('uav-dock')
      const el = cardRef.current
      if (slot && el) {
        const r = slot.getBoundingClientRect()
        el.style.left = `${r.left}px`
        el.style.top = `${r.top}px`
        el.style.width = `${r.width}px`
        el.style.height = `${r.height}px`
        el.style.right = 'auto'
        el.style.bottom = 'auto'
        if (!docked) setDocked(true)
      }
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [dock, docked])

  const phase = telemetry?.tick?.phase ?? mission?.mission?.phase ?? 'GROUND'
  const airborne = phase !== 'GROUND'

  const card = (
    <div
      ref={cardRef}
      className={`uav-card ${docked ? 'uav-card--docked' : collapsed ? 'uav-card--collapsed' : ''}`}
      /* The card lives in the body, so it cannot inherit the console's fade on
         the way into mission mode - it carries its own. */
      style={{
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 420ms var(--ease)',
      }}
      onClick={enterMission}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          enterMission()
        }
      }}
      aria-label="Open mission control - fullscreen 3D view"
    >
      {!docked && <button
        className="uav-card__collapse"
        onClick={(e) => {
          e.stopPropagation()
          toggleCorner()
        }}
        title={collapsed ? 'Expand the UAV view' : 'Collapse the UAV view'}
        aria-label={collapsed ? 'Expand the UAV view' : 'Collapse the UAV view'}
      >
        {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>}

      <header className="uav-card__head">
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.14em', color: 'var(--ink-2)' }}>
          {mission?.mission?.uav_id ?? 'UAV-01'}
        </span>
        <span className="spacer" />
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: '0.14em',
            color: airborne ? 'var(--ok)' : 'var(--ink-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <i className="dot dot--live" style={{ background: airborne ? 'var(--ok)' : 'var(--ink-4)' }} />
          {airborne ? 'AIRBORNE' : 'ON GROUND'}
        </span>
      </header>

      {!collapsed && !docked && <div className="uav-card__hint">
        <span className="uav-card__hint-inner">
          <Maximize2 size={12} strokeWidth={2} />
          Enter mission control
        </span>
      </div>}

      <footer className="uav-card__foot">
        {collapsed && !docked && (
          <div className="stat stat--sm">
            <span className="stat__k">UAV</span>
            <span
              className="stat__v"
              style={{ fontSize: 11, color: airborne ? 'var(--ok)' : 'var(--ink-3)' }}
            >
              {mission?.mission?.uav_id ?? 'UAV-01'}
            </span>
          </div>
        )}
        <div className="stat stat--sm">
          <span className="stat__k">ALT</span>
          <span className="stat__v" style={{ fontSize: 13 }}>
            <span ref={altRef}>0</span>
            <span className="stat__u">ft</span>
          </span>
        </div>
        <div className="stat stat--sm">
          <span className="stat__k">IAS</span>
          <span className="stat__v" style={{ fontSize: 13 }}>
            <span ref={iasRef}>0</span>
            <span className="stat__u">kt</span>
          </span>
        </div>
        <div className="stat stat--sm">
          <span className="stat__k">RPM</span>
          <span className="stat__v" style={{ fontSize: 13 }}>
            <span ref={rpmRef}>0</span>
          </span>
        </div>
        {mode === 'DEMO' && (
          <div className="stat stat--sm">
            <span className="stat__k">SRC</span>
            <span className="stat__v" style={{ fontSize: 11, color: 'var(--demo)' }}>DEMO</span>
          </div>
        )}
      </footer>
    </div>
  )

  // Always in the body: the card is a frame drawn over the canvas, never a
  // container inside the console's stacking context.
  return createPortal(card, document.body)
})

CornerUav.displayName = 'CornerUav'
