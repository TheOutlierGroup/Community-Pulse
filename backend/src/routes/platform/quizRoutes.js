import { Router } from 'express';
import * as Quiz from '../../models/Quiz.js';
import { getCampaign } from '../../models/Campaign.js';
import { parseSubmittedAt } from '../../services/quizImport.js';
import { auditFromRequest, AUDIT_ACTIONS } from '../../services/auditLog.js';

const router = Router();

function orgId(req) { return req.user.organizationId; }
function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Only admins can manage quizzes.' }); return false; }
  return true;
}

const MAX_ENTRY_ROWS = 10000;

// ── Read (all workspace users) ─────────────────────────────────────────────

router.get('/campaigns/:id/quizzes', async (req, res) => {
  try {
    const campaign = await getCampaign(orgId(req), req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
    const quizzes = await Quiz.listQuizzesForCampaign(orgId(req), campaign.campaign_id);
    res.json({ quizzes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load quizzes.' });
  }
});

router.get('/quizzes', async (req, res) => {
  try {
    res.json({ quizzes: await Quiz.listAllQuizzes(orgId(req)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load quizzes.' });
  }
});

router.get('/quizzes/:id/entries', async (req, res) => {
  try {
    const quiz = await Quiz.getQuiz(orgId(req), req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    res.json({ entries: await Quiz.listEntries(quiz.quiz_id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load quiz entries.' });
  }
});

// ── Write (admins only) ────────────────────────────────────────────────────

router.post('/quizzes', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    if (!String(req.body?.name || '').trim()) return res.status(400).json({ error: 'A quiz name is required.' });
    const quiz = await Quiz.createQuiz(orgId(req), req.body, req.user.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_CREATE, targetType: 'quiz', targetId: String(quiz.quiz_id),
      targetOrganizationId: orgId(req), metadata: { name: quiz.name },
    });
    res.status(201).json({ quiz: { ...quiz, entry_count: 0 } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create quiz.' });
  }
});

router.patch('/quizzes/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const existing = await Quiz.getQuiz(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' });
    if ('name' in req.body && !String(req.body.name || '').trim()) return res.status(400).json({ error: 'A quiz name is required.' });
    const quiz = await Quiz.updateQuiz(orgId(req), req.params.id, req.body);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_UPDATE, targetType: 'quiz', targetId: String(req.params.id),
      targetOrganizationId: orgId(req), metadata: { name: quiz.name },
    });
    res.json({ quiz });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update quiz.' });
  }
});

router.delete('/quizzes/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const existing = await Quiz.getQuiz(orgId(req), req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' });
    await Quiz.deleteQuiz(orgId(req), req.params.id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_DELETE, targetType: 'quiz', targetId: String(req.params.id),
      targetOrganizationId: orgId(req), metadata: { name: existing.name },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete quiz.' });
  }
});

router.post('/campaigns/:id/quizzes', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const campaign = await getCampaign(orgId(req), req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
    const quiz = await Quiz.getQuiz(orgId(req), req.body?.quiz_id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    await Quiz.linkQuizToCampaign(campaign.campaign_id, quiz.quiz_id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_CAMPAIGN_LINK, targetType: 'quiz', targetId: String(quiz.quiz_id),
      targetOrganizationId: orgId(req), metadata: { campaignId: campaign.campaign_id, name: quiz.name },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to link quiz.' });
  }
});

router.delete('/campaigns/:id/quizzes/:quizId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const campaign = await getCampaign(orgId(req), req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
    const quiz = await Quiz.getQuiz(orgId(req), req.params.quizId);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    await Quiz.unlinkQuizFromCampaign(campaign.campaign_id, quiz.quiz_id);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_CAMPAIGN_UNLINK, targetType: 'quiz', targetId: String(quiz.quiz_id),
      targetOrganizationId: orgId(req), metadata: { campaignId: campaign.campaign_id },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to unlink quiz.' });
  }
});

router.post('/quizzes/:id/entries/import', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const quiz = await Quiz.getQuiz(orgId(req), req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    const entries = req.body?.entries;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'No entries to import.' });
    if (entries.length > MAX_ENTRY_ROWS) {
      return res.status(400).json({ error: `Too many rows (${entries.length}). Split into batches of ${MAX_ENTRY_ROWS} or fewer.` });
    }
    const summary = await Quiz.ingestEntries(orgId(req), quiz.quiz_id, entries, parseSubmittedAt);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.QUIZ_ENTRIES_IMPORT, targetType: 'quiz', targetId: String(quiz.quiz_id),
      targetOrganizationId: orgId(req), metadata: { name: quiz.name, ...summary },
    });
    res.json({ summary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to import quiz entries.' });
  }
});

export default router;
