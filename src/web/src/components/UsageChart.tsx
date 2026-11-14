import { useMemo, useState } from 'react'
import { Button, Card, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Spinner } from 'h2d-glass-ui'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts'
import { IconChartLine, IconTable } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { api, type BucketUsagePoint, type ClusterUsagePoint, type UsageRange, type UsageSeries } from '../api/client'
import { fmtBytes } from '../pages/BucketsPage'
import './UsageChart.css'
import { useTranslation } from 'react-i18next'

type Props = { kind: 'cluster' } | { kind: 'bucket'; bucketId: string }
type Metric = 'bytes' | 'objects'
type Point = ClusterUsagePoint | BucketUsagePoint
type Row = { label: string; bytes: number | null; objects: number | null; dataAvail: number | null }

export function UsageChart(props: Props) {
  const { t, i18n } = useTranslation()
  const RANGES: { value: UsageRange; label: string; days: number }[] = [
    { value: '24h', label: t('usage.range24h'), days: 0 },
    { value: '7d', label: t('usage.range7d'), days: 7 },
    { value: '30d', label: t('usage.range30d'), days: 30 },
    { value: '90d', label: t('usage.range90d'), days: 90 },
    { value: '365d', label: t('usage.range365d'), days: 365 },
  ]

  const pad = (n: number) => String(n).padStart(2, '0')
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const fmtCount = (n: number) => n.toLocaleString(i18n.language || 'en')
  const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

  function byteUnit(max: number): number {
    let i = 0
    while (i < BYTE_UNITS.length - 1 && max >= 1024 ** (i + 1)) i++
    return i
  }
  function niceTicks(max: number): number[] {
    if (!(max > 0)) return [0, 1]
    const raw = max / 4
    const mag = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!
    const n = Math.ceil(max / step - 1e-9)
    return Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(10))
  }
  function buildRows(range: UsageRange, points: Point[]): Row[] {
    const empty = { bytes: null, objects: null, dataAvail: null }
    const pick = (p: Point | undefined) => p ? { bytes: p.bytes, objects: p.objects, dataAvail: 'dataAvail' in p ? p.dataAvail : null } : empty
    if (range === '24h') {
      const byHour = new Map(points.map((p) => [Math.floor(p.ts / 3600), p]))
      const end = new Date(); end.setMinutes(0, 0, 0)
      return Array.from({ length: 24 }, (_, i) => {
        const d = new Date(end.getTime() - (23 - i) * 3600_000)
        return { label: `${pad(d.getHours())}:00`, ...pick(byHour.get(Math.floor(d.getTime() / 3600_000))) }
      })
    }
    const days = RANGES.find((r) => r.value === range)!.days
    const byDay = new Map(points.map((p) => [dayKey(new Date(p.ts * 1000)), p]))
    const today = new Date()
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))
      return { label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, ...pick(byDay.get(dayKey(d))) }
    })
  }

  const [range, setRange] = useState<UsageRange>('7d')
  const [metric, setMetric] = useState<Metric>('bytes')
  const [asTable, setAsTable] = useState(false)
  const bucketId = props.kind === 'bucket' ? props.bucketId : null

  const query = useQuery({
    queryKey: ['usage', props.kind, bucketId, range],
    queryFn: async () => {
      const path = bucketId ? `/usage/buckets/${encodeURIComponent(bucketId)}` : '/usage/cluster'
      const params = { range, tzOffset: -new Date().getTimezoneOffset() }
      return (await api.get<UsageSeries<Point>>(path, { params })).data
    },
  })

  const points = query.data?.points ?? []
  const rows = useMemo(() => buildRows(range, points), [range, points])

  const series =
    metric === 'objects'
      ? [{ name: 'objects', label: t('usage.objects'), color: 'var(--usage-series-1)' }]
      : props.kind === 'cluster'
        ? [{ name: 'bytes', label: t('usage.used'), color: 'var(--usage-series-1)' }, { name: 'dataAvail', label: t('usage.free'), color: 'var(--usage-series-2)' }]
        : [{ name: 'bytes', label: t('usage.size'), color: 'var(--usage-series-1)' }]
  const fmt = metric === 'objects' ? fmtCount : fmtBytes
  const fmtOrDash = (v: number | null | undefined) => (v == null ? '—' : fmt(v))
  const latest = [...rows].reverse().find((r) => r.bytes != null)
  const filled = rows.filter((r) => r.bytes != null)

  const maxValue = Math.max(0, ...rows.flatMap((r) => series.map((s) => (r[s.name as keyof Row] as number | null) ?? 0)))
  const unit = metric === 'bytes' ? byteUnit(maxValue) : 0
  const ticks = niceTicks(maxValue / 1024 ** unit)
  const chartRows = rows.map((r) => {
    const out: Record<string, string | number | null> = { label: r.label }
    for (const s of series) {
      const v = r[s.name as keyof Row] as number | null
      out[s.name] = v == null ? null : v / 1024 ** unit
    }
    return out
  })
  const fmtChart = (v: number | null | undefined) => (v == null ? '—' : fmt(v * 1024 ** unit))
  const fmtTick = (v: number) => (metric === 'objects' ? fmtCount(v) : `${+v.toFixed(2)} ${BYTE_UNITS[unit]}`)

  return (
    <Card>
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h5 style={{ margin: 0 }}>{t('usage.historyTitle')}</h5>
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-label={asTable ? t('usage.viewChart') : t('usage.viewTable')}>
            {asTable ? <IconChartLine size={18} /> : <IconTable size={18} />}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Select value={range} onValueChange={(v) => setRange(v as UsageRange)}>
            {RANGES.map(({ value, label }) => (<SelectItem key={value} value={value}>{label}</SelectItem>))}
          </Select>
          <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <SelectItem value="bytes">{t('usage.size')}</SelectItem>
            <SelectItem value="objects">{t('usage.objects')}</SelectItem>
          </Select>
        </div>

        {query.isLoading && <Spinner size="sm" />}
        {query.error && <span style={{ color: 'red', fontSize: 13 }}>{t('usage.loadFailed')}</span>}
        {query.data && points.length === 0 && (
          <span style={{ opacity: 0.6, fontSize: 13 }}>{t('usage.noData')}</span>
        )}

        {points.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
              {series.map((s) => (
                <div key={s.name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 12, height: 12, background: s.color, display: 'inline-block' }} />
                  <span style={{ fontSize: 13, opacity: 0.7 }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtOrDash(latest?.[s.name as keyof Row] as number | null)}</span>
                </div>
              ))}
            </div>

            {asTable ? (
              <div style={{ height: 260, overflow: 'auto' }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{range === '24h' ? t('usage.hour') : t('usage.day')}</TableHead>
                      {series.map((s) => <TableHead key={s.name}>{s.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...filled].reverse().map((r) => (
                      <TableRow key={r.label}>
                        <TableCell>{r.label}</TableCell>
                        {series.map((s) => <TableCell key={s.name}>{fmtOrDash(r[s.name as keyof Row] as number | null)}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" minTickGap={16} />
                  <YAxis width={72} ticks={ticks} domain={[0, ticks[ticks.length - 1]]} tickFormatter={fmtTick} />
                  <RTooltip formatter={(v: any) => fmtChart(v)} />
                  {series.map((s) => (
                    <Line key={s.name} type="linear" dataKey={s.name} name={s.label} stroke={s.color} strokeWidth={2} dot={filled.length <= 31 ? { r: 4 } : false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
