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
import { useTheme } from '../../contexts/ThemeContext';
import { getGoalType, metricColors } from './progressTrackerStorage';
import {
  formatTrackerNumber,
  isBinaryEntryCompleted,
} from './progressCalculations';

const matrixMetricColors = {
  lime: '#00ff41',
  pink: '#ff7ada',
  blue: '#65d8ff',
  yellow: '#ffd166',
  coral: '#ff8a70',
  violet: '#bda6ff',
};

function ChartTooltip({ active, label, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const tooltipLabel = payload[0]?.payload?.tooltipLabel || label;

  return (
    <div className="rounded-[1rem] border-2 border-black bg-[#fffdf8] px-4 py-3 shadow-[4px_4px_0_#000]">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
        {tooltipLabel}
      </p>
      <div className="mt-2 space-y-1">
        {payload.map((item) => (
          <p
            key={item.dataKey}
            className="text-sm font-bold text-black"
            style={{ color: item.color }}
          >
            {item.name}: {formatTrackerNumber(item.value)}
          </p>
        ))}
      </div>
    </div>
  );
}

function compareEntriesChronologically(a, b) {
  const dateCompare = a.date.localeCompare(b.date);
  const createdAtCompare = (a.createdAt || '').localeCompare(b.createdAt || '');

  return dateCompare || createdAtCompare || (a.id || '').localeCompare(b.id || '');
}

function formatEntryTime(entry) {
  if (!entry.createdAt) {
    return '';
  }

  const date = new Date(entry.createdAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getChartLabel(entry, showEntryTime) {
  const entryTime = showEntryTime ? formatEntryTime(entry) : '';

  return entryTime ? `${entry.date} ${entryTime}` : entry.date;
}

function getChartKey(entry, showEntryTime, index) {
  const chartLabel = getChartLabel(entry, showEntryTime);
  return `${chartLabel}|${entry.createdAt || ''}|${entry.id || ''}|${index}`;
}

function getChartKeyLabel(value) {
  return String(value).split('|')[0];
}

function BinaryHeatmap({ goal, entries }) {
  const sortedEntries = [...entries].sort(compareEntriesChronologically);

  return (
    <div className="mt-5 rounded-[1.5rem] border-2 border-black bg-[#fffdf8] p-4">
      {sortedEntries.length === 0 ? (
        <div className="flex min-h-72 items-center justify-center text-center">
          <p className="max-w-sm text-lg font-bold leading-7 tracking-[-0.03em] text-black/65">
            Save your first daily entry to draw the consistency calendar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 md:grid-cols-10 lg:grid-cols-12">
          {sortedEntries.map((entry) => {
            const completed = isBinaryEntryCompleted(entry, goal);
            const entryLabel = getChartLabel(entry, goal.allowMultipleEntriesPerDay);

            return (
              <div
                key={entry.id}
                className="binary-heatmap-cell aspect-square rounded-[0.75rem] border-2 border-black p-2"
                data-theme-color={completed ? 'lime' : 'danger'}
                style={{ '--heatmap-cell-bg': completed ? '#c5ff6f' : '#ffe0de' }}
                title={`${entryLabel}: ${completed ? 'Completed' : 'Missed'}`}
              >
                <p className="text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-black/55">
                  {entryLabel.slice(5)}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.08em] text-black">
                  {completed ? 'Done' : 'Miss'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GoalChart({ goal, entries }) {
  const { isMatrixTheme } = useTheme();

  if (!goal) {
    return null;
  }

  const chartTheme = isMatrixTheme
    ? {
      axis: '#d9ffd9',
      grid: '#00a812',
      target: '#00ff41',
      cumulative: '#d9ffd9',
      dotFill: '#00ff41',
      stroke: '#001606',
      metricColors: matrixMetricColors,
    }
    : {
      axis: '#000',
      grid: '#000',
      target: '#000',
      cumulative: '#000',
      dotFill: '#c5ff6f',
      stroke: '#000',
      metricColors,
    };

  const goalType = getGoalType(goal);
  const sortedEntries = [...entries].sort(compareEntriesChronologically);
  const cumulativeMetricTotals = new Map(
    goal.metrics.map((metric, index) => [
      metric.id,
      index === 0 && Number.isFinite(goal.startValue) ? goal.startValue : 0,
    ]),
  );
  const chartData = sortedEntries.map((entry, index) => {
    const point = {
      date: entry.date,
      chartKey: getChartKey(entry, goal.allowMultipleEntriesPerDay, index),
      chartLabel: getChartLabel(entry, goal.allowMultipleEntriesPerDay),
      tooltipLabel: getChartLabel(entry, goal.allowMultipleEntriesPerDay),
    };

    if (goalType === 'accumulative') {
      goal.metrics.forEach((metric) => {
        const currentTotal = cumulativeMetricTotals.get(metric.id) ?? 0;
        const entryValue = entry.values?.[metric.id];
        const nextTotal = currentTotal + (Number.isFinite(entryValue) ? entryValue : 0);

        cumulativeMetricTotals.set(metric.id, nextTotal);
        point[`metric_${metric.id}`] = nextTotal;
      });
    } else if (goalType === 'binary') {
      point.binaryCompleted = isBinaryEntryCompleted(entry, goal) ? 1 : 0;
    } else {
      goal.metrics.forEach((metric) => {
        point[`metric_${metric.id}`] = entry.values?.[metric.id];
      });
    }

    return point;
  });
  const title =
    goalType === 'accumulative'
      ? 'Completion progress'
      : goalType === 'binary'
      ? 'Consistency movement'
      : 'Metric movement';
  const badge =
    goalType === 'accumulative'
      ? `${goal.metrics.length} cumulative line${goal.metrics.length === 1 ? '' : 's'}`
      : goalType === 'performance'
      ? `${goal.metrics.length} line${goal.metrics.length === 1 ? '' : 's'}`
      : goalType === 'binary'
      ? '1 line'
      : '';
  const emptyChartMessage = goal.allowMultipleEntriesPerDay
    ? 'Save your first entry to draw the chart.'
    : 'Save your first daily entry to draw the chart.';

  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#f8f3ea] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Graph
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            {title}
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          {badge}
        </span>
      </div>

      {goalType === 'binary' ? (
        <>
          <BinaryHeatmap goal={goal} entries={entries} />
          {chartData.length > 0 ? (
            <div className="mt-5 h-72 rounded-[1.5rem] border-2 border-black bg-[#fffdf8] p-3 sm:p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 14, right: 18, bottom: 4, left: 0 }}
                >
                  <CartesianGrid
                    stroke={chartTheme.grid}
                    strokeDasharray="4 6"
                    strokeOpacity={isMatrixTheme ? 0.35 : 0.15}
                  />
                  <XAxis
                    dataKey="chartKey"
                    tickFormatter={getChartKeyLabel}
                    tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                    tickLine={false}
                    axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 1]}
                    tickFormatter={(value) => (value === 1 ? 'Done' : 'Miss')}
                    tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                    tickLine={false}
                    axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
                    width={58}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{
                      fontSize: 12,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                    }}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="binaryCompleted"
                    name="Completed"
                    stroke={chartTheme.metricColors.blue}
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors.blue,
                    }}
                    activeDot={{
                      r: 7,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors.blue,
                    }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </>
      ) : chartData.length === 0 ? (
        <div className="mt-5 flex min-h-72 items-center justify-center rounded-[1.5rem] border-2 border-dashed border-black bg-[#fffdf8] p-6 text-center">
          <p className="max-w-sm text-lg font-bold leading-7 tracking-[-0.03em] text-black/65">
            {emptyChartMessage}
          </p>
        </div>
      ) : (
        <div className="mt-5 h-80 rounded-[1.5rem] border-2 border-black bg-[#fffdf8] p-3 sm:h-96 sm:p-4">
          <ResponsiveContainer width="100%" height="100%">
            {goalType === 'accumulative' ? (
              <LineChart
                data={chartData}
                margin={{ top: 14, right: 18, bottom: 4, left: 0 }}
              >
                <CartesianGrid
                  stroke={chartTheme.grid}
                  strokeDasharray="4 6"
                  strokeOpacity={isMatrixTheme ? 0.35 : 0.15}
                />
                <XAxis
                  dataKey="chartKey"
                  tickFormatter={getChartKeyLabel}
                  tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
                />
                <YAxis
                  tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
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
                <ReferenceLine
                  y={0}
                  stroke={chartTheme.axis}
                  strokeOpacity={isMatrixTheme ? 0.7 : 0.35}
                  strokeWidth={2}
                />
                {Number.isFinite(goal.targetValue) ? (
                  <ReferenceLine
                    y={goal.targetValue}
                    stroke={chartTheme.target}
                    strokeDasharray="8 6"
                    strokeWidth={2}
                    label={{
                      value: `Target ${goal.targetValue}`,
                      fill: chartTheme.axis,
                      fontSize: 12,
                      fontWeight: 800,
                      position: 'insideTopRight',
                    }}
                  />
                ) : null}
                {goal.metrics.map((metric) => (
                  <Line
                    key={metric.id}
                    type="linear"
                    dataKey={`metric_${metric.id}`}
                    name={metric.name}
                    stroke={chartTheme.metricColors[metric.colorKey] || chartTheme.axis}
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors[metric.colorKey] || chartTheme.axis,
                    }}
                    activeDot={{
                      r: 7,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors[metric.colorKey] || chartTheme.axis,
                    }}
                    connectNulls
                  />
                ))}
              </LineChart>
            ) : (
              <LineChart
                data={chartData}
                margin={{ top: 14, right: 18, bottom: 4, left: 0 }}
              >
                <CartesianGrid
                  stroke={chartTheme.grid}
                  strokeDasharray="4 6"
                  strokeOpacity={isMatrixTheme ? 0.35 : 0.15}
                />
                <XAxis
                  dataKey="chartKey"
                  tickFormatter={getChartKeyLabel}
                  tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
                />
                <YAxis
                  tick={{ fill: chartTheme.axis, fontSize: 12, fontWeight: 700 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.axis, strokeWidth: 2 }}
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
                    stroke={chartTheme.target}
                    strokeDasharray="8 6"
                    strokeWidth={2}
                    label={{
                      value: `Target ${goal.targetValue}`,
                      fill: chartTheme.axis,
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
                    stroke={chartTheme.metricColors[metric.colorKey] || chartTheme.axis}
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors[metric.colorKey] || chartTheme.axis,
                    }}
                    activeDot={{
                      r: 7,
                      stroke: chartTheme.stroke,
                      strokeWidth: 2,
                      fill: chartTheme.metricColors[metric.colorKey] || chartTheme.axis,
                    }}
                    connectNulls
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
