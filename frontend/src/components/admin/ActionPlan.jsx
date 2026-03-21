export default function ActionPlan({ plan }) {
  if (!plan?.plan_data) {
    return <p className="muted">Generate a 30 / 60 / 90-day plan from the analytics view.</p>;
  }
  const d = plan.plan_data;
  const sections = [
    { title: '30 days', items: d.thirtyDays },
    { title: '60 days', items: d.sixtyDays },
    { title: '90 days', items: d.ninetyDays },
  ];
  return (
    <div className="grid-2">
      {sections.map((s) => (
        <div key={s.title} className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>{s.title}</h3>
          <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {(s.items || []).map((line, i) => (
              <li key={i} style={{ marginBottom: '0.5rem' }}>
                {line}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
