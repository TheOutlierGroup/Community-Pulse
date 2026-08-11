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
// BRAND-01: reports are a Rhythm Engine artefact and are routinely
// delivered by Practitioners to their own clients, so the default mark on
// the cover is the Rhythm Engine logo, not Outlier's. A licensee that has
// uploaded its own white-label logo still displaces this (see
// coverLogoStack in reportDocxBuilder.js).
const DEFAULT_REPORT_LOGO_PATH = path.resolve(__dirname, '../assets/rhythm-engine-logo.png');

let cachedDefaultLogoBuffer;
async function loadDefaultReportLogoBuffer() {
  if (cachedDefaultLogoBuffer !== undefined) return cachedDefaultLogoBuffer;
  try {
    cachedDefaultLogoBuffer = await fs.readFile(DEFAULT_REPORT_LOGO_PATH);
  } catch (error) {
    console.error('Failed to load Rhythm Engine brand logo for report:', error);
    cachedDefaultLogoBuffer = null;
  }
  return cachedDefaultLogoBuffer;
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

// D-017: PDF export previously shelled out to `libreoffice` with no
// per-call profile isolation and a 20s timeout, and any failure (most
// commonly: the binary isn't installed at all -- see the Dockerfile) rode
// an uncaught error straight to the client as an opaque 500.
//
// -env:UserInstallation gives each conversion its own scratch profile
// directory rather than sharing LibreOffice's default one. Without this,
// two report generations landing on the same instance at once can hit a
// profile lock and fail unpredictably -- the same failure mode the docx
// skill's soffice.py helper works around for the same reason.
const PDF_MAGIC = Buffer.from('%PDF-');
// "We can't open this file" on a downloaded report: soffice killed by the
// timeout (or crashed/OOM'd) mid-write still leaves a partial file behind
// on disk, and `--convert-to` can also exit 0 having written a truncated
// PDF for a document it choked on. Either way execFileAsync doesn't throw
// and fs.readFile happily returns whatever bytes exist, so a broken file
// sailed straight through to report status 'complete' and was served as
// a normal download. Validate the shape actually looks like a complete
// PDF before trusting it, so a bad conversion fails the generation (report
// status 'failed', visible and re-triable) instead of silently shipping
// corruption.
export function looksLikeCompletePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) return false;
  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) return false;
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
  return tail.includes('%%EOF');
}

async function convertDocxToPdf(docxPath) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-report-'));
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-report-profile-'));
  try {
    try {
      await execFileAsync(
        'soffice',
        [
          `-env:UserInstallation=file://${profileDir}`,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          outDir,
          docxPath,
        ],
        { timeout: 45000 }
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('PDF conversion is unavailable on this server (LibreOffice is not installed).');
      }
      throw new Error(`PDF conversion failed: ${error?.message || 'unknown error'}`);
    }
    const pdfName = `${path.basename(docxPath, '.docx')}.pdf`;
    const pdfPath = path.join(outDir, pdfName);
    let pdfBuffer;
    try {
      pdfBuffer = await fs.readFile(pdfPath);
    } catch {
      throw new Error('PDF conversion did not produce an output file.');
    }
    if (!looksLikeCompletePdf(pdfBuffer)) {
      throw new Error('PDF conversion produced an incomplete or invalid file.');
    }
    return pdfBuffer;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.rm(profileDir, { recursive: true, force: true });
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
    const [defaultLogoBuffer, companyLogoBuffer] = await Promise.all([
      loadDefaultReportLogoBuffer(),
      loadCompanyLogoBuffer(organization),
    ]);
    const docxBuffer = await buildReportDocx({
      reportData,
      signals,
      context,
      brand,
      defaultLogoBuffer,
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
