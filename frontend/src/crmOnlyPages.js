/**
 * BRAND-02: pages App.jsx only renders behind `!IS_RHYTHM_ENGINE_SURFACE`
 * — never reachable on the pulse surface today — named by their import
 * filename. Shared by AppRhythmEngine.test.js (source-text check) and
 * scripts/verify-surface-bundles.js (real dual-build check) so the two
 * don't drift into checking different lists. Keep in sync with App.jsx's
 * route gates.
 */
export const CRM_ONLY_PAGE_IMPORTS = [
  'Login.jsx',
  'ForgotPassword.jsx',
  'ResetPassword.jsx',
  'InviteAccept.jsx',
  'PlatformHome.jsx',
  'PlatformClients.jsx',
  'PlatformTasks.jsx',
  'PlatformClientOverview.jsx',
  'PlatformClientUsers.jsx',
  'PlatformClientTasks.jsx',
  'PlatformClientProjects.jsx',
  'PlatformClientActivity.jsx',
  'PlatformClientAccount.jsx',
  'PlatformUsers.jsx',
  'PlatformSettings.jsx',
  'PlatformOrganisations.jsx',
  'PlatformContacts.jsx',
  'PlatformCampaigns.jsx',
  'PlatformCampaignDetail.jsx',
  'PlatformProspectLayout.jsx',
  'PlatformProspectDashboard.jsx',
  'PlatformProspectTasks.jsx',
  'PlatformProspectConfigurations.jsx',
  'PlatformProspectActivity.jsx',
];
