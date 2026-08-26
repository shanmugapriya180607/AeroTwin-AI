/**
 * The chart vocabulary of the ground station.
 *
 * One rule runs through all of it: expected and actual are drawn in the same
 * frame, and the residual between them is drawn as its own signed series. A
 * chart of the sensor value alone is the reactive display this project exists
 * to replace.
 */

import { useMemo } from 'react'
import { AXIS, CHART_BASE, EChart } from './EChart'
import type { TrendPoint } from '../../store/useTwin'

const C = {
  expected: '#7691b6',
  actual: '#0b1a2e',
  residual: '#7739e0',
  ok: '#0aa06e',
  caution: '#d99a00',
  warn: '#ef7a1a',
  crit: '#e13232',
  accent: '#0a6ed6',
  grid: '#e3eaf4',
}

export const CYL_COLORS = ['#0a6ed6', '#1668e3', '#ef7a1a', '#7739e0']

/* --------------------------------------------------- Expected vs actual -- */

export function ExpectedActualChart({
  series,
  unit,
  height = 190,
  label,
}: {
  series: TrendPoint[]
  unit: string
  height?: number
  label?: string
}) {
  const option = useMemo(() => {
    const x = series.map((p) => p.t.toFixed(0))
    return {
      ...CHART_BASE,
      legend: {
        show: true,
        top: 0,
        right: 0,
        itemWidth: 14,
        itemHeight: 2,
        textStyle: { color: '#5a7089', fontSize: 9.5 },
        data: ['EXPECTED (PHYSICS)', 'ACTUAL (SENSOR)'],
      },
      grid: { ...CHART_BASE.grid, top: 26 },
      xAxis: { type: 'category', data: x, ...AXIS, boundaryGap: false },
      yAxis: {
        type: 'value',
        scale: true,
        ...AXIS,
        axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${v.toFixed(0)}` },
        name: unit,
        nameTextStyle: { color: '#8496ac', fontSize: 9, align: 'right' },
      },
      series: [
        {
          name: 'EXPECTED (PHYSICS)',
          type: 'line',
          data: series.map((p) => p.expected),
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { color: C.expected, width: 1.4, type: 'dashed' },
          z: 2,
        },
        {
          name: 'ACTUAL (SENSOR)',
          type: 'line',
          data: series.map((p) => p.observed),
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { color: C.actual, width: 1.7 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(11,26,46,0.10)' },
                { offset: 1, color: 'rgba(11,26,46,0)' },
              ],
            },
          },
          z: 3,
        },
      ],
    }
  }, [series, unit])

  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------- Residual chart -- */

export function ResidualChart({
  series,
  unit,
  height = 150,
  threshold,
}: {
  series: TrendPoint[]
  unit: string
  height?: number
  threshold?: number
}) {
  const option = useMemo(() => {
    const values = series.map((p) => p.residual)
    const peak = Math.max(4, ...values.map((v) => Math.abs(v)))
    return {
      ...CHART_BASE,
      grid: { ...CHART_BASE.grid, top: 14, bottom: 20 },
      xAxis: { type: 'category', data: series.map((p) => p.t.toFixed(0)), ...AXIS, boundaryGap: false },
      yAxis: {
        type: 'value',
        min: -peak * 1.15,
        max: peak * 1.15,
        ...AXIS,
        name: unit,
        nameTextStyle: { color: '#8496ac', fontSize: 9 },
      },
      series: [
        {
          name: 'RESIDUAL',
          type: 'line',
          data: values,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: C.residual, width: 1.6 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(119,57,224,0.28)' },
                { offset: 1, color: 'rgba(119,57,224,0.01)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            data: [
              { yAxis: 0, lineStyle: { color: '#b2c1d3', width: 1 } },
              ...(threshold
                ? [
                  { yAxis: threshold, lineStyle: { color: 'rgba(239,122,26,0.5)', type: 'dashed', width: 1 } },
                  { yAxis: -threshold, lineStyle: { color: 'rgba(239,122,26,0.5)', type: 'dashed', width: 1 } },
                ]
                : []),
            ],
          },
        },
      ],
    }
  }, [series, unit, threshold])

  return <EChart option={option} height={height} />
}

/* ------------------------------------------------- Per-cylinder overlay -- */

export function CylinderChart({
  histories,
  field = 'residual',
  unit,
  height = 200,
  highlight,
}: {
  histories: Record<string, TrendPoint[]>
  field?: 'residual' | 'observed' | 'expected'
  unit: string
  height?: number
  highlight?: number
}) {
  const option = useMemo(() => {
    const keys = [1, 2, 3, 4]
    const base = histories.cht_1 ?? []
    return {
      ...CHART_BASE,
      legend: {
        show: true, top: 0, right: 0, itemWidth: 12, itemHeight: 2,
        textStyle: { color: '#5a7089', fontSize: 9.5 },
      },
      grid: { ...CHART_BASE.grid, top: 26 },
      xAxis: { type: 'category', data: base.map((p) => p.t.toFixed(0)), ...AXIS, boundaryGap: false },
      yAxis: { type: 'value', scale: true, ...AXIS, name: unit, nameTextStyle: { color: '#8496ac', fontSize: 9 } },
      series: keys.map((i) => ({
        name: `CYL ${i}`,
        type: 'line',
        data: (histories[`cht_${i}`] ?? []).map((p) => p[field]),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: {
          color: CYL_COLORS[i - 1],
          width: highlight === i ? 2.2 : 1.2,
          opacity: highlight && highlight !== i ? 0.42 : 1,
        },
        z: highlight === i ? 5 : 2,
      })),
    }
  }, [histories, field, unit, highlight])

  return <EChart option={option} height={height} />
}

/* --------------------------------------------------------- Health gauge -- */

export function HealthGauge({ value, height = 200 }: { value: number; height?: number }) {
  const option = useMemo(() => {
    const color = value >= 90 ? C.ok : value >= 78 ? C.caution : value >= 62 ? C.warn : C.crit
    return {
      backgroundColor: 'transparent',
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '96%',
          center: ['50%', '58%'],
          progress: { show: true, width: 9, itemStyle: { color } },
          axisLine: { lineStyle: { width: 9, color: [[1, '#eef3fa']] } },
          pointer: { show: false },
          axisTick: { distance: -16, splitNumber: 5, lineStyle: { color: '#cddaea', width: 1 } },
          splitLine: { distance: -19, length: 8, lineStyle: { color: '#b2c1d3', width: 1 } },
          axisLabel: { distance: -6, color: '#b2c1d3', fontSize: 8.5 },
          anchor: { show: false },
          title: {
            show: true,
            offsetCenter: [0, '32%'],
            color: '#8496ac',
            fontSize: 9.5,
            fontFamily: 'Inter, sans-serif',
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '2%'],
            fontSize: 34,
            fontWeight: 500,
            fontFamily: 'JetBrains Mono, monospace',
            color: '#0b1a2e',
            formatter: (v: number) => v.toFixed(1),
          },
          data: [{ value, name: 'ENGINE HEALTH INDEX' }],
        },
      ],
    }
  }, [value])

  return <EChart option={option} height={height} />
}

/* --------------------------------------------------------- Health trend -- */

export function HealthTrend({
  points,
  height = 130,
}: {
  points: Array<{ label: string; health: number; live?: boolean }>
  height?: number
}) {
  const option = useMemo(() => ({
    ...CHART_BASE,
    grid: { ...CHART_BASE.grid, left: 34, top: 14, bottom: 30 },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.label),
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, rotate: 0, interval: 0, fontSize: 8.5 },
    },
    yAxis: { type: 'value', min: 40, max: 100, ...AXIS },
    series: [
      {
        type: 'line',
        data: points.map((p) => ({
          value: p.health,
          itemStyle: { color: p.live ? C.accent : p.health >= 90 ? C.ok : p.health >= 78 ? C.caution : C.warn },
        })),
        smooth: 0.3,
        symbolSize: 6,
        lineStyle: { color: C.accent, width: 1.6 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(10,110,214,0.20)' },
              { offset: 1, color: 'rgba(10,110,214,0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: true, formatter: 'CAUTION', color: '#8496ac', fontSize: 8.5, position: 'insideEndTop' },
          data: [{ yAxis: 78, lineStyle: { color: 'rgba(217,154,0,0.4)', type: 'dashed', width: 1 } }],
        },
      },
    ],
  }), [points])

  return <EChart option={option} height={height} />
}

/* ------------------------------------------------------- Contributions --- */

export function ContributionBars({
  items,
  height = 150,
}: {
  items: Array<{ label: string; value: number }>
  height?: number
}) {
  const option = useMemo(() => ({
    ...CHART_BASE,
    grid: { left: 6, right: 40, top: 6, bottom: 6, containLabel: true },
    tooltip: { ...CHART_BASE.tooltip, trigger: 'item' },
    xAxis: { type: 'value', show: false, max: Math.max(...items.map((i) => i.value), 0.001) * 1.15 },
    yAxis: {
      type: 'category',
      data: items.map((i) => i.label).reverse(),
      ...AXIS,
      splitLine: { show: false },
      axisLabel: { ...AXIS.axisLabel, fontSize: 9, color: '#5a7089' },
    },
    series: [
      {
        type: 'bar',
        data: items.map((i) => i.value).reverse(),
        barWidth: 9,
        itemStyle: { color: C.residual, borderRadius: [0, 2, 2, 0] },
        label: {
          show: true,
          position: 'right',
          color: '#5a7089',
          fontSize: 9,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: (p: any) => p.value.toFixed(3),
        },
      },
    ],
  }), [items])

  return <EChart option={option} height={height} />
}

/* ----------------------------------------------------------- Sparkline --- */

export function Sparkline({
  values,
  color = C.accent,
  height = 34,
}: {
  values: number[]
  color?: string
  height?: number
}) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 0, right: 0, top: 3, bottom: 3 },
    xAxis: { type: 'category', show: false, data: values.map((_, i) => i), boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: values,
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { color, width: 1.3 },
        areaStyle: { color: `${color}1f` },
      },
    ],
  }), [values, color])

  return <EChart option={option} height={height} />
}

/* -------------------------------------------------- Mission plan profile - */

export function ProfileChart({
  points,
  height = 190,
}: {
  points: Array<{ t: number; altitude: number; residual: number; health: number }>
  height?: number
}) {
  const option = useMemo(() => ({
    ...CHART_BASE,
    legend: {
      show: true, top: 0, right: 0, itemWidth: 13, itemHeight: 2,
      textStyle: { color: '#5a7089', fontSize: 9.5 },
    },
    grid: { left: 48, right: 46, top: 26, bottom: 24 },
    xAxis: {
      type: 'category',
      data: points.map((p) => (p.t / 60).toFixed(0)),
      ...AXIS,
      name: 'MIN',
      nameTextStyle: { color: '#8496ac', fontSize: 9 },
    },
    yAxis: [
      { type: 'value', ...AXIS, name: 'FT', nameTextStyle: { color: '#8496ac', fontSize: 9 } },
      { type: 'value', ...AXIS, name: '°C', nameTextStyle: { color: '#8496ac', fontSize: 9 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: 'ALTITUDE',
        type: 'line',
        data: points.map((p) => p.altitude),
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { color: C.expected, width: 1.4 },
        areaStyle: { color: 'rgba(118,145,182,0.10)' },
      },
      {
        name: 'PEAK RESIDUAL',
        type: 'line',
        yAxisIndex: 1,
        data: points.map((p) => p.residual),
        showSymbol: false,
        smooth: 0.3,
        lineStyle: { color: C.residual, width: 1.7 },
      },
    ],
  }), [points])

  return <EChart option={option} height={height} />
}
