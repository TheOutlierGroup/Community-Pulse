import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export default function Analytics({ frictionAverages }) {
  if (!frictionAverages?.length) {
    return null;
  }
  const data = frictionAverages.map((f) => ({
    name: f.label.length > 14 ? `${f.label.slice(0, 12)}…` : f.label,
    full: f.label,
    friction: Number(f.avg.toFixed(2)),
  }));
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="name" tick={{ fill: '#8fa3b8', fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
          <YAxis domain={[0, 5]} tick={{ fill: '#8fa3b8', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#1a222c', border: '1px solid rgba(255,255,255,0.1)' }}
            labelFormatter={(_, p) => p?.[0]?.payload?.full}
          />
          <Bar dataKey="friction" fill="#3dd6c6" radius={[6, 6, 0, 0]} name="Friction (1=hard)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
