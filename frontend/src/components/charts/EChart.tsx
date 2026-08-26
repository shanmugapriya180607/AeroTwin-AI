/**
 * Thin ECharts wrapper.
 *
 * Only the modules the ground station actually draws are registered, which
 * keeps the chart bundle to a fraction of the full library - this has to run
 * alongside a live WebGL scene on a normal laptop.
 */

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, GaugeChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  MarkAreaComponent, DataZoomComponent, TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart, GaugeChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  MarkAreaComponent, DataZoomComponent, TitleComponent,
  CanvasRenderer,
])

export const CHART_BASE = {
  backgroundColor: 'transparent',
  animationDuration: 260,
  animationEasing: 'cubicOut' as const,
  textStyle: { fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 10 },
  grid: { left: 46, right: 14, top: 18, bottom: 24, containLabel: false },
  tooltip: {
    trigger: 'axis' as const,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: '#cddaea',
    borderWidth: 1,
    padding: [7, 10],
    textStyle: { color: '#0b1a2e', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
    axisPointer: { type: 'line' as const, lineStyle: { color: '#cddaea', width: 1 } },
  },
}

export const AXIS = {
  axisLine: { lineStyle: { color: '#e3eaf4' } },
  axisTick: { show: false },
  axisLabel: { color: '#8496ac', fontSize: 9.5 },
  splitLine: { lineStyle: { color: 'rgba(205,218,234,0.9)', type: 'dashed' as const } },
}

export function EChart({
  option,
  height = 180,
  className = '',
  onClick,
}: {
  option: Record<string, any>
  height?: number | string
  className?: string
  onClick?: (params: any) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    const observer = new ResizeObserver(() => chart.current?.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    if (!chart.current) return
    chart.current.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  useEffect(() => {
    if (!chart.current || !onClick) return
    chart.current.on('click', onClick)
    return () => {
      chart.current?.off('click', onClick)
    }
  }, [onClick])

  return <div ref={ref} className={className} style={{ width: '100%', height }} />
}
