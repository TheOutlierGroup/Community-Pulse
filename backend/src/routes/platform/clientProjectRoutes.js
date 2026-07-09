import { Router } from 'express';
import fs from 'fs';
import * as ClientProject from '../../models/ClientProject.js';
import { assertClientOrganizationPlatformForUser } from './shared.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';
import { handleRepositoryFileUpload } from '../../middleware/repositoryFileUpload.js';
import { projectFilePath } from '../../config/storage.js';

const router = Router();

async function loadProjectOr404(req, res) {
  const org = await assertClientOrganizationPlatformForUser(req.params.orgId, req.user);
  if (!org) {
    res.status(404).json({ error: 'Client not found.' });
    return null;
  }
  const project = await ClientProject.getOrCreateProjectForOrg(org.id);
  return { org, project };
}

router.get('/organizations/:orgId/project', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    const [milestones, files] = await Promise.all([
      ClientProject.listMilestones(loaded.project.id),
      ClientProject.listFiles(loaded.project.id),
    ]);
    res.json({ project: loaded.project, milestones, files });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load project.' });
  }
});

router.patch('/organizations/:orgId/project', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    const updated = await ClientProject.updateProject(loaded.project.id, req.body || {});
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_UPDATE,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: { progressPct: updated?.progress_pct },
    });
    res.json({ project: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update project.' });
  }
});

router.post('/organizations/:orgId/project/milestones', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    const milestone = await ClientProject.createMilestone(loaded.project.id, {
      title,
      targetDate: req.body?.targetDate,
      status: req.body?.status,
      notes: req.body?.notes,
    });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_MILESTONE_CREATE,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: { title },
    });
    res.status(201).json({ milestone });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create milestone.' });
  }
});

router.patch('/organizations/:orgId/project/milestones/:milestoneId', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    if (!await ClientProject.milestoneBelongsToProject(loaded.project.id, req.params.milestoneId)) {
      return res.status(404).json({ error: 'Milestone not found.' });
    }
    const milestone = await ClientProject.updateMilestone(loaded.project.id, req.params.milestoneId, req.body || {});
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_MILESTONE_UPDATE,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: { title: milestone?.title, status: milestone?.status },
    });
    res.json({ milestone });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update milestone.' });
  }
});

router.delete('/organizations/:orgId/project/milestones/:milestoneId', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    if (!await ClientProject.milestoneBelongsToProject(loaded.project.id, req.params.milestoneId)) {
      return res.status(404).json({ error: 'Milestone not found.' });
    }
    await ClientProject.deleteMilestone(loaded.project.id, req.params.milestoneId);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_MILESTONE_DELETE,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: {},
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete milestone.' });
  }
});

router.post('/organizations/:orgId/project/files', handleRepositoryFileUpload, async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const ext = String(req.file.originalname || '').match(/\.[a-z0-9]+$/i)?.[0] || '';
    const filename = `${loaded.project.id}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    await fs.promises.writeFile(projectFilePath(filename), req.file.buffer);
    const file = await ClientProject.createFileRecord(loaded.project.id, {
      filename,
      originalName: req.file.originalname,
      sizeBytes: req.file.size,
      contentType: req.file.mimetype,
      uploadedBy: req.user.id,
    });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_FILE_UPLOAD,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: { name: req.file.originalname },
    });
    res.status(201).json({ file });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload file.' });
  }
});

router.get('/organizations/:orgId/project/files/:fileId/download', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    const file = await ClientProject.getFile(loaded.project.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found.' });
    res.download(projectFilePath(file.filename), file.original_name);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to download file.' });
  }
});

router.delete('/organizations/:orgId/project/files/:fileId', async (req, res) => {
  try {
    const loaded = await loadProjectOr404(req, res);
    if (!loaded) return;
    const file = await ClientProject.getFile(loaded.project.id, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found.' });
    await ClientProject.deleteFileRecord(loaded.project.id, req.params.fileId);
    try {
      await fs.promises.unlink(projectFilePath(file.filename));
    } catch {
      /* ignore */
    }
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.CLIENT_PROJECT_FILE_DELETE,
      targetType: 'organization',
      targetId: loaded.org.id,
      targetOrganizationId: loaded.org.id,
      metadata: { name: file.original_name },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete file.' });
  }
});

export default router;
