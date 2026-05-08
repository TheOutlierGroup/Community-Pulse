import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { orgLogoFilePath, reportFilePath } from '../config/storage.js';
import * as GeneratedReport from '../models/GeneratedReport.js';
import * as Organization from '../models/Organization.js';
import { assembleReportData } from './reportDataAssembler.js';
import { generateReportSignals } from './reportAiSignals.js';
import { buildReportDocx } from './reportDocxBuilder.js';
import { REPORT_STORAGE_DAYS } from './reportConfig.js';
import { resolveBrandForOrganization } from './licenseeBrand.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTLIER_LOGO_PATH = path.resolve(__dirname, '../assets/outlier-logo.png');

let cachedOutlierLogoBuffer;
async function loadOutlierLogoBuffer() {
  if (cachedOutlierLogoBuffer !== undefined) return cachedOutlierLogoBuffer;
  try {
    cachedOutlierLogoBuffer = await fs.readFile(OUTLIER_LOGO_PATH);
  } catch (error) {
    console.error('Failed to load Outlier brand logo for report:', error);
    cachedOutlierLogoBuffer = null;
  }
  return cachedOutlierLogoBuffer;
}

async function loadCompanyLogoBuffer(organization) {
  const filename = organization?.company_logo_filename;
  if (!filename) return null;
  try {
    const safeName = path.basename(String(filename));
    const full = orgLogoFilePath(safeName);
    if (!fsSync.existsSync(full)) return null;
    return await fs.readFile(full);
  } catch (error) {
    console.error('Failed to read client company logo for report:', error);
    return null;
  }
}

function reportExpiresAtDate() {
  return new Date(Date.now() + REPORT_STORAGE_DAYS * 24 * 60 * 60 * 1000);
}

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * INF-07 brand resolver for the DOCX generator. Walks org → parent
 * licensee → licence_config and reads the licensee org's logo file from
 * disk so it can be embedded directly in the cover page. Returns null
 * when the report is for a platform-direct client (the report falls back
 * to default Outlier styling).
 */
async function resolveReportBrand(organization) {
  if (!organization) return null;
  try {
    const brand = await resolveBrandForOrganization(organization);
    if (!brand) return null;
    let logoBuffer = null;
    if (brand.licenseeOrganizationId) {
      const licenseeOrg = await Organization.getOrganization(brand.licenseeOrganizationId);
      const filename = licenseeOrg?.company_logo_filename;
      if (filename) {
        const safeName = path.basename(String(filename));
        const full = orgLogoFilePath(safeName);
        try {
          if (fsSync.existsSync(full)) {
            logoBuffer = await fs.readFile(full);
          }
        } catch (error) {
          console.error('Failed to read licensee brand logo for report:', error);
        }
      }
    }
    return {
      displayName: brand.displayName,
      primaryColor: brand.primaryColor,
      logoBuffer,
    };
  } catch (error) {
    console.error('Failed to resolve brand for report:', error);
    return null;
  }
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
    const brand = await resolveReportBrand(organization);
    const [outlierLogoBuffer, companyLogoBuffer] = await Promise.all([
      loadOutlierLogoBuffer(),
      loadCompanyLogoBuffer(organization),
    ]);
    const docxBuffer = await buildReportDocx({
      reportData,
      signals,
      context,
      brand,
      outlierLogoBuffer,
      companyLogoBuffer,
    });

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
