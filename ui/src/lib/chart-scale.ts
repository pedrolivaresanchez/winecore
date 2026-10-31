import { useLayoutEffect, useRef, useState } from 'react'

export type Plot = { left: number; top: number; width: number; height: number }

export type ChartDatum = {
  key: string
  label: string
  axis: string
  value: number
  previous: number | null
}

export const SERIES_CURRENT = 'var(--color-chart-ink)'
export const SERIES_PREVIOUS = 'var(--color-chart-4)'

export function niceScale(min: number, max: number, targetTicks = 4): { ticks: number[]; min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min === 0 && max === 0)) {
    return { ticks: [0, 1], min: 0, max: 1 }
  }
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const span = hi - lo || Math.abs(hi) || 1
  const rough = span / Math.max(1, targetTicks)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / (magnitude || 1)
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * (magnitude || 1)
  const safe = step || 1
  const start = Math.floor(lo / safe) * safe
  const end = Math.ceil((hi - start) / safe) * safe + start
  const ticks: number[] = []
  for (let value = start; value <= end + safe * 0.001 && ticks.length < 8; value += safe) {
    ticks.push(Number(value.toFixed(6)))
  }
  if (ticks.length === 0) ticks.push(0, 1)
  return { ticks, min: ticks[0] ?? 0, max: ticks[ticks.length - 1] ?? 1 }
}

export function plotBox(width: number, height: number): Plot {
  const left = 52
  const top = 8
  const right = 8
  const bottom = 22
  return {
    left,
    top,
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - top - bottom),
  }
}

export function yAt(domainMin: number, domainMax: number, top: number, height: number) {
  const span = domainMax - domainMin || 1
  return (value: number) => top + height - ((value - domainMin) / span) * height
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

export function clientPoint(node: Element | null, x: number, y: number, width: number, height: number) {
  if (!node || width <= 0 || height <= 0) return null
  const box = node.getBoundingClientRect()
  return {
    x: box.left + (x / width) * box.width,
    y: box.top + (y / height) * box.height,
  }
}
