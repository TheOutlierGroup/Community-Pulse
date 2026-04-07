import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import * as InAppNotification from '../../models/InAppNotification.js';

function formatIsoDate(d) {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function publicStaffAssignedTask(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    title: row.title,
    status: row.status,
    dueDate: formatIsoDate(row.due_date),
    startDate: formatIsoDate(row.start_date),
  };
}

export function registerPlatformMeRoutes(router) {
  router.get('/me/notifications', async (req, res) => {
    try {
      const rows = await InAppNotification.listForUser(req.user.id, { limit: req.query.limit });
      const unreadCount = await InAppNotification.countUnreadForUser(req.user.id);
      res.json({
        notifications: rows.map(InAppNotification.publicNotification),
        unreadCount,
      });
    } catch (e) {
      console.error('GET /me/notifications failed:', e);
      res.status(500).json({ error: 'Could not load notifications' });
    }
  });

  router.patch('/me/notifications/:id/read', async (req, res) => {
    try {
      const ok = await InAppNotification.markRead(req.params.id, req.user.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      console.error('PATCH /me/notifications/:id/read failed:', e);
      res.status(500).json({ error: 'Could not update notification' });
    }
  });

  router.post('/me/notifications/read-all', async (req, res) => {
    try {
      await InAppNotification.markAllReadForUser(req.user.id);
      res.json({ ok: true });
    } catch (e) {
      console.error('POST /me/notifications/read-all failed:', e);
      res.status(500).json({ error: 'Could not mark notifications read' });
    }
  });

  router.get('/me/tasks-dashboard', async (req, res) => {
    const weekStart = req.query.weekStart;
    const weekEnd = req.query.weekEnd;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || '')) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(weekEnd || ''))
    ) {
      return res.status(400).json({ error: 'Query weekStart and weekEnd are required (YYYY-MM-DD)' });
    }
    if (weekStart > weekEnd) {
      return res.status(400).json({ error: 'weekStart must be on or before weekEnd' });
    }
    const userId = req.user.id;
    try {
      const [dueRows, openCount, myRows] = await Promise.all([
        ClientWorkTask.listTasksDueBetweenForAssignee(userId, weekStart, weekEnd),
        ClientWorkTask.countOpenTasksAssignedToUserAcrossClientOrgs(userId),
        ClientWorkTask.listTasksAssignedToUserAcrossClientOrgs(userId),
      ]);
      res.json({
        weekRange: { start: weekStart, end: weekEnd },
        tasksDueThisWeekCount: dueRows.length,
        openAssignedCount: openCount,
        tasksDueThisWeek: dueRows.map(publicStaffAssignedTask),
        myTasks: myRows.map(publicStaffAssignedTask),
      });
    } catch (e) {
      console.error('GET /me/tasks-dashboard failed:', e);
      res.status(500).json({ error: 'Could not load tasks dashboard' });
    }
  });
}
