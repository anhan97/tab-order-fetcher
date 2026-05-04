import { describe, it, expect } from 'vitest';
import { parseAdCopyCsv, parseCsvRows } from './adCopyCsv';

describe('parseCsvRows', () => {
  it('handles unquoted simple rows', () => {
    expect(parseCsvRows('a,b,c\n1,2,3\n')).toEqual([['a','b','c'],['1','2','3']]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsvRows('a,b\n"x,y","z"')).toEqual([['a','b'],['x,y','z']]);
  });

  it('handles escaped double quotes', () => {
    expect(parseCsvRows('a\n"He said ""yes"""')).toEqual([['a'],['He said "yes"']]);
  });

  it('preserves embedded newlines in quoted fields', () => {
    expect(parseCsvRows('a,b\n"line1\nline2",x')).toEqual([['a','b'],['line1\nline2','x']]);
  });

  it('strips BOM', () => {
    expect(parseCsvRows('﻿a,b\n1,2')).toEqual([['a','b'],['1','2']]);
  });

  it('skips fully-empty rows', () => {
    expect(parseCsvRows('a,b\n\n1,2\n\n')).toEqual([['a','b'],['1','2']]);
  });
});

describe('parseAdCopyCsv', () => {
  it('returns empty result for empty input', () => {
    expect(parseAdCopyCsv('').entries).toEqual([]);
  });

  it('parses a single row with one variant per slot', () => {
    const csv = 'filename,primary_text_1,headline_1,description_1\n161.png,"Body","Headline","Desc"';
    const r = parseAdCopyCsv(csv);
    expect(r.entries.length).toBe(1);
    expect(r.entries[0]).toEqual({
      filename: '161.png',
      primary_texts: ['Body'],
      headlines: ['Headline'],
      descriptions: ['Desc']
    });
    expect(r.byFilename['161.png'].headlines).toEqual(['Headline']);
  });

  it('parses multi-variant rows up to 5 of each', () => {
    const csv = [
      'filename,primary_text_1,primary_text_2,primary_text_3,headline_1,headline_2,description_1',
      '162.png,"PT1","PT2","PT3","HL1","HL2","DESC1"'
    ].join('\n');
    const r = parseAdCopyCsv(csv);
    expect(r.entries[0].primary_texts).toEqual(['PT1','PT2','PT3']);
    expect(r.entries[0].headlines).toEqual(['HL1','HL2']);
    expect(r.entries[0].descriptions).toEqual(['DESC1']);
  });

  it('drops empty cells without leaving holes', () => {
    const csv = [
      'filename,primary_text_1,primary_text_2,primary_text_3',
      '163.png,"A","","C"'
    ].join('\n');
    const r = parseAdCopyCsv(csv);
    // Empty middle cell is filtered, so we end up with two non-empty texts
    expect(r.entries[0].primary_texts).toEqual(['A','C']);
  });

  it('throws when filename column is missing', () => {
    expect(() => parseAdCopyCsv('primary_text_1\nfoo')).toThrow(/filename/i);
  });

  it('accepts alternate filename column aliases', () => {
    const r = parseAdCopyCsv('file,headline_1\n200.png,My Headline');
    expect(r.entries[0].filename).toBe('200.png');
    expect(r.entries[0].headlines).toEqual(['My Headline']);
  });

  it('case-insensitive headers', () => {
    const r = parseAdCopyCsv('FILENAME,PRIMARY_TEXT_1\n300.jpg,Body');
    expect(r.entries[0].primary_texts).toEqual(['Body']);
  });

  it('flags unknown columns', () => {
    const r = parseAdCopyCsv('filename,headline_1,target_country\n301.png,Hi,US');
    expect(r.unknownColumns).toContain('target_country');
  });

  it('preserves multi-line copy from quoted fields', () => {
    const csv = 'filename,primary_text_1\n302.png,"Line 1\nLine 2"';
    const r = parseAdCopyCsv(csv);
    expect(r.entries[0].primary_texts[0]).toBe('Line 1\nLine 2');
  });

  it('skips comment rows starting with #', () => {
    const csv = [
      'filename,headline_1',
      '#this is a note',
      '400.png,Real headline'
    ].join('\n');
    const r = parseAdCopyCsv(csv);
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].filename).toBe('400.png');
  });

  it('merges multiple rows for the same filename', () => {
    // Useful if the user wants to extend variants across separate rows
    const csv = [
      'filename,primary_text_1',
      '500.png,"First"',
      '500.png,"Second"'
    ].join('\n');
    const r = parseAdCopyCsv(csv);
    // Same slot — second row overwrites; that's expected (deterministic)
    expect(r.entries.length).toBe(1);
    expect(r.entries[0].primary_texts).toEqual(['Second']);
  });
});
