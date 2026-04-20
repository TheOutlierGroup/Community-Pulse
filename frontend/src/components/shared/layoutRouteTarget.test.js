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

