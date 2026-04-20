import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarBrandTargetForRoute } from './layoutRouteTarget.js';

test('routes pulse client pages to main platform dashboard', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123/pulse',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

test('routes pulse subpages to main platform dashboard', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123/pulse/users',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

test('keeps normal platform post-login target outside pulse', () => {
  const target = sidebarBrandTargetForRoute({
    user: { organizationKind: 'platform', role: 'admin' },
    pathname: '/platform/clients/abc123',
    orgId: 'abc123',
  });

  assert.equal(target, '/platform');
});

