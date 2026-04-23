import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { reportFilePath } from '../config/storage.js';
import * as GeneratedReport from '../models/GeneratedReport.js';
import { assembleReportData } from './reportDataAssembler.js';
import { generateReportSignals } from './reportAiSignals.js';
import { buildReportDocx } from './reportDocxBuilder.js';
import { REPORT_STORAGE_DAYS } from './reportConfig.js';

const execFileAsync = promisify(execFile);

function reportExpiresAtDate() {
  return new Date(Date.now() + REPORT_STORAGE_DAYS * 24 * 60 * 60 * 1000);
}

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

async function convertDocxToPdf(docxPath) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-report-'));
  try {
    await execFileAsync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath], {
      timeout: 20000,
    });
    const pdfName = `${path.basename(docxPath, '.docx')}.pdf`;
    const pdfPath = path.join(outDir, pdfName);
    const pdfBytes = await fs.readFile(pdfPath);
    return pdfBytes;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

export async function generateReport({
  user,
  organization,
  stage,
  dateFrom = null,
  dateTo = null,
  format,
  context = {},
}) {
  // Validate and assemble report inputs before creating a database row.
  // This prevents failed validation (e.g. insufficient responses) from creating ghost report entries.
  const reportData = await assembleReportData({
    organization,
    stage,
    dateFrom,
    dateTo,
  });

  const placeholderFilename = `${organization.slug || organization.id}_${stage}_${isoDay()}_${randomUUID()}.${format}`;
  const pending = await GeneratedReport.createGeneratedReport({
    organizationId: organization.id,
    generatedBy: user.id,
    stage,
    dateFrom,
    dateTo,
    format,
    filePath: reportFilePath(placeholderFilename),
    expiresAt: reportExpiresAtDate().toISOString(),
    status: 'pending',
    meta: { stage, format },
  });

  try {
    const signals = await generateReportSignals(reportData, context);
    const docxBuffer = await buildReportDocx({ reportData, signals });

    const reportId = pending.id;
    const dateStamp = isoDay();
    const extension = format === 'pdf' ? 'pdf' : 'docx';
    const filename = `${organization.slug || organization.id}_${stage}_${dateStamp}_${reportId}.${extension}`;
    const fullPath = reportFilePath(filename);

    if (format === 'pdf') {
      const tmpDocxPath = path.join(os.tmpdir(), `${reportId}.docx`);
      await fs.writeFile(tmpDocxPath, docxBuffer);
      try {
        const pdfBuffer = await convertDocxToPdf(tmpDocxPath);
        await fs.writeFile(fullPath, pdfBuffer);
      } finally {
        await fs.rm(tmpDocxPath, { force: true });
      }
    } else {
      await fs.writeFile(fullPath, docxBuffer);
    }

    const updated = await GeneratedReport.markGeneratedReportComplete(pending.id, {
      format,
      filePath: fullPath,
      expiresAt: reportExpiresAtDate().toISOString(),
      meta: {
        generatedBy: user.id,
        responseCount: reportData.totals.responses,
        stage,
      },
    });

    return {
      report: updated,
      reportData,
    };
  } catch (error) {
    await GeneratedReport.markGeneratedReportFailed(pending.id, error?.message || 'Generation failed');
    throw error;
  }
}
