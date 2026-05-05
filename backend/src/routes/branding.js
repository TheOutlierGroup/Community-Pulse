import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { ensureStorageDirs, orgLogoFilePath } from '../config/storage.js';
import * as Organization from '../models/Organization.js';
import { resolveBrandForOrganization, publicBrand } from '../services/licenseeBrand.js';

const router = Router();

/**
 * INF-06: public branding endpoints. Used by the white-labeled
 * Rhythm Engine survey pages so respondents see the licensee's brand
 * without ever logging in. Only licensee orgs are exposed here — client
 * and platform org logos remain behind auth.
 */
router.get('/licensees/:id/logo', async (req, res) => {
  try {
    const org = await Organization.getOrganization(req.params.id);
    if (!org || org.kind !== 'licensee' || !org.company_logo_filename) {
      return res.status(404).end();
    }
    const safeName = path.basename(org.company_logo_filename);
    const full = path.resolve(orgLogoFilePath(safeName));
    const { orgLogosDir } = ensureStorageDirs();
    const root = path.resolve(orgLogosDir);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(403).end();
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', contentTypeForFilename(safeName));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(full);
  } catch (error) {
    console.error('Failed to serve licensee brand logo:', error);
    res.status(500).end();
  }
});

router.get('/licensees/:id', async (req, res) => {
  try {
    const org = await Organization.getOrganization(req.params.id);
    if (!org || org.kind !== 'licensee') return res.status(404).end();
    const brand = await resolveBrandForOrganization(org);
    res.json({ brand: publicBrand(brand) });
  } catch (error) {
    console.error('Failed to resolve public brand:', error);
    res.status(500).end();
  }
});

function contentTypeForFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

export default router;
