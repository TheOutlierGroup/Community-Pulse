import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePlatformAdminRole, requirePlatformOnlyUser } from './auth.js';

function fakeRes() {
  const out = { statusCode: 200, body: undefined };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    },
    _out: out,
  };
}

function nextSpy() {
  let called = false;
  let arg = undefined;
  const fn = (err) => {
    called = true;
    arg = err;
  };
  fn.called = () => called;
  fn.arg = () => arg;
  return fn;
}

test('requirePlatformAdminRole denies non-admin (403)', () => {
  const req = { user: { role: 'employee' } };
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformAdminRole(req, res, next);
  assert.equal(next.called(), false);
  assert.equal(res._out.statusCode, 403);
  assert.match(String(res._out.body?.error || ''), /Admin only/i);
});

test('requirePlatformAdminRole allows admin and calls next', () => {
  const req = {
    user: { role: 'admin', organizationKind: 'platform', mfaVerifiedAt: new Date().toISOString() },
  };
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformAdminRole(req, res, next);
  assert.equal(next.called(), true);
});

function withMfaEnforcement(value, fn) {
  const prior = process.env.MFA_ENFORCE_ADMIN;
  if (value === undefined) delete process.env.MFA_ENFORCE_ADMIN;
  else process.env.MFA_ENFORCE_ADMIN = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env.MFA_ENFORCE_ADMIN;
    else process.env.MFA_ENFORCE_ADMIN = prior;
  }
}

// PT-04: the /api/platform surface runs on this gate, so MFA_ENFORCE_ADMIN
// has to bite here — not only on requireAdmin, which guards the client-org
// routes.
test('requirePlatformAdminRole denies a platform admin with no MFA claim by default', () => {
  withMfaEnforcement(undefined, () => {
    const req = { user: { role: 'admin', organizationKind: 'platform', mfaVerifiedAt: null } };
    const res = fakeRes();
    const next = nextSpy();
    requirePlatformAdminRole(req, res, next);
    assert.equal(next.called(), false);
    assert.equal(res._out.statusCode, 403);
    assert.equal(res._out.body?.mfaRequired, true);
  });
});

test('requirePlatformAdminRole prefers the DB-fresh org kind over the JWT claim', () => {
  withMfaEnforcement(undefined, () => {
    // JWT says licensee, upstream middleware resolved platform — the
    // resolved value must win, or the claim becomes a way to opt out.
    const req = {
      workspaceOrganization: { kind: 'platform' },
      user: { role: 'admin', organizationKind: 'licensee', mfaVerifiedAt: null },
    };
    const res = fakeRes();
    const next = nextSpy();
    requirePlatformAdminRole(req, res, next);
    assert.equal(next.called(), false);
    assert.equal(res._out.statusCode, 403);
  });
});

// Scoped deliberately: these routers sit before requirePlatformOnlyUser on
// platformRouter, so licensee (Practitioner) admins reach them. Enforcing
// MFA on that population would lock customers out of their own workspace.
test('requirePlatformAdminRole leaves licensee admins unaffected', () => {
  withMfaEnforcement(undefined, () => {
    const req = {
      workspaceOrganization: { kind: 'licensee' },
      user: { role: 'admin', organizationKind: 'licensee', mfaVerifiedAt: null },
    };
    const res = fakeRes();
    const next = nextSpy();
    requirePlatformAdminRole(req, res, next);
    assert.equal(next.called(), true);
  });
});

test('requirePlatformAdminRole allows admin without MFA when enforcement is off', () => {
  withMfaEnforcement('false', () => {
    const req = { user: { role: 'admin', organizationKind: 'platform', mfaVerifiedAt: null } };
    const res = fakeRes();
    const next = nextSpy();
    requirePlatformAdminRole(req, res, next);
    assert.equal(next.called(), true);
  });
});

test('requirePlatformAdminRole denies missing user', () => {
  const req = {};
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformAdminRole(req, res, next);
  assert.equal(next.called(), false);
  assert.equal(res._out.statusCode, 403);
});

test('requirePlatformOnlyUser denies licensee request that already has workspaceOrganization', () => {
  const req = { workspaceOrganization: { id: 'lic-1', kind: 'licensee' } };
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformOnlyUser(req, res, next);
  assert.equal(next.called(), false);
  assert.equal(res._out.statusCode, 403);
  assert.match(String(res._out.body?.error || ''), /Not available to licensees/i);
});

test('requirePlatformOnlyUser allows platform request that already has workspaceOrganization', () => {
  const req = { workspaceOrganization: { id: 'p-1', kind: 'platform' } };
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformOnlyUser(req, res, next);
  assert.equal(next.called(), true);
});
