/**
 * Validation.
 *
 * A system that cannot state the boundary of its own competence should not be
 * trusted with a maintenance decision - so the boundary is on screen. It is on
 * screen as tags and numbers, not as prose: the same information, at the
 * density the rest of the console is read at.
 */

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../services/api'
import { AXIS, CHART_BASE, EChart } from '../components/charts/EChart'
import {
  Badge, Empty, Meter, Metrics, PageHead, StatusRows, TagRow, fmt,
} from '../components/ui/Primitives'

/** A limitation reduced to its verdict. The register keeps the detail. */
const GAP_TONE: Record<string, 'crit' | 'warn' | 'caution'> = {
  HIGH: 'crit', MEDIUM: 'warn', LOW: 'caution',
}

/**
 * A one-line reason, for the meta slot on a tag row.
 *
 * Only ever applied to free text the register does not carry a label for -
 * everything with a `tag` uses it, because a label guessed out of a sentence
 * comes back as a fragment.
 */
function reason(text: string, words = 4): string {
  const clause = String(text ?? '').trim().split(/[.;:]/)[0].trim()
  if (!clause) return ''
  return clause.split(/\s+/).slice(0, words).join(' ').toUpperCase()
}

export default function Validation() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    void api.validation().then((result) => result && setData(result))
  }, [])

  const report = data?.report
  const dataset = data?.dataset
  const gap = data?.domain_gap
  const calibration = data?.calibration
  const running = !report || report.status === 'RUNNING'
  /* The reference corpus is only REAL when an operator corpus is mounted; the
     bundled demo flights are a format sample and say so. */
  const corpusMode: string = data?.ngafid?.mode ?? 'DEMO'

  const reliabilityOption = useMemo(() => {
    const bins = report?.reliability ?? []
    if (!bins.length) return null
    const populated = bins.filter((b: any) => b.count > 0)
    return {
      ...CHART_BASE,
      grid: { left: 46, right: 16, top: 18, bottom: 32 },
      legend: {
        show: true, top: 0, right: 0, itemWidth: 12, itemHeight: 2,
        textStyle: { color: '#5a7089', fontSize: 9.5 },
      },
      xAxis: {
        type: 'category',
        data: populated.map((b: any) => b.bin),
        ...AXIS,
        name: 'STATED',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#8496ac', fontSize: 9 },
      },
      yAxis: { type: 'value', min: 0, max: 1, ...AXIS },
      series: [
        {
          name: 'PERFECT',
          type: 'line',
          data: populated.map((b: any) => b.mean_confidence),
          showSymbol: false,
          lineStyle: { color: '#b2c1d3', width: 1, type: 'dashed' },
        },
        {
          name: 'OBSERVED',
          type: 'bar',
          data: populated.map((b: any) => b.observed_accuracy),
          barWidth: '52%',
          itemStyle: { color: '#0a6ed6', borderRadius: [2, 2, 0, 0] },
        },
      ],
    }
  }, [report])

  const fidelityOption = useMemo(() => {
    const rows = report?.model_fidelity ?? []
    if (!rows.length) return null
    return {
      ...CHART_BASE,
      grid: { left: 8, right: 42, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...CHART_BASE.tooltip, trigger: 'item' },
      xAxis: { type: 'value', ...AXIS, name: 'P95 |ERR|', nameTextStyle: { color: '#8496ac', fontSize: 9 } },
      yAxis: {
        type: 'category',
        data: rows.map((r: any) => r.channel).reverse(),
        ...AXIS,
        splitLine: { show: false },
        axisLabel: { ...AXIS.axisLabel, fontSize: 9 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((r: any) => r.p95_abs_error).reverse(),
          barWidth: 8,
          itemStyle: { color: '#7691b6', borderRadius: [0, 2, 2, 0] },
          label: {
            show: true, position: 'right', color: '#5a7089', fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
          },
        },
      ],
    }
  }, [report])

  return (
    <>
      <PageHead
        title="Validation"
        actions={
          <div className="row row--tight">
            <Badge tone={running ? 'caution' : 'ok'} dot live={running}>
              {running ? 'RUNNING' : report.status}
            </Badge>
            <Badge tone="caution">NOT CERTIFIED</Badge>
          </div>
        }
      />

      {/* ---- measured performance ----------------------------------------- */}
      <section className="panel panel--marked" style={{ marginBottom: 16 }}>
        <header className="panel__head">
          <ShieldCheck size={13} color="var(--accent)" />
          <h2 className="panel__title">Measured</h2>
          <span className="panel__spacer" />
          {report && (
            <Badge tone="info">
              {report.trials} TRIALS · {report.positives}P / {report.negatives}N
            </Badge>
          )}
        </header>
        <div className="panel__body panel__body--tight">
          {running ? (
            <Empty label="VALIDATION RUNNING" detail="NO METRIC BEFORE THE HARNESS COMPLETES" />
          ) : (
            <>
              <div className="grid grid--4" style={{ gap: 12, marginBottom: 12 }}>
                {(report.metrics ?? []).map((metric: any) => (
                  <div className="tile" key={metric.key}>
                    <span className="micro">{metric.label}</span>
                    <div
                      className="mono"
                      style={{ fontSize: 26, marginTop: 3, fontWeight: 600, color: 'var(--ink)' }}
                    >
                      {fmt(metric.value, 3)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Meter
                        value={metric.value * 100}
                        tone={
                          metric.key === 'ece' ? (metric.value < 0.1 ? 'ok' : 'caution')
                            : metric.value > 0.85 ? 'ok' : metric.value > 0.65 ? 'caution' : 'warn'
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>

              {report.confusion && (
                <Metrics
                  cells={[
                    { k: 'TRUE POSITIVE', v: String(report.confusion.tp), tone: 'ok' },
                    { k: 'FALSE POSITIVE', v: String(report.confusion.fp), tone: 'warn' },
                    { k: 'FALSE NEGATIVE', v: String(report.confusion.fn), tone: 'warn' },
                    { k: 'TRUE NEGATIVE', v: String(report.confusion.tn), tone: 'ok' },
                    { k: 'SCOPE', v: 'SYNTHETIC', tone: 'warn' },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </section>

      {/* ---- calibration + fidelity ---------------------------------------- */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginBottom: 16 }}>
        <section className="panel">
          <header className="panel__head">
            <h2 className="panel__title">Calibration</h2>
            <span className="panel__spacer" />
            <Badge tone={calibration?.fitted ? 'ok' : 'caution'}>
              {calibration?.fitted ? calibration.method : 'DEFERRED'}
            </Badge>
          </header>
          <div className="panel__body panel__body--tight">
            {reliabilityOption ? (
              <EChart option={reliabilityOption} height={196} />
            ) : (
              <Empty label="PENDING" />
            )}
            {calibration && (
              <StatusRows
                rows={[
                  { k: 'ECE BEFORE', v: fmt(calibration.ece_before, 4) },
                  { k: 'ECE AFTER', v: fmt(calibration.ece_after, 4), tone: 'ok' },
                  { k: 'SAMPLES', v: String(calibration.samples ?? 0) },
                  { k: 'FITTED ON', v: String(calibration.fitted_on ?? '—').toUpperCase() },
                ]}
              />
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2 className="panel__title">Model fidelity</h2>
            <span className="panel__spacer" />
            <Badge tone="info">P95 ABS ERROR</Badge>
          </header>
          <div className="panel__body panel__body--tight">
            {fidelityOption ? (
              <EChart
                option={fidelityOption}
                height={Math.max(200, (report?.model_fidelity?.length ?? 6) * 22)}
              />
            ) : (
              <Empty label="PENDING" />
            )}
          </div>
        </section>
      </div>

      {/* ---- domain gap ---------------------------------------------------- */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <header className="panel__head">
          <TriangleAlert size={13} color="var(--caution)" />
          <h2 className="panel__title">Domain gap</h2>
          <span className="panel__spacer" />
          <Badge tone="real">{gap?.from ?? 'NGAFID-MC'}</Badge>
          <span className="micro">→</span>
          <Badge tone="caution">{gap?.to ?? 'MALE UAV'}</Badge>
        </header>
        <div className="panel__body panel__body--tight">
          <div className="grid grid--2">
            <div>
              <span className="micro" style={{ color: 'var(--ok)' }}>VALIDATED</span>
              <div className="stack stack--sm" style={{ marginTop: 8 }}>
                {(gap?.transfers ?? []).map((item: any, i: number) => (
                  <TagRow
                    key={i}
                    label={item.tag ?? reason(item)}
                    state="TRANSFERS"
                    tone="ok"
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="micro" style={{ color: 'var(--caution)' }}>LIMITATIONS</span>
              <div className="stack stack--sm" style={{ marginTop: 8 }}>
                {(gap?.does_not_transfer ?? []).map((item: any, i: number) => (
                  <TagRow
                    key={i}
                    label={item.tag ?? reason(item)}
                    state="GAP"
                    tone="caution"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- limitations + corpus ------------------------------------------ */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', marginRight: 372 }}
      >
        <section className="panel">
          <header className="panel__head">
            <h2 className="panel__title">Limitations</h2>
            <span className="panel__spacer" />
            <Badge tone="caution">{(data?.limitations ?? []).length}</Badge>
          </header>
          <div className="panel__body panel__body--tight">
            <div className="scroll-y" style={{ maxHeight: 300 }}>
              <div className="stack stack--sm">
                {(data?.limitations ?? []).map((item: any, i: number) => (
                  <TagRow
                    key={i}
                    label={item.tag ?? reason(item.title ?? item.limitation ?? '')}
                    state={item.state ?? String(item.severity ?? 'NOTED').toUpperCase()}
                    tone={GAP_TONE[String(item.severity ?? '').toUpperCase()] ?? 'caution'}
                    meta={item.severity}
                  />
                ))}
                {!data?.limitations?.length && <Empty label="UNAVAILABLE" />}
              </div>
            </div>
            <div className="divider" />
            <span className="micro">OUT OF SCOPE</span>
            <div className="chip-list" style={{ marginTop: 8 }}>
              {(data?.out_of_scope ?? []).slice(0, 8).map((item: any, i: number) => (
                <Badge key={i} tone="neutral">{String(item.item).toUpperCase()}</Badge>
              ))}
            </div>
          </div>
          <footer className="panel__foot">
            <span className="micro">{data?.airworthiness_notice}</span>
          </footer>
        </section>

        <section className="panel">
          <header className="panel__head">
            <BookOpen size={13} color="var(--accent)" />
            <h2 className="panel__title">Reference corpus</h2>
            <span className="panel__spacer" />
            <Badge tone="real">{dataset?.licence ?? 'CC-BY-4.0'}</Badge>
          </header>
          <div className="panel__body panel__body--tight">
            <StatusRows
              rows={[
                { k: 'CORPUS', v: String(dataset?.id ?? 'NGAFID-MC') },
                { k: 'FLIGHTS', v: (dataset?.flights ?? 28935).toLocaleString() },
                { k: 'HOURS', v: (dataset?.flight_hours ?? 31177).toLocaleString() },
                { k: 'CHANNELS', v: `${dataset?.sensors ?? 23} @ ${dataset?.sample_rate_hz ?? 1} HZ` },
                {
                  k: 'MAINT EVENTS',
                  v: (dataset?.maintenance_events ?? 2111).toLocaleString(),
                  tone: 'accent',
                },
                { k: 'ENGINE', v: String(dataset?.engine ?? 'LYCOMING IO-360').toUpperCase() },
                { k: 'POWER', v: `${dataset?.rated_power_hp ?? 180} HP` },
                { k: 'SIZE', v: `${dataset?.size_gb ?? 5.4} GB` },
                {
                  k: 'MOUNTED',
                  v: corpusMode,
                  tone: corpusMode === 'REAL' ? 'ok' : 'dim',
                },
              ]}
            />
            <div className="divider" />
            <span className="micro">REJECTED</span>
            <div className="stack stack--sm" style={{ marginTop: 8 }}>
              {(data?.rejected_datasets ?? []).map((item: any, i: number) => (
                <TagRow
                  key={i}
                  label={String(item.id).toUpperCase()}
                  state={item.verdict ?? 'REJECTED'}
                  tone="crit"
                  meta={reason(item.reason ?? item.detail ?? item.why ?? '', 3)}
                />
              ))}
              {!data?.rejected_datasets?.length && <Empty label="UNAVAILABLE" />}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
