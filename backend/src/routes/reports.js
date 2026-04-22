import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as GeneratedReport from '../models/GeneratedReport.js';
import { resolveReportOrganizationForUser } from '../services/reportAuth.js';
import { validateReportRequest } from '../services/reportInput.js';
import { generateReport } from '../services/reportGeneration.js';
import { createReportDownloadToken, verifyReportDownloadToken } from '../services/reportDownloadToken.js';

export function createReportsRoutes({
  authMiddleware = requireAuth,
  generatedReportModel = GeneratedReport,
  resolveReportOrganizationForUserFn = resolveReportOrganizationForUser,
  validateReportRequestFn = validateReportRequest,
  generateReportFn = generateReport,
  createReportDownloadTokenFn = createReportDownloadToken,
  verifyReportDownloadTokenFn = verifyReportDownloadToken,
  fileExistsFn = fs.existsSync,
  basenameFn = path.basename,
} = {}) {
  const router = Router();

  router.use(authMiddleware);

  router.get('/', async (req, res) => {
  const requestedOrgId = String(req.query?.org_id || '').trim() || null;
  const requestedOrgSlug = String(req.query?.org_slug || '').trim() || null;
  if (!requestedOrgId && !requestedOrgSlug) {
    return res.status(400).json({ error: 'org_id or org_slug is required' });
  }

  const access = await resolveReportOrganizationForUserFn({
    user: req.user,
    requestedOrgId,
    requestedOrgSlug,
  });
  if (!access.ok) {
    return res.status(access.status).json({ error: access.message, code: access.error });
  }

  const reports = await generatedReportModel.listGeneratedReportsForOrganization(access.organization.id, {
    limit: Number.parseInt(String(req.query?.limit || '25'), 10),
  });
  return res.json({
    reports: reports.map((report) => ({
      id: report.id,
      stage: report.stage,
      format: report.format,
      status: report.status,
      generated_at: report.generated_at,
      expires_at: report.expires_at,
      response_count: Number(report?.meta?.responseCount || 0) || 0,
      generated_by: {
        id: report.generated_by,
        email: report.generated_by_email || null,
        first_name: report.generated_by_first_name || null,
        last_name: report.generated_by_last_name || null,
      },
    })),
  });
  });

  router.post('/generate', async (req, res) => {
    const validated = validateReportRequestFn(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ error: validated.message, code: validated.error });
    }

    const access = await resolveReportOrganizationForUserFn({
      user: req.user,
      requestedOrgSlug: validated.value.orgSlug,
      requestedOrgId: validated.value.orgId,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.message, code: access.error });
    }

    try {
      const { report } = await generateReportFn({
        user: req.user,
        organization: access.organization,
        stage: validated.value.stage,
        dateFrom: validated.value.dateFrom,
        dateTo: validated.value.dateTo,
        format: validated.value.format,
        context: validated.value.context,
      });
      const downloadUrl = `/api/reports/${report.id}`;
      return res.json({
        report_id: report.id,
        download_url: downloadUrl,
        expires_at: report.expires_at,
        response_count: Number(report?.meta?.responseCount || 0) || undefined,
      });
    } catch (error) {
      const code = error?.code || 'GENERATION_FAILED';
      const status = code === 'INSUFFICIENT_DATA' ? 400 : 500;
      return res.status(status).json({ error: error?.message || 'Generation failed', code });
    }
  });

  router.get('/download/:reportId', async (req, res) => {
    const token = verifyReportDownloadTokenFn(req.query?.token);
    if (!token || token.reportId !== req.params.reportId || token.userId !== req.user.id) {
      return res.status(403).json({ error: 'Invalid or expired download token' });
    }
    const report = await generatedReportModel.getGeneratedReportById(req.params.reportId);
    if (!report || report.status !== 'complete') {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (String(report.organization_id) !== token.organizationId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const access = await resolveReportOrganizationForUserFn({
      user: req.user,
      requestedOrgSlug: null,
      requestedOrgId: report.organization_id,
    });
    if (!access.ok) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (new Date(report.expires_at).getTime() <= Date.now()) {
      return res.status(404).json({ error: 'Report has expired' });
    }
    if (!fileExistsFn(report.file_path)) {
      return res.status(404).json({ error: 'Report file not found' });
    }
    const filename = basenameFn(report.file_path);
    return res.download(report.file_path, filename);
  });

  router.get('/:reportId', async (req, res) => {
    const report = await generatedReportModel.getGeneratedReportById(req.params.reportId);
    if (!report || report.status !== 'complete') {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (new Date(report.expires_at).getTime() <= Date.now()) {
      return res.status(404).json({ error: 'Report has expired' });
    }
    const access = await resolveReportOrganizationForUserFn({
      user: req.user,
      requestedOrgSlug: null,
      requestedOrgId: report.organization_id,
    });
    if (!access.ok) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (String(access.organization.id) !== String(report.organization_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const token = createReportDownloadTokenFn({
      reportId: report.id,
      userId: req.user.id,
      organizationId: report.organization_id,
    });
    return res.redirect(302, `/api/reports/download/${report.id}?token=${encodeURIComponent(token)}`);
  });

  return router;
}

export default createReportsRoutes();
