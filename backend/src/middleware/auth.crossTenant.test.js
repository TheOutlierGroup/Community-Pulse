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
  const req = { user: { role: 'admin' } };
  const res = fakeRes();
  const next = nextSpy();
  requirePlatformAdminRole(req, res, next);
  assert.equal(next.called(), true);
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
