import { describe, it, expect } from 'vitest';
import { STARTER_PRESETS, type LauncherPage } from '@contract/ads-launcher';
import { filterPages, initialPageId } from './pages';
import { audienceRefIssues } from './structure';

const page = (id: string, name: string, linked = false): LauncherPage => ({ externalId: id, name, pictureUrl: null, instagramUserId: null, linked });

describe('initialPageId', () => {
  it('one page → it', () => {
    expect(initialPageId([page('1', 'A')], '')).toBe('1');
  });

  it('many pages, exactly one linked → the linked one', () => {
    expect(initialPageId([page('1', 'A'), page('2', 'B', true), page('3', 'C')], '3')).toBe('2');
  });

  it('otherwise the remembered page if still offered, else none', () => {
    const pages = [page('1', 'A', true), page('2', 'B', true), page('3', 'C')];
    expect(initialPageId(pages, '3')).toBe('3');
    expect(initialPageId(pages, '9')).toBe('');
  });
});

describe('filterPages', () => {
  const pages = [page('101', 'Smart Comb Official'), page('102', 'Cửa hàng Lược', true), page('103', 'Travel Pillow')];

  it('matches every word in name or id, accent-insensitive, linked first', () => {
    expect(filterPages(pages, 'cua hang').items.map(p => p.externalId)).toEqual(['102']);
    expect(filterPages(pages, '103').items.map(p => p.externalId)).toEqual(['103']);
    expect(filterPages(pages, '').items[0].externalId).toBe('102');
  });

  it('caps the rendered list but reports the full match count', () => {
    const many = Array.from({ length: 450 }, (_, i) => page(String(1000 + i), `Page ${i}`));
    const r = filterPages(many, 'page', 100);
    expect(r.items).toHaveLength(100);
    expect(r.total).toBe(450);
  });
});

describe('audienceRefIssues', () => {
  const base = STARTER_PRESETS[0].config;
  const config = {
    ...base,
    adset: {
      ...base.adset,
      audiences: [{ ...base.adset.audiences[0], customAudiences: [{ id: '11', name: 'Buyers 180d' }], excludedAudiences: [{ id: '12', name: 'Recent buyers' }] }]
    }
  };

  it('flags custom audiences the ad account does not have', () => {
    const issues = audienceRefIssues(config, [{ externalId: '11', name: 'Buyers 180d', subtype: 'CUSTOM', approximateCount: 1000 }]);
    expect(issues).toEqual(["Audience 'Broad': excluded audience 'Recent buyers' is not in this ad account"]);
  });

  it('says nothing until options are loaded', () => {
    expect(audienceRefIssues(config, null)).toEqual([]);
  });
});
