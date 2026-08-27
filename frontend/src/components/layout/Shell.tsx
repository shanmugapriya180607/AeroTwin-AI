import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, Boxes, Cpu, Database, GaugeCircle, LayoutGrid,
  FolderSearch, LineChart, Map, Plane, PlayCircle, RotateCcw, ShieldCheck, Wrench,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTwin } from '../../store/useTwin'
import { Badge } from '../ui/Primitives'
import { Wordmark } from '../brand/Wordmark'

interface NavLinkItem {
  to: string
  label: string
  icon: typeof LayoutGrid
  end?: boolean
  badge?: boolean
}

interface NavSeparator {
  sep: true
}

export const NAV: Array<NavLinkItem | NavSeparator> = [
  { to: '/dashboard', label: 'COMMAND CENTER', icon: LayoutGrid, end: true },
  { to: '/twin', label: 'DIGITAL TWIN', icon: Cpu },
  { to: '/engine', label: 'ENGINE HEALTH', icon: GaugeCircle },
  { to: '/telemetry', label: 'TELEMETRY', icon: Activity },
  { to: '/anomalies', label: 'ANOMALIES', icon: AlertTriangle, badge: true },
  { to: '/prognostics', label: 'PROGNOSTICS', icon: LineChart },
  { to: '/maintenance', label: 'MAINTENANCE', icon: Wrench },
  { sep: true },
  { to: '/simulation', label: 'MISSION SIMULATION', icon: PlayCircle },
  { to: '/mission', label: 'MISSION CONTROL', icon: Map },
  { sep: true },
  { to: '/architecture', label: 'ARCHITECTURE', icon: Boxes },
  { to: '/data', label: 'DATA & MODELS', icon: Database },
  { to: '/dataset', label: 'DATASET', icon: FolderSearch },
  { to: '/validation', label: 'VALIDATION', icon: ShieldCheck },
]

export function NavRail() {
  const alerts = useTwin((s) => s.alerts)
  const count = alerts?.anomalies?.filter((a) => !a.abstained && a.score >= 0.3).length ?? 0
  const location = useLocation()

  return (
    <nav className="rail shell__rail" aria-label="Primary">
      {NAV.map((item, i) => {
        if ('sep' in item) return <div key={`sep-${i}`} className="rail__sep" />
        const Icon = item.icon
        const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`rail__item ${active ? 'rail__item--active' : ''}`}
            aria-label={item.label}
          >
            <Icon size={17} strokeWidth={1.6} />
            {item.badge && count > 0 && <span className="rail__badge">{count}</span>}
            <span className="rail__tip">{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export function TopBar({ actions }: { actions?: ReactNode }) {
  const status = useTwin((s) => s.status)
  const telemetry = useTwin((s) => s.telemetry)
  const mission = useTwin((s) => s.mission)
  const mode = useTwin((s) => s.mode)
  const replayIntro = useTwin((s) => s.replayIntro)
  const navigate = useNavigate()

  const datalink = telemetry?.datalink
  const twinState = status?.twin?.state ?? datalink?.twin_state ?? '—'
  const syncPct = telemetry?.engine?.sync_pct ?? status?.twin?.sync_pct

  return (
    <header className="topbar shell__topbar">
      <div className="brand">
        <Wordmark size={14} />
      </div>

      <div className="topbar__ident">
        <div className="ident">
          <span className="ident__k">UAV</span>
          <span className="ident__v">{mission?.mission?.uav_id ?? 'UAV-01'}</span>
        </div>
        <div className="ident">
          <span className="ident__k">Mission</span>
          <span className="ident__v">{mission?.mission?.id ?? 'ISR-047'}</span>
        </div>
        <div className="ident">
          <span className="ident__k">Engine</span>
          <span className="ident__v">{telemetry?.engine?.engine_id ?? 'AERO-01'}</span>
        </div>
        <div className="ident">
          <span className="ident__k">Phase</span>
          <span className="ident__v">{telemetry?.tick?.phase ?? '—'}</span>
        </div>
      </div>

      <span className="topbar__spacer" />

      <div className="topbar__status">
        <Badge tone={mode === 'DEMO' ? 'demo' : status?.system === 'ONLINE' ? 'ok' : 'caution'} dot live>
          {mode === 'DEMO' ? 'DEMO MODE' : status?.system ?? 'CONNECTING'}
        </Badge>
        <Badge tone={datalink?.connected === false ? 'crit' : 'ok'} dot live={datalink?.connected !== false}>
          {datalink?.connected === false ? 'DATA LINK LOST' : 'DATA LINK CONNECTED'}
        </Badge>
        <Badge tone={twinState.startsWith('SYNCHRON') ? 'info' : 'caution'} dot>
          TWIN {twinState}
          {syncPct !== undefined && syncPct !== null ? ` · ${syncPct.toFixed(1)}%` : ''}
        </Badge>
        {/* The full first-entry sequence, on demand. */}
        <button
          className="btn btn--icon"
          onClick={() => { replayIntro(); navigate('/intro') }}
          title="Replay the introduction"
          aria-label="Replay the introduction"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="btn btn--icon"
          onClick={() => navigate('/uav')}
          title="Open the UAV showcase"
          aria-label="Open the UAV showcase"
        >
          <Plane size={13} />
        </button>
      </div>

      {actions && <div className="topbar__actions">{actions}</div>}
    </header>
  )
}
