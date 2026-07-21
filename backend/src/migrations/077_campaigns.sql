-- Campaigns: always-on Marketing/BDM plays, shown as swimlanes. Each campaign
-- is one lane (a channel/track) with an ordered flow of stages. The CRM does
-- not send anything — external tools (MeetAlfred, email, ad managers) do; a
-- campaign is the plan + the audience definition, not a sender.
--
-- A campaign is multichannel (channels[]), optionally classified above/below
-- the line (atl_btl), and has a lifecycle status. Stages are the flow boxes:
-- each targets a WHO (a custom filter), names how it goes out (channel) and
-- what it links to, and can carry a blocker with if-yes / if-no branches.
CREATE TABLE campaigns (
  campaign_id     SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  objective       TEXT,
  atl_btl         TEXT CHECK (atl_btl IN ('atl', 'btl')),
  channels        TEXT[] NOT NULL DEFAULT '{}',
  owner_label     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  position        INTEGER NOT NULL DEFAULT 0,
  platform_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE campaign_stages (
  stage_id      SERIAL PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  -- WHO the stage targets. ON DELETE SET NULL so deleting a custom filter
  -- doesn't delete campaign history — the stage just loses its audience link.
  who_filter_id INTEGER REFERENCES crm_custom_filters(filter_id) ON DELETE SET NULL,
  channel       TEXT,
  links_to      TEXT,
  blocker       TEXT,
  branch_yes    TEXT,
  branch_no     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_platform_org ON campaigns(platform_org_id);
CREATE INDEX idx_campaign_stages_campaign ON campaign_stages(campaign_id);
