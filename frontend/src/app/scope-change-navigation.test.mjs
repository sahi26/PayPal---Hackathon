import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopeChangeOpenStore, parseNotificationAction } from './scope-change-navigation.mjs';

test('strips scope_change=1 from notification URLs and captures one-time modal intent', () => {
  const parsed = parseNotificationAction(
    '/project/93/fulfillment?role=seller&scope_change=1',
    'maker',
    { project_id: 93, action_data: { project_id: 93, scope_change_id: 12 } }
  );

  assert.equal(parsed.url, '/project/93/fulfillment?role=seller');
  assert.equal(parsed.openScopeChangeProjectId, 93);
});

test('supports clean backend URLs with action_data.open_scope_change without URL query params', () => {
  const parsed = parseNotificationAction(
    '/project/93/fulfillment?role=buyer',
    'buyer',
    { project_id: 93, action_data: { project_id: 93, open_scope_change: true } }
  );

  assert.equal(parsed.url, '/project/93/fulfillment?role=buyer');
  assert.equal(parsed.openScopeChangeProjectId, 93);
});

test('does not open scope change modal for standard project notifications', () => {
  const parsed = parseNotificationAction(
    '/project/93/fulfillment?role=buyer',
    'buyer',
    { project_id: 93, action_data: { project_id: 93 } }
  );

  assert.equal(parsed.url, '/project/93/fulfillment?role=buyer');
  assert.equal(parsed.openScopeChangeProjectId, null);
});

test('strips trailing query delimiter cleanly when scope_change=1 is the only query parameter', () => {
  const parsed = parseNotificationAction('/project/93/fulfillment?scope_change=1');
  assert.equal(parsed.url, '/project/93/fulfillment');
  assert.equal(parsed.openScopeChangeProjectId, 93);
});

test('preserves unrelated query parameters such as ms when stripping scope_change=1', () => {
  const parsed = parseNotificationAction(
    '/project/93/fulfillment?role=buyer&ms=2&scope_change=1',
    'seller',
    null
  );
  assert.equal(parsed.url, '/project/93/fulfillment?role=seller&ms=2');
  assert.equal(parsed.openScopeChangeProjectId, 93);
});

test('in-memory scope change trigger opens at most once and never survives a fresh store (page reload)', () => {
  const storeBeforeReload = new ScopeChangeOpenStore();
  storeBeforeReload.requestOpen(93);

  assert.equal(storeBeforeReload.consumePending(42), false);
  assert.equal(storeBeforeReload.consumePending(93), true);
  assert.equal(storeBeforeReload.consumePending(93), false);

  // Simulate full browser reload: fresh runtime instance has no pending popup state
  const storeAfterReload = new ScopeChangeOpenStore();
  assert.equal(storeAfterReload.consumePending(93), false);
});
