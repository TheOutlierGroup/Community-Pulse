import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarBrandTargetForRoute } from './layoutRouteTarget.js';

test('routes rhythm engine client pages to main platform dashboard', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123/rhythm-engine',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

test('routes rhythm engine subpages to main platform dashboard', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123/rhythm-engine/users',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

test('keeps normal platform post-login target outside rhythm engine', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

// BUG: on the standalone Rhythm Engine build, a workspace user's target
// ('/platform') and an Enterprise-tier client's own admin's target (bare
// '/platform/clients/:orgId') are both CRM-only routes with no match in
// that build's narrower tree (AppRhythmEngine.jsx) — an in-app Link to
// either renders an empty Outlet and leaves the browser on the Rhythm
// Engine origin. They must cross back to the CRM origin instead.
test('crosses back to the CRM origin for a workspace user on the rhythm engine surface', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123/rhythm-engine',
    orgId: 'abc123',
    isRhythmEngineSurface: true,
    crmBaseUrl: 'https://app.theoutliergroup.com.au',
  });

  assert.equal(target, 'https://app.theoutliergroup.com.au/platform');
});

test('crosses back to the CRM origin for an Enterprise client admin on the rhythm engine surface', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'client', clientPortalTier: 'enterprise', organizationId: 'abc123', role: 'admin' },
    pathname: '/platform/clients/abc123/rhythm-engine',
    orgId: 'abc123',
    isRhythmEngineSurface: true,
    crmBaseUrl: 'https://app.theoutliergroup.com.au',
  });

  assert.equal(target, 'https://app.theoutliergroup.com.au/platform/clients/abc123');
});

test('stays internal on the rhythm engine surface for a plain client admin (route it can actually serve)', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'client', role: 'admin', organizationId: 'abc123' },
    pathname: '/client',
    orgId: undefined,
    isRhythmEngineSurface: true,
    crmBaseUrl: 'https://app.theoutliergroup.com.au',
  });

  assert.equal(target, '/client');
});

test('falls back to the internal path on the rhythm engine surface when no CRM base URL is configured', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'client', clientPortalTier: 'enterprise', organizationId: 'abc123', role: 'admin' },
    pathname: '/platform/clients/abc123/rhythm-engine',
    orgId: 'abc123',
    isRhythmEngineSurface: true,
    crmBaseUrl: '',
  });

  assert.equal(target, '/platform/clients/abc123');
});

