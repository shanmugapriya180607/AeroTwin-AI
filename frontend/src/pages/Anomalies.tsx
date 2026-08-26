/**
 * Anomalies and explainability.
 *
 * Left: everything the detector is tracking, including the ones it has
 * abstained on. Right: the full answer to "why was this alert generated?".
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import { api } from '../services/api'
import { useTwin } from '../store/useTwin'
import { ExplainPanel } from '../components/anomaly/Explain'
import { ExpectedActualChart, ResidualChart } from '../components/charts/Charts'
import {
  Badge, Empty, Kv, Note, PageHead, StatusRows, fmt, pct, signed,
} from '../components/ui/Primitives'

export default function Anomalies() {
  const alerts = useTwin((s) => s.alerts)
  const history = useTwin((s) => s.history)
  const selectedId = useTwin((s) => s.selectedAnomaly)
  const setAnomaly = useTwin((s) => s.setAnomaly)
  const setCylinder = useTwin((s) => s.setCylinder)

  const [explanation, setExplanation] = useState<any>(null)
  const [mlStatus, setMlStatus] = useState<any>(null)

  const anomalies = alerts?.anomalies ?? []
  const selected = anomalies.find((a) => a.id === selectedId) ?? anomalies[0] ?? null

  useEffect(() => {
    void api.mlStatus().then((data) => data && setMlStatus(data))
  }, [])

  useEffect(() => {
    if (!selected) return
    if (selected.cylinder) setCylinder(selected.cylinder)
    void api.explain(selected.id).then((data) => setExplanation(data))
  }, [selected?.id, selected?.cylinder, setCylinder])

  const channelKey = selected?.cylinder ? `cht_${selected.cylinder}` : 'cht_1'
  const series = history[channelKey] ?? []

  const active = anomalies.filter((a) => !a.abstained)
  const abstained = anomalies.filter((a) => a.abstained)

  return (
    <>
      <PageHead
        title="Anomaly Detection"
        actions={
          <div className="row row--tight">
            <Badge tone={active.length ? 'crit' : 'ok'} dot live={!!active.length}>
              {active.length} ACTIVE
            </Badge>
            <Badge>{abstained.length} ABSTAINED</Badge>
            {mlStatus?.learned_model && (
              <Badge tone={mlStatus.learned_model.trained ? 'info' : 'caution'}>
                {mlStatus.learned_model.name} · {mlStatus.learned_model.state}
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 0.9fr) minmax(0, 1.4fr)', marginBottom: 16 }}>
        {/* ---- list ------------------------------------------------------- */}
        <section className="panel">
          <header className="panel__head">
            <AlertTriangle size={13} color="var(--crit)" />
            <h2 className="panel__title">Tracked deviations</h2>
            <span className="panel__spacer" />
            <Badge tone="residual">RANKED BY SCORE</Badge>
          </header>
          <div className="panel__body panel__body--tight">
            {!anomalies.length && (
              <Empty
                label="No deviation tracked"
                detail="ALL CHANNELS INSIDE RESIDUAL SCALE"
              />
            )}
            <div className="stack stack--sm">
              {anomalies.map((anomaly) => (
                <button
                  key={anomaly.id}
                  className={`alert ${anomaly.abstained ? 'alert--abstain' : `alert--${anomaly.severity.toLowerCase()}`} ${selected?.id === anomaly.id ? 'alert--selected' : ''}`}
                  onClick={() => setAnomaly(anomaly.id)}
                  style={{ textAlign: 'left', width: '100%' }}
                >
                  <span className="alert__rank">{String(anomaly.rank).padStart(2, '0')}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="alert__title">{anomaly.title}</div>
                    <div className="alert__sub">
                      {signed(anomaly.residual, 1)} {anomaly.residual_unit} · {anomaly.trend} ·{' '}
                      {anomaly.regime_count} regime{anomaly.regime_count === 1 ? '' : 's'} ·{' '}
                      {anomaly.flights} flight{anomaly.flights === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                    <Badge tone={anomaly.abstained ? 'neutral' : anomaly.severity === 'HIGH' ? 'crit' : 'warn'}>
                      {anomaly.abstained ? 'ABSTAIN' : anomaly.severity}
                    </Badge>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)' }}>
                      score {fmt(anomaly.score, 2)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---- explanation ------------------------------------------------ */}
        <section className="panel panel--glow">
          <header className="panel__head">
            <h2 className="panel__title">Why</h2>
            <span className="panel__spacer" />
            {selected && (
              <Badge tone={selected.abstained ? 'neutral' : 'warn'}>
                {selected.abstained ? 'NO DIAGNOSIS ISSUED' : selected.mechanism_qualifier}
              </Badge>
            )}
          </header>
          <div className="panel__body">
            <ExplainPanel anomaly={selected} />
          </div>
        </section>
      </div>

      {/* ---- residual evidence -------------------------------------------- */}
      {selected && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginBottom: 16 }}>
          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Evidence · expected vs actual</h2>
              <span className="panel__spacer" />
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{channelKey.toUpperCase()}</span>
            </header>
            <div className="panel__body panel__body--tight">
              {series.length > 3 ? (
                <ExpectedActualChart series={series} unit={selected.residual_unit} height={186} />
              ) : (
                <div className="skeleton" style={{ height: 186 }} />
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Evidence · residual</h2>
              <span className="panel__spacer" />
              <Badge tone="residual">ACTUAL − EXPECTED</Badge>
            </header>
            <div className="panel__body panel__body--tight">
              {series.length > 3 ? (
                <ResidualChart series={series} unit={selected.residual_unit} height={186} threshold={6} />
              ) : (
                <div className="skeleton" style={{ height: 186 }} />
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---- detector stack ------------------------------------------------ */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginRight: 372 }}>
        <section className="panel">
          <header className="panel__head">
            <Layers size={13} color="var(--accent)" />
            <h2 className="panel__title">Detector stack</h2>
          </header>
          <div className="panel__body">
            {mlStatus ? (
              <div className="stack">
                <div className="tile">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="label" style={{ color: 'var(--ink-2)' }}>{mlStatus.baseline_model.name}</span>
                    <span className="spacer" />
                    <Badge tone="ok">{mlStatus.baseline_model.state}</Badge>
                  </div>
                </div>

                <div className="tile">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="label" style={{ color: 'var(--ink-2)' }}>{mlStatus.learned_model.name}</span>
                    <span className="spacer" />
                    <Badge tone={mlStatus.learned_model.trained ? 'info' : 'caution'}>
                      {mlStatus.learned_model.state}
                    </Badge>
                  </div>
                  <Kv
                    items={[
                      ['Supervision', mlStatus.learned_model.supervision],
                      ['Input', mlStatus.learned_model.input],
                      ['Features', String(mlStatus.learned_model.feature_count)],
                      ['Trees', String(mlStatus.learned_model.n_estimators)],
                      ['Training samples', String(mlStatus.learned_model.train_samples ?? 0)],
                    ]}
                  />
                </div>

                <Note tone="info">{mlStatus.fusion.rule}</Note>
              </div>
            ) : (
              <Empty label="UNAVAILABLE" detail="RUNNING ON DEMO FEED" />
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2 className="panel__title">Fault classification</h2>
            <span className="panel__spacer" />
            <Badge tone="caution">
              {mlStatus?.fault_classification?.state ?? 'INSUFFICIENT LABEL SUPPORT'}
            </Badge>
          </header>
          <div className="panel__body">
            <StatusRows
              rows={[
                { k: 'LABELS', v: 'FLIGHT LEVEL', tone: 'dim' },
                { k: 'PER-CYLINDER', v: 'UNLABELLED', tone: 'warn' },
                { k: 'CLASSIFIER', v: 'NOT TRAINED', tone: 'warn' },
                { k: 'DIAGNOSIS', v: 'UNSUPERVISED + MECHANISM' },
                { k: 'REPORTED AS', v: 'LIKELY CONTRIBUTING', tone: 'accent' },
              ]}
            />
            {mlStatus?.fault_classification?.what_would_change_it && (
              <div style={{ marginTop: 14 }}>
                <span className="micro">WHAT WOULD CHANGE THIS</span>
              </div>
            )}
            {explanation?.recommendation && (
              <>
                <div className="divider" />
                <span className="micro">RECOMMENDATION</span>
                <p style={{ fontSize: 'var(--t-body)', marginTop: 5, fontWeight: 600 }}>
                  {explanation.recommendation.action ?? explanation.recommendation}
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
