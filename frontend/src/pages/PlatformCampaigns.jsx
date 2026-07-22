import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, X, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Users2, ArrowUpRight, GitBranch, Megaphone,
} from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import {
  CAMPAIGN_CHANNELS, campaignChannelLabel,
  CAMPAIGN_STATUSES, campaignStatusLabel, campaignStatusBadgeClass,
  ATL_BTL_OPTIONS, atlBtlLabel,
} from '../config/crmConstants.js';
import { describeCustomFilter } from '../utils/customFilters.js';
import '../styles/crm.css';

const EMPTY_CAMPAIGN = { name: '', description: '', objective: '', atl_btl: '', channels: [], owner_label: '', status: 'draft' };
const EMPTY_STAGE = { name: '', who_filter_id: '', channel: '', links_to: '', blocker: '', branch_yes: '', branch_no: '', notes: '' };

export default function PlatformCampaigns() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [campaigns, setCampaigns] = useState([]);
  const [customFilters, setCustomFilters] = useState([]);
  const [fetching, setFetching] = useState(false);

  const [campaignModal, setCampaignModal] = useState(null); // { editing: campaign|null }
  const [campaignForm, setCampaignForm] = useState(EMPTY_CAMPAIGN);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignError, setCampaignError] = useState('');

  const [stageModal, setStageModal] = useState(null); // { campaignId, editing: stage|null }
  const [stageForm, setStageForm] = useState(EMPTY_STAGE);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState('');

  useDocumentTitle(!loading && ok ? `Campaigns | ${DEFAULT_TAB}` : null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const [{ data: campData }, { data: filterData }] = await Promise.all([
        api.get('/api/platform/campaigns'),
        api.get('/api/platform/custom-filters'),
      ]);
      setCampaigns(campData.campaigns || []);
      setCustomFilters(filterData.customFilters || []);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load campaigns.', { variant: 'error' });
    } finally {
      setFetching(false);
    }
  }, [showToast]);

  useEffect(() => { if (ok) load(); }, [ok, load]);

  // ── Campaign CRUD ────────────────────────────────────────────────────────
  function openCreateCampaign() {
    setCampaignForm(EMPTY_CAMPAIGN);
    setCampaignError('');
    setCampaignModal({ editing: null });
  }
  function openEditCampaign(c) {
    setCampaignForm({
      name: c.name || '', description: c.description || '', objective: c.objective || '',
      atl_btl: c.atl_btl || '', channels: Array.isArray(c.channels) ? c.channels : [],
      owner_label: c.owner_label || '', status: c.status || 'draft',
    });
    setCampaignError('');
    setCampaignModal({ editing: c });
  }
  function toggleChannel(id) {
    setCampaignForm((p) => {
      const set = new Set(p.channels);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...p, channels: [...set] };
    });
  }
  async function saveCampaign(e) {
    e.preventDefault();
    if (!campaignForm.name.trim()) { setCampaignError('A campaign name is required.'); return; }
    setCampaignBusy(true); setCampaignError('');
    const payload = { ...campaignForm, name: campaignForm.name.trim(), atl_btl: campaignForm.atl_btl || null };
    try {
      if (campaignModal.editing) {
        await api.patch(`/api/platform/campaigns/${campaignModal.editing.campaign_id}`, payload);
        showToast('Campaign updated.', { variant: 'success' });
      } else {
        await api.post('/api/platform/campaigns', payload);
        showToast('Campaign created.', { variant: 'success' });
      }
      setCampaignModal(null);
      load();
    } catch (err) {
      setCampaignError(err.response?.data?.error || 'Failed to save campaign.');
    } finally {
      setCampaignBusy(false);
    }
  }
  async function deleteCampaign(c) {
    if (!window.confirm(`Delete campaign "${c.name}" and all its stages? This can't be undone.`)) return;
    try {
      await api.delete(`/api/platform/campaigns/${c.campaign_id}`);
      showToast('Campaign deleted.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete campaign.', { variant: 'error' });
    }
  }
  async function setStatus(c, status) {
    try {
      await api.patch(`/api/platform/campaigns/${c.campaign_id}`, { status });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update status.', { variant: 'error' });
    }
  }

  // ── Stage CRUD ───────────────────────────────────────────────────────────
  function openCreateStage(campaignId) {
    setStageForm(EMPTY_STAGE);
    setStageError('');
    setStageModal({ campaignId, editing: null });
  }
  function openEditStage(campaignId, s) {
    setStageForm({
      name: s.name || '', who_filter_id: s.who_filter_id ? String(s.who_filter_id) : '',
      channel: s.channel || '', links_to: s.links_to || '', blocker: s.blocker || '',
      branch_yes: s.branch_yes || '', branch_no: s.branch_no || '', notes: s.notes || '',
    });
    setStageError('');
    setStageModal({ campaignId, editing: s });
  }
  async function saveStage(e) {
    e.preventDefault();
    if (!stageForm.name.trim()) { setStageError('A stage name is required.'); return; }
    setStageBusy(true); setStageError('');
    const payload = {
      ...stageForm,
      name: stageForm.name.trim(),
      who_filter_id: stageForm.who_filter_id ? Number(stageForm.who_filter_id) : null,
      channel: stageForm.channel || null,
    };
    try {
      const base = `/api/platform/campaigns/${stageModal.campaignId}/stages`;
      if (stageModal.editing) {
        await api.patch(`${base}/${stageModal.editing.stage_id}`, payload);
        showToast('Stage updated.', { variant: 'success' });
      } else {
        await api.post(base, payload);
        showToast('Stage added.', { variant: 'success' });
      }
      setStageModal(null);
      load();
    } catch (err) {
      setStageError(err.response?.data?.error || 'Failed to save stage.');
    } finally {
      setStageBusy(false);
    }
  }
  async function deleteStage(campaignId, s) {
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    try {
      await api.delete(`/api/platform/campaigns/${campaignId}/stages/${s.stage_id}`);
      showToast('Stage deleted.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete stage.', { variant: 'error' });
    }
  }

  // ── Reordering (swap positions with a neighbour) ───────────────────────────
  async function moveCampaign(index, dir) {
    const other = campaigns[index + dir];
    const cur = campaigns[index];
    if (!other || !cur) return;
    try {
      await Promise.all([
        api.patch(`/api/platform/campaigns/${cur.campaign_id}`, { position: other.position }),
        api.patch(`/api/platform/campaigns/${other.campaign_id}`, { position: cur.position }),
      ]);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reorder.', { variant: 'error' });
    }
  }
  async function moveStage(campaignId, stages, index, dir) {
    const other = stages[index + dir];
    const cur = stages[index];
    if (!other || !cur) return;
    try {
      await Promise.all([
        api.patch(`/api/platform/campaigns/${campaignId}/stages/${cur.stage_id}`, { position: other.position }),
        api.patch(`/api/platform/campaigns/${campaignId}/stages/${other.stage_id}`, { position: cur.position }),
      ]);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reorder.', { variant: 'error' });
    }
  }

  const sharedFilters = customFilters.filter((f) => f.scope === 'shared');
  const personalFilters = customFilters.filter((f) => f.scope === 'personal');

  function StageCard({ campaign, stage, index }) {
    const whoName = stage.who_filter_name;
    return (
      <div className="campaign-stage">
        <div className="campaign-stage__head">
          <span className="campaign-stage__pos">{index + 1}</span>
          <span className="campaign-stage__name">{stage.name}</span>
          <div className="campaign-stage__tools">
            <button type="button" className="icon-btn" title="Move up" disabled={index === 0} onClick={() => moveStage(campaign.campaign_id, campaign.stages, index, -1)}><ChevronUp size={14} aria-hidden /></button>
            <button type="button" className="icon-btn" title="Move down" disabled={index === campaign.stages.length - 1} onClick={() => moveStage(campaign.campaign_id, campaign.stages, index, 1)}><ChevronDown size={14} aria-hidden /></button>
            <button type="button" className="icon-btn" title="Edit stage" onClick={() => openEditStage(campaign.campaign_id, stage)}><Pencil size={14} aria-hidden /></button>
            <button type="button" className="icon-btn icon-btn--danger" title="Delete stage" onClick={() => deleteStage(campaign.campaign_id, stage)}><Trash2 size={14} aria-hidden /></button>
          </div>
        </div>
        <div className="campaign-stage__meta">
          {stage.channel && <span className="badge badge-channel">{campaignChannelLabel(stage.channel)}</span>}
          {whoName ? (
            <button
              type="button"
              className="badge badge--link campaign-stage__who"
              title={`Open contacts in “${whoName}”`}
              onClick={() => navigate(`/platform/contacts?customFilter=${stage.who_filter_id}`)}
            >
              <Users2 size={11} strokeWidth={2} aria-hidden /> {whoName}
              <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <span className="badge campaign-stage__who campaign-stage__who--none">No audience</span>
          )}
        </div>
        {stage.links_to && (
          <div className="campaign-stage__row"><span className="campaign-stage__label">Links to</span> {stage.links_to}</div>
        )}
        {stage.blocker && (
          <div className="campaign-stage__branch">
            <div className="campaign-stage__row"><GitBranch size={12} aria-hidden /> <span className="campaign-stage__label">If</span> {stage.blocker}</div>
            {stage.branch_yes && <div className="campaign-stage__row campaign-stage__row--yes"><span className="campaign-stage__label">Yes →</span> {stage.branch_yes}</div>}
            {stage.branch_no && <div className="campaign-stage__row campaign-stage__row--no"><span className="campaign-stage__label">No →</span> {stage.branch_no}</div>}
          </div>
        )}
        {stage.notes && <div className="campaign-stage__notes">{stage.notes}</div>}
      </div>
    );
  }

  function CampaignLane({ campaign, index }) {
    const channels = Array.isArray(campaign.channels) ? campaign.channels : [];
    return (
      <div className="campaign-lane">
        <div className="campaign-lane__head">
          <div className="campaign-lane__title-row">
            <div className="campaign-lane__reorder">
              <button type="button" className="icon-btn" title="Move left" disabled={index === 0} onClick={() => moveCampaign(index, -1)}><ChevronLeft size={15} aria-hidden /></button>
              <button type="button" className="icon-btn" title="Move right" disabled={index === campaigns.length - 1} onClick={() => moveCampaign(index, 1)}><ChevronRight size={15} aria-hidden /></button>
            </div>
            <h2 className="campaign-lane__name">
              <button type="button" className="campaign-lane__name-link" onClick={() => navigate(`/platform/campaigns/${campaign.campaign_id}`)} title="Open campaign (flow &amp; quiz results)">
                {campaign.name}
              </button>
            </h2>
            <div className="campaign-lane__tools">
              <button type="button" className="icon-btn" title="Edit campaign" onClick={() => openEditCampaign(campaign)}><Pencil size={15} aria-hidden /></button>
              <button type="button" className="icon-btn icon-btn--danger" title="Delete campaign" onClick={() => deleteCampaign(campaign)}><Trash2 size={15} aria-hidden /></button>
            </div>
          </div>

          <div className="campaign-lane__badges">
            <select
              className={`campaign-status-select ${campaignStatusBadgeClass(campaign.status)}`}
              value={campaign.status}
              onChange={(e) => setStatus(campaign, e.target.value)}
              aria-label="Campaign status"
            >
              {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {campaign.atl_btl && <span className="badge badge-atl-btl">{atlBtlLabel(campaign.atl_btl)}</span>}
            {channels.map((ch) => <span key={ch} className="badge badge-channel">{campaignChannelLabel(ch)}</span>)}
          </div>

          {campaign.objective && <div className="campaign-lane__objective">🎯 {campaign.objective}</div>}
          {campaign.owner_label && <div className="campaign-lane__owner">Owner: {campaign.owner_label}</div>}
        </div>

        <div className="campaign-lane__stages">
          {campaign.stages.length === 0 && <p className="muted campaign-lane__empty">No stages yet.</p>}
          {campaign.stages.map((s, i) => (
            <StageCard key={s.stage_id} campaign={campaign} stage={s} index={i} />
          ))}
        </div>

        <button type="button" className="btn btn-ghost campaign-lane__add" onClick={() => openCreateStage(campaign.campaign_id)}>
          <Plus size={16} strokeWidth={2} aria-hidden /> Add stage
        </button>
      </div>
    );
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Megaphone size={26} strokeWidth={1.75} aria-hidden /> Campaigns
          </h1>
          <button className="btn btn-primary" onClick={openCreateCampaign}>
            <Plus size={18} strokeWidth={2} aria-hidden /> New campaign
          </button>
        </div>
        <p className="muted" style={{ marginTop: '-0.5rem', maxWidth: '70ch' }}>
          Always-on Marketing &amp; BDM plays as swimlanes. Each stage targets a custom filter (the WHO) — click it to open
          those contacts. Sending still happens in your outreach tools; this is the plan and the audience.
        </p>

        {fetching && campaigns.length === 0 ? (
          <p className="muted" style={{ padding: '2rem 0' }}>Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <div className="campaign-empty">
            <Megaphone size={32} strokeWidth={1.5} aria-hidden />
            <p>No campaigns yet.</p>
            <button className="btn btn-primary" onClick={openCreateCampaign}>
              <Plus size={18} strokeWidth={2} aria-hidden /> Create your first campaign
            </button>
          </div>
        ) : (
          <div className="campaign-board">
            {campaigns.map((c, i) => <CampaignLane key={c.campaign_id} campaign={c} index={i} />)}
          </div>
        )}
      </div>

      {campaignModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--custom-filter card" role="dialog" aria-modal aria-labelledby="campaign-modal-title">
            <div className="modal-dialog__head">
              <h2 id="campaign-modal-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>{campaignModal.editing ? 'Edit campaign' : 'New campaign'}</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setCampaignModal(null)} aria-label="Close"><X size={22} aria-hidden /></button>
            </div>
            <form onSubmit={saveCampaign} style={{ marginTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="campaign-name">Name *</label>
                  <input id="campaign-name" value={campaignForm.name} onChange={(e) => setCampaignForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="campaign-owner">Owner</label>
                  <input id="campaign-owner" value={campaignForm.owner_label} onChange={(e) => setCampaignForm((p) => ({ ...p, owner_label: e.target.value }))} placeholder="e.g. BDM · MD network" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="campaign-status">Status</label>
                  <select id="campaign-status" value={campaignForm.status} onChange={(e) => setCampaignForm((p) => ({ ...p, status: e.target.value }))}>
                    {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="campaign-atl-btl">ATL / BTL</label>
                  <select id="campaign-atl-btl" value={campaignForm.atl_btl} onChange={(e) => setCampaignForm((p) => ({ ...p, atl_btl: e.target.value }))}>
                    <option value="">—</option>
                    {ATL_BTL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="campaign-objective">Objective</label>
                  <input id="campaign-objective" value={campaignForm.objective} onChange={(e) => setCampaignForm((p) => ({ ...p, objective: e.target.value }))} placeholder="e.g. 5 demos / month" />
                </div>
              </div>
              <div className="field">
                <label>Channels</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', marginTop: '0.25rem' }}>
                  {CAMPAIGN_CHANNELS.map((ch) => (
                    <label key={ch.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 400, cursor: 'pointer' }}>
                      <input type="checkbox" checked={campaignForm.channels.includes(ch.id)} onChange={() => toggleChannel(ch.id)} />
                      {ch.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="campaign-desc">Description</label>
                <input id="campaign-desc" value={campaignForm.description} onChange={(e) => setCampaignForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" />
              </div>
              {campaignError && <p className="error">{campaignError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setCampaignModal(null)} disabled={campaignBusy}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={campaignBusy}>{campaignBusy ? 'Saving…' : (campaignModal.editing ? 'Save campaign' : 'Create campaign')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stageModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--custom-filter card" role="dialog" aria-modal aria-labelledby="stage-modal-title">
            <div className="modal-dialog__head">
              <h2 id="stage-modal-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>{stageModal.editing ? 'Edit stage' : 'Add stage'}</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setStageModal(null)} aria-label="Close"><X size={22} aria-hidden /></button>
            </div>
            <form onSubmit={saveStage} style={{ marginTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="stage-name">Stage name *</label>
                  <input id="stage-name" value={stageForm.name} onChange={(e) => setStageForm((p) => ({ ...p, name: e.target.value }))} required autoFocus placeholder="e.g. Message #1" />
                </div>
                <div className="field">
                  <label htmlFor="stage-channel">Channel</label>
                  <select id="stage-channel" value={stageForm.channel} onChange={(e) => setStageForm((p) => ({ ...p, channel: e.target.value }))}>
                    <option value="">—</option>
                    {CAMPAIGN_CHANNELS.map((ch) => <option key={ch.id} value={ch.id}>{ch.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="stage-who">WHO — audience (custom filter)</label>
                <select id="stage-who" value={stageForm.who_filter_id} onChange={(e) => setStageForm((p) => ({ ...p, who_filter_id: e.target.value }))}>
                  <option value="">— No audience —</option>
                  {sharedFilters.length > 0 && (
                    <optgroup label="Shared">
                      {sharedFilters.map((f) => <option key={f.filter_id} value={f.filter_id}>{f.name}</option>)}
                    </optgroup>
                  )}
                  {personalFilters.length > 0 && (
                    <optgroup label="Personal">
                      {personalFilters.map((f) => <option key={f.filter_id} value={f.filter_id}>{f.name}</option>)}
                    </optgroup>
                  )}
                </select>
                {stageForm.who_filter_id && (
                  <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>
                    {describeCustomFilter(customFilters.find((f) => String(f.filter_id) === String(stageForm.who_filter_id))?.definition)}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="stage-links">Links to</label>
                <input id="stage-links" value={stageForm.links_to} onChange={(e) => setStageForm((p) => ({ ...p, links_to: e.target.value }))} placeholder="e.g. Quiz landing page, 1-pager, demo video" />
              </div>
              <div className="field">
                <label htmlFor="stage-blocker">Blocker / condition</label>
                <input id="stage-blocker" value={stageForm.blocker} onChange={(e) => setStageForm((p) => ({ ...p, blocker: e.target.value }))} placeholder="e.g. No reply after 5 days?" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="stage-yes">If yes →</label>
                  <input id="stage-yes" value={stageForm.branch_yes} onChange={(e) => setStageForm((p) => ({ ...p, branch_yes: e.target.value }))} placeholder="e.g. Move to cold email" />
                </div>
                <div className="field">
                  <label htmlFor="stage-no">If no →</label>
                  <input id="stage-no" value={stageForm.branch_no} onChange={(e) => setStageForm((p) => ({ ...p, branch_no: e.target.value }))} placeholder="e.g. Continue to next message" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="stage-notes">Notes</label>
                <input id="stage-notes" value={stageForm.notes} onChange={(e) => setStageForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
              </div>
              {stageError && <p className="error">{stageError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setStageModal(null)} disabled={stageBusy}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={stageBusy}>{stageBusy ? 'Saving…' : (stageModal.editing ? 'Save stage' : 'Add stage')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
