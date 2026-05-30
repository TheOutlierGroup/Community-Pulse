import { Router } from 'express';
import * as Project from '../../models/Project.js';
import * as Lead from '../../models/Lead.js';
import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import { convertLeadToProject } from '../../services/leadConversionService.js';
import { dispatchEvent } from '../../services/webhookDispatchService.js';

const router = Router();

function publicProject(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    businessUnitId: row.business_unit_id,
    buName: row.bu_name,
    leadId: row.lead_id,
    accountId: row.account_id,
    accountName: row.account_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    name: row.name,
    description: row.description,
    status: row.status,
    baselineHours: Number(row.baseline_hours),
    baselineCost: Number(row.baseline_cost),
    actualHours: Number(row.actual_hours || 0),
    actualCost: Number(row.actual_cost || 0),
    taskCount: Number(row.task_count || 0),
    startDate: row.start_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicTimeLog(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_first_name ? `${row.user_first_name} ${row.user_last_name}`.trim() : null,
    description: row.description,
    hours: Number(row.hours),
    costRate: row.cost_rate != null ? Number(row.cost_rate) : null,
    lineCost: Number(row.line_cost || 0),
    loggedDate: row.logged_date,
    createdAt: row.created_at,
  };
}

function publicActivity(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorName: row.actor_first_name ? `${row.actor_first_name} ${row.actor_last_name}`.trim() : null,
    eventType: row.event_type,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

// ── Lead → Project conversion ─────────────────────────────────────────────────

// POST /api/platform/leads/:leadId/convert
router.post('/leads/:leadId/convert', async (req, res, next) => {
  try {
    const orgId = req.workspaceOrganization.id;
    const leadOk = await Lead.leadBelongsToOrg(req.params.leadId, orgId);
    if (!leadOk) return res.status(404).json({ error: 'Lead not found' });

    const result = await convertLeadToProject(req.params.leadId, req.user.id);
    if (result.error) return res.status(409).json({ error: result.error });

    dispatchEvent(orgId, 'project.created', {
      projectId: result.project.id, projectName: result.project.name,
      leadId: result.lead.id, businessUnitId: result.project.business_unit_id,
    });
    res.status(201).json({
      project: publicProject(result.project),
      lead: { id: result.lead.id, lockedAt: result.lead.locked_at, wonAt: result.lead.won_at },
    });
  } catch (e) { next(e); }
});

// ── Projects ──────────────────────────────────────────────────────────────────

// GET /api/platform/projects
router.get('/projects', async (req, res, next) => {
  try {
    const { businessUnitId, status, leadId, search, limit, offset } = req.query;
    const projects = await Project.listProjects(req.workspaceOrganization.id, {
      businessUnitId, status, leadId, search, limit, offset,
    });
    res.json({ projects: projects.map(publicProject) });
  } catch (e) { next(e); }
});

// GET /api/platform/projects/:projectId
router.get('/projects/:projectId', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const summary = await Project.getTimeSummary(project.id);
    res.json({ project: publicProject(project), timeSummary: summary });
  } catch (e) { next(e); }
});

// PATCH /api/platform/projects/:projectId
router.patch('/projects/:projectId', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const prevStatus = project.status;
    const { name, description, status, startDate, dueDate } = req.body;

    if (status && !Project.PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${Project.PROJECT_STATUSES.join(', ')}` });
    }

    const updated = await Project.updateProject(req.params.projectId, { name, description, status, startDate, dueDate });
    if (!updated) return res.status(404).json({ error: 'Not found' });

    if (status && status !== prevStatus) {
      await Project.logActivity(project.id, req.user.id, Project.PROJECT_ACTIVITY_TYPES.STATUS_CHANGED, {
        from: prevStatus, to: status,
      });
      dispatchEvent(project.organization_id, 'project.status_changed', {
        projectId: project.id, projectName: project.name, from: prevStatus, to: status,
      });
    }

    const full = await Project.getProject(updated.id);
    res.json({ project: publicProject(full) });
  } catch (e) { next(e); }
});

// ── Time logs ─────────────────────────────────────────────────────────────────

// GET /api/platform/projects/:projectId/time-logs
router.get('/projects/:projectId/time-logs', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { taskId, userId, limit, offset } = req.query;
    const logs = await Project.listTimeLogs(project.id, { taskId, userId, limit, offset });
    const summary = await Project.getTimeSummary(project.id);
    res.json({ timeLogs: logs.map(publicTimeLog), summary });
  } catch (e) { next(e); }
});

// POST /api/platform/projects/:projectId/time-logs
router.post('/projects/:projectId/time-logs', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { taskId, hours, description, costRate, loggedDate } = req.body;
    if (!hours || Number(hours) <= 0) return res.status(400).json({ error: 'hours must be a positive number' });

    const log = await Project.addTimeLog(project.id, {
      taskId: taskId || null,
      userId: req.user.id,
      description, hours, costRate, loggedDate,
    });

    await Project.logActivity(project.id, req.user.id, Project.PROJECT_ACTIVITY_TYPES.TIME_LOGGED, {
      hours: Number(hours), taskId: taskId || null, description: description || null,
    });

    // Fire over-budget webhook if actual cost now exceeds baseline
    if (Number(project.baseline_cost) > 0) {
      const summary = await Project.getTimeSummary(project.id);
      if (summary.actualCost > Number(project.baseline_cost)) {
        dispatchEvent(project.organization_id, 'project.over_budget', {
          projectId: project.id,
          projectName: project.name,
          baselineCost: Number(project.baseline_cost),
          actualCost: summary.actualCost,
          overBy: summary.actualCost - Number(project.baseline_cost),
        });
      }
    }

    res.status(201).json({ timeLog: publicTimeLog({ ...log, user_email: null, user_first_name: null, user_last_name: null, task_title: null, line_cost: Number(hours) * Number(costRate || 0) }) });
  } catch (e) { next(e); }
});

// PATCH /api/platform/projects/:projectId/time-logs/:logId
router.patch('/projects/:projectId/time-logs/:logId', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { description, hours, costRate, loggedDate } = req.body;
    if (hours !== undefined && Number(hours) <= 0) return res.status(400).json({ error: 'hours must be positive' });
    const updated = await Project.updateTimeLog(req.params.logId, { description, hours, costRate, loggedDate });
    if (!updated) return res.status(404).json({ error: 'Time log not found' });
    res.json({ timeLog: publicTimeLog({ ...updated, user_email: null, user_first_name: null, user_last_name: null, task_title: null, line_cost: Number(updated.hours) * Number(updated.cost_rate || 0) }) });
  } catch (e) { next(e); }
});

// DELETE /api/platform/projects/:projectId/time-logs/:logId
router.delete('/projects/:projectId/time-logs/:logId', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await Project.deleteTimeLog(req.params.logId);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Project tasks (Kanban + List) ─────────────────────────────────────────────

// GET /api/platform/projects/:projectId/tasks
// Returns all tasks grouped by status for Kanban, or flat for List view.
// Query param: view=kanban (default) | list
router.get('/projects/:projectId/tasks', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { limit, offset } = req.query;
    const tasks = await ClientWorkTask.listTasksForProject(project.id, project.organization_id, { limit, offset });
    const counts = await ClientWorkTask.countTasksByStatusForProject(project.id);

    if (req.query.view === 'list') {
      return res.json({ tasks, counts });
    }
    // Kanban: group by status column
    const columns = ClientWorkTask.TASK_BOARD_STATUSES.reduce((acc, s) => {
      acc[s] = tasks.filter((t) => t.status === s);
      return acc;
    }, {});
    res.json({ columns, counts });
  } catch (e) { next(e); }
});

// POST /api/platform/projects/:projectId/tasks
router.post('/projects/:projectId/tasks', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { title } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });

    const task = await ClientWorkTask.createProjectTask(
      project.organization_id,
      project.id,
      req.body,
      req.user.id
    );
    if (!task) return res.status(400).json({ error: 'Could not create task' });
    res.status(201).json({ task });
  } catch (e) { next(e); }
});

// PATCH /api/platform/projects/:projectId/tasks/reorder
router.patch('/projects/:projectId/tasks/reorder', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await ClientWorkTask.reorderTasksForOrg(project.organization_id, req.body.updates || [], req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Activity ──────────────────────────────────────────────────────────────────

// GET /api/platform/projects/:projectId/activity
router.get('/projects/:projectId/activity', async (req, res, next) => {
  try {
    const project = await Project.getProject(req.params.projectId);
    if (!project || project.organization_id !== req.workspaceOrganization.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const activity = await Project.listActivity(project.id, req.query);
    res.json({ activity: activity.map(publicActivity) });
  } catch (e) { next(e); }
});

export default router;
