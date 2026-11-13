import { useMemo, useState } from 'react'
import { ActionIcon, Card, Group, Loader, ScrollArea, SegmentedControl, Table, Text, Title, Tooltip } from '@mantine/core'
import { LineChart } from '@mantine/charts'
import { IconChartLine, IconTable } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import {
  api,
  type BucketUsagePoint,
  type ClusterUsagePoint,
  type UsageRange,
  type UsageSeries,
} from '../api/client'
import { fmtBytes } from '../pages/BucketsPage'
import './UsageChart.css'

type Props = { kind: 'cluster' } | { kind: 'bucket'; bucketId: string }
type Metric = 'bytes' | 'objects'
type Point = ClusterUsagePoint | BucketUsagePoint
type Row = { label: string; bytes: number | null; objects: number | null; dataAvail: number | null }

const RANGES: { value: UsageRange; label: string; days: number }[] = [
  { value: '24h', label: '24 giờ', days: 0 },
  { value: '7d', label: '7 ngày', days: 7 },
  { value: '30d', label: '30 ngày', days: 30 },
  { value: '90d', label: '90 ngày', days: 90 },
  { value: '365d', label: '1 năm', days: 365 },
]

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const fmtCount = (n: number) => n.toLocaleString('vi-VN')
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

// Largest binary unit the biggest value reaches, so the y-axis gets round
// ticks in that unit (200 GB, 400 GB…) instead of round byte counts.
function byteUnit(max: number): number {
  let i = 0
  while (i < BYTE_UNITS.length - 1 && max >= 1024 ** (i + 1)) i++
  return i
}

// One row per hour (24h) or per local day, so a missed snapshot shows as a gap
// instead of the line silently bridging it.
function buildRows(range: UsageRange, points: Point[]): Row[] {
  const empty = { bytes: null, objects: null, dataAvail: null }
  const pick = (p: Point | undefined) =>
    p ? { bytes: p.bytes, objects: p.objects, dataAvail: 'dataAvail' in p ? p.dataAvail : null } : empty

  if (range === '24h') {
    const byHour = new Map(points.map((p) => [Math.floor(p.ts / 3600), p]))
    const end = new Date()
    end.setMinutes(0, 0, 0)
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

export function UsageChart(props: Props) {
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
      ? [{ name: 'objects', label: 'Objects', color: 'var(--usage-series-1)' }]
      : props.kind === 'cluster'
        ? [
            { name: 'bytes', label: 'Đã dùng', color: 'var(--usage-series-1)' },
            { name: 'dataAvail', label: 'Còn trống', color: 'var(--usage-series-2)' },
          ]
        : [{ name: 'bytes', label: 'Dung lượng', color: 'var(--usage-series-1)' }]
  const fmt = metric === 'objects' ? fmtCount : fmtBytes
  const fmtOrDash = (v: number | null | undefined) => (v == null ? '—' : fmt(v))
  const latest = [...rows].reverse().find((r) => r.bytes != null)
  const filled = rows.filter((r) => r.bytes != null)

  // Chart data in a display unit; the legend and table keep exact values.
  const unit = metric === 'bytes'
    ? byteUnit(Math.max(0, ...rows.flatMap((r) => series.map((s) => (r[s.name as keyof Row] as number | null) ?? 0))))
    : 0
  const chartRows = rows.map((r) => {
    const out: Record<string, string | number | null> = { label: r.label }
    for (const s of series) {
      const v = r[s.name as keyof Row] as number | null
      out[s.name] = v == null ? null : v / 1024 ** unit
    }
    return out
  })
  const fmtChart = (v: number | null | undefined) => {
    if (v == null) return '—'
    if (metric === 'objects') return fmtCount(v)
    return `${Number.isInteger(v) ? v : v.toFixed(1)} ${BYTE_UNITS[unit]}`
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Title order={5}>Lịch sử dung lượng</Title>
        <Tooltip label={asTable ? 'Xem biểu đồ' : 'Xem bảng'}>
          <ActionIcon variant="subtle" color="gray" onClick={() => setAsTable((v) => !v)} aria-label={asTable ? 'Xem biểu đồ' : 'Xem bảng'}>
            {asTable ? <IconChartLine size={18} /> : <IconTable size={18} />}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Group gap="xs" mb="sm">
        <SegmentedControl size="xs" value={range} onChange={(v) => setRange(v as UsageRange)} data={RANGES.map(({ value, label }) => ({ value, label }))} />
        <SegmentedControl
          size="xs"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          data={[{ value: 'bytes', label: 'Dung lượng' }, { value: 'objects', label: 'Objects' }]}
        />
      </Group>

      {query.isLoading && <Loader size="sm" />}
      {query.error && <Text c="red" size="sm">Không tải được lịch sử dung lượng.</Text>}
      {query.data && points.length === 0 && (
        <Text c="dimmed" size="sm">Chưa có số liệu. garage-admin ghi lại dung lượng mỗi giờ một lần.</Text>
      )}

      {points.length > 0 && (
        <>
          <Group gap="lg" mb="xs">
            {series.map((s) => (
              <Group key={s.name} gap={6} wrap="nowrap">
                <span className="usage-key" style={{ background: s.color }} />
                <Text size="sm" c="dimmed">{s.label}</Text>
                <Text size="sm" fw={600}>{fmtOrDash(latest?.[s.name as keyof Row] as number | null)}</Text>
              </Group>
            ))}
          </Group>

          {asTable ? (
            <ScrollArea h={260}>
              <Table striped fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{range === '24h' ? 'Giờ' : 'Ngày'}</Table.Th>
                    {series.map((s) => <Table.Th key={s.name} ta="right">{s.label}</Table.Th>)}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...filled].reverse().map((r) => (
                    <Table.Tr key={r.label}>
                      <Table.Td>{r.label}</Table.Td>
                      {series.map((s) => <Table.Td key={s.name} ta="right">{fmtOrDash(r[s.name as keyof Row] as number | null)}</Table.Td>)}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : (
            <LineChart
              h={260}
              data={chartRows}
              dataKey="label"
              series={series}
              curveType="linear"
              connectNulls={false}
              strokeWidth={2}
              withDots={filled.length <= 31}
              dotProps={{ r: 4, strokeWidth: 2, stroke: 'var(--mantine-color-body)' }}
              activeDotProps={{ r: 5, strokeWidth: 2, stroke: 'var(--mantine-color-body)' }}
              gridAxis="x"
              strokeDasharray="0"
              tickLine="none"
              valueFormatter={fmtChart}
              xAxisProps={{ minTickGap: 16 }}
              yAxisProps={{ width: 72 }}
            />
          )}
        </>
      )}
    </Card>
  )
}
