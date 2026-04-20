export default function Dashboard({ overview }) {
  const { sessions, activeSession, participation } = overview || {};
  return (
    <div className="grid-2">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>At a glance</h2>
        <p className="muted">Active session participation</p>
        <p style={{ fontSize: '2rem', fontWeight: 700, margin: '0.5rem 0' }}>
          {participation?.completed ?? 0}{' '}
          <span style={{ fontSize: '1rem', color: 'var(--muted)', fontWeight: 500 }}>
            / {participation?.total ?? 0} started
          </span>
        </p>
        {activeSession ? (
          <p>
            Live diagnostic: <strong>{activeSession.name}</strong>
          </p>
        ) : (
          <p className="muted">No active session — activate one below.</p>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sessions</h2>
        {!sessions?.length && <p className="muted">Create your first Rhythm Engine session.</p>}
        {sessions?.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Audience</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.audience === 'manager' ? 'Managers' : 'Staff'}</td>
                  <td>
                    <span className={`badge badge-${s.status}`}>{s.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
