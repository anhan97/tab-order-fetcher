import { classify } from '../src/services/fb-diagnose.service';

const APP_ID = '1229285438498833';

const baseInput = {
  meta: null as any,
  accessible: false,
  probeError: { ok: false, code: null as number | null, message: null as string | null },
  metaError: { code: null as number | null, message: null as string | null },
  ownerType: 'unknown' as const,
  fbAppId: APP_ID
};

describe('fb-diagnose classify', () => {
  test('accessible → ok', () => {
    const r = classify({ ...baseInput, accessible: true });
    expect(r.kind).toBe('ok');
    expect(r.fixUrl).toBeNull();
  });

  test('account_status=3 (closed) → account_disabled', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 3, disable_reason: 1 } as any
    });
    expect(r.kind).toBe('account_disabled');
    expect(r.suggestion).toMatch(/disable/i);
  });

  test('account_status=2 (unsettled) → account_unsettled', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 2 } as any
    });
    expect(r.kind).toBe('account_unsettled');
    expect(r.fixUrl).toMatch(/billing/);
  });

  test('FB message "application does not belong to system user" + BM → app_not_in_bm with BM-scoped link', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 1, business: { id: 'BM999', name: 'My BM' } } as any,
      probeError: {
        ok: false,
        code: 190,
        message: 'Error validating access token: The application does not belong to system user\'s business or its aggregator\'s business'
      },
      ownerType: 'business'
    });
    expect(r.kind).toBe('app_not_in_bm');
    expect(r.suggestion).toMatch(/My BM/);
    expect(r.fixUrl).toMatch(/business_id=BM999/);
  });

  test('code 200 + business owner → app_not_in_bm with assigned-partners deep link', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_555', account_status: 1, business: { id: 'BM7', name: 'Acme' } } as any,
      probeError: {
        ok: false,
        code: 200,
        message: '(#200) Ad account owner has NOT grant ads_management or ads_read permission'
      },
      ownerType: 'business'
    });
    expect(r.kind).toBe('app_not_in_bm');
    expect(r.suggestion).toMatch(/Acme/);
    expect(r.fixUrl).toMatch(/settings\/ad-accounts\/555/);
  });

  test('code 200 + personal owner → app_not_advanced_access', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_42', account_status: 1, owner: 'me' } as any,
      probeError: {
        ok: false,
        code: 200,
        message: '(#200) Ad account owner has NOT grant ads_management or ads_read permission'
      },
      ownerType: 'personal'
    });
    expect(r.kind).toBe('app_not_advanced_access');
    expect(r.suggestion).toMatch(/Advanced Access/);
    expect(r.fixUrl).toMatch(`/apps/${APP_ID}/app-review/permissions/`);
  });

  test('code 190 (no special message) → token_expired', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 1 } as any,
      probeError: { ok: false, code: 190, message: 'Token has expired' }
    });
    expect(r.kind).toBe('token_expired');
  });

  test('unknown FB error passes through', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 1 } as any,
      probeError: { ok: false, code: 100, message: 'Some random param error' }
    });
    expect(r.kind).toBe('unknown_error');
    expect(r.suggestion).toMatch(/Some random param error/);
  });

  test('disabled status overrides any access probe', () => {
    const r = classify({
      ...baseInput,
      meta: { id: 'act_1', account_status: 100 } as any,
      accessible: true                                  // even if accessible
    });
    expect(r.kind).toBe('account_disabled');
  });
});
