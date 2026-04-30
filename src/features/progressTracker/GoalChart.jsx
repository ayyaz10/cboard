import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { metricColors } from './progressTrackerStorage';

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ChartTooltip({ active, label, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-[1rem] border-2 border-black bg-[#fffdf8] px-4 py-3 shadow-[4px_4px_0_#000]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
        {label}
      </p>
      <div className="mt-2 space-y-1">
        {payload.map((item) => (
          <p
            key={item.dataKey}
            className="text-sm font-bold text-black"
            style={{ color: item.color }}
          >
            {item.name}: {formatNumber(item.value)}
          </p>
        ))}
      </div>
    </div>
  );
}

export function GoalChart({ goal, entries }) {
  if (!goal) {
    return null;
  }

  const sortedEntries = [...entries].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const chartData = sortedEntries.map((entry) => {
    const point = {
      date: entry.date,
    };

    goal.metrics.forEach((metric) => {
      point[`metric_${metric.id}`] = entry.values?.[metric.id];
    });

    return point;
  });

  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#f8f3ea] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Graph
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Metric movement
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          {goal.metrics.length} line{goal.metrics.length === 1 ? '' : 's'}
        </span>
      </div>

      {chartData.length === 0 ? (
        <div className="mt-5 flex min-h-72 items-center justify-center rounded-[1.5rem] border-2 border-dashed border-black bg-[#fffdf8] p-6 text-center">
          <p className="max-w-sm text-lg font-bold leading-7 tracking-[-0.03em] text-black/65">
            Save your first daily entry to draw the chart.
          </p>
        </div>
      ) : (
        <div className="mt-5 h-80 rounded-[1.5rem] border-2 border-black bg-[#fffdf8] p-3 sm:h-96 sm:p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 14, right: 18, bottom: 4, left: 0 }}
            >
              <CartesianGrid
                stroke="#000"
                strokeDasharray="4 6"
                strokeOpacity={0.15}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: '#000', fontSize: 12, fontWeight: 700 }}
                tickLine={false}
                axisLine={{ stroke: '#000', strokeWidth: 2 }}
              />
              <YAxis
                tick={{ fill: '#000', fontSize: 12, fontWeight: 700 }}
                tickLine={false}
                axisLine={{ stroke: '#000', strokeWidth: 2 }}
                width={48}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{
                  fontSize: 12,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              />
              {Number.isFinite(goal.targetValue) && goal.targetValue > 0 ? (
                <ReferenceLine
                  y={goal.targetValue}
                  stroke="#000"
                  strokeDasharray="8 6"
                  strokeWidth={2}
                  label={{
                    value: `Target ${goal.targetValue}`,
                    fill: '#000',
                    fontSize: 12,
                    fontWeight: 800,
                    position: 'insideTopRight',
                  }}
                />
              ) : null}
              {goal.metrics.map((metric) => (
                <Line
                  key={metric.id}
                  type="monotone"
                  dataKey={`metric_${metric.id}`}
                  name={metric.name}
                  stroke={metricColors[metric.colorKey] || '#000'}
                  strokeWidth={3}
                  dot={{
                    r: 4,
                    stroke: '#000',
                    strokeWidth: 2,
                    fill: metricColors[metric.colorKey] || '#fff',
                  }}
                  activeDot={{
                    r: 7,
                    stroke: '#000',
                    strokeWidth: 2,
                    fill: metricColors[metric.colorKey] || '#fff',
                  }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
