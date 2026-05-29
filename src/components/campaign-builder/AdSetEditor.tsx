/**
 * Per-ad-set audience + budget editor. Used inside the wizard's
 * "Ad sets" step. The parent owns the AdSetSpec array; this component
 * only mutates the one it's given via onChange.
 */

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, X, Search, Globe } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import {
  AdSetSpec,
  FbAudience,
  FbInterest,
  OPTIMIZATION_GOALS,
  CUSTOM_EVENT_TYPES,
  PUBLISHER_PLATFORMS
} from './types';

interface Props {
  index: number;
  total: number;
  adAccountId: string;
  spec: AdSetSpec;
  budgetMode: 'cbo' | 'abo';
  onChange: (next: AdSetSpec) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

export const AdSetEditor = ({ index, total, adAccountId, spec, budgetMode, onChange, onRemove, disabled }: Props) => {
  const a = spec.audience;
  const set = (patch: Partial<AdSetSpec>) => onChange({ ...spec, ...patch });
  const setAudience = (patch: Partial<typeof a>) => onChange({ ...spec, audience: { ...a, ...patch } });

  // ── Audience picker (custom audiences + lookalikes) ───────────────────────
  const [audienceList, setAudienceList] = useState<FbAudience[]>([]);
  const [audiencesLoading, setAudiencesLoading] = useState(false);

  useEffect(() => {
    if (!adAccountId) return;
    let cancelled = false;
    setAudiencesLoading(true);
    apiFetch<{ audiences: FbAudience[] }>(`/api/ads/audiences?adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(({ audiences }) => { if (!cancelled) setAudienceList(audiences || []); })
      .catch(() => { /* tolerate — wizard still works without audiences */ })
      .finally(() => { if (!cancelled) setAudiencesLoading(false); });
    return () => { cancelled = true; };
  }, [adAccountId]);

  const lookalikeList = audienceList.filter(x => (x.subtype || '').toUpperCase() === 'LOOKALIKE');
  const customAudienceList = audienceList.filter(x => (x.subtype || '').toUpperCase() !== 'LOOKALIKE');

  // ── Interest search (debounced) ───────────────────────────────────────────
  const [interestQuery, setInterestQuery] = useState('');
  const [interestResults, setInterestResults] = useState<FbInterest[]>([]);
  const [interestsLoading, setInterestsLoading] = useState(false);
  const interestTimer = useRef<number | null>(null);

  useEffect(() => {
    if (interestTimer.current) window.clearTimeout(interestTimer.current);
    if (!interestQuery.trim() || !adAccountId) { setInterestResults([]); return; }
    interestTimer.current = window.setTimeout(async () => {
      setInterestsLoading(true);
      try {
        const { interests } = await apiFetch<{ interests: FbInterest[] }>(
          `/api/ads/interests?q=${encodeURIComponent(interestQuery)}&adAccountId=${encodeURIComponent(adAccountId)}`
        );
        setInterestResults(interests || []);
      } catch { setInterestResults([]); }
      finally { setInterestsLoading(false); }
    }, 350);
    return () => { if (interestTimer.current) window.clearTimeout(interestTimer.current); };
  }, [interestQuery, adAccountId]);

  const interestById = (id: string) => interestResults.find(i => i.id === id);

  const toggleId = (list: string[] | undefined, id: string): string[] => {
    const cur = list || [];
    return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  };

  // ── Country chips ─────────────────────────────────────────────────────────
  const [countryInput, setCountryInput] = useState('');
  const addCountry = () => {
    const codes = countryInput.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c));
    if (codes.length) {
      const next = Array.from(new Set([...(a.countries || []), ...codes]));
      setAudience({ countries: next });
    }
    setCountryInput('');
  };
  const removeCountry = (c: string) => setAudience({ countries: (a.countries || []).filter(x => x !== c) });

  return (
    <Card className="border-blue-200/60">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-50">Ad set {index + 1}/{total}</Badge>
            <Input
              value={spec.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="Name (e.g. US Broad)"
              className="h-8 w-64"
              disabled={disabled}
            />
          </div>
          {onRemove && total > 1 && (
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled} className="text-rose-500">
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Remove
            </Button>
          )}
        </div>

        {/* Budget (only when ABO) + optimization goal + event */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {budgetMode === 'abo' && (
            <div>
              <Label className="text-xs">Daily budget (USD) *</Label>
              <Input
                type="number" step="1" min="1"
                value={spec.dailyBudget ? (spec.dailyBudget / 100).toString() : ''}
                onChange={e => set({ dailyBudget: Math.round(parseFloat(e.target.value || '0') * 100) || undefined })}
                disabled={disabled}
                placeholder="50"
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Optimization goal</Label>
            <Select value={a.optimizationGoal || 'OFFSITE_CONVERSIONS'} onValueChange={v => setAudience({ optimizationGoal: v })} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPTIMIZATION_GOALS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Conversion event</Label>
            <Select value={a.customEventType || 'PURCHASE'} onValueChange={v => setAudience({ customEventType: v })} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CUSTOM_EVENT_TYPES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Countries */}
        <div>
          <Label className="text-xs flex items-center gap-1"><Globe className="h-3 w-3" /> Countries</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={countryInput}
              onChange={e => setCountryInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCountry(); } }}
              placeholder="US, GB, CA…  (press Enter)"
              disabled={disabled}
            />
            <Button variant="outline" onClick={addCountry} disabled={disabled || !countryInput.trim()}>Add</Button>
          </div>
          {(a.countries?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(a.countries || []).map(c => (
                <Badge key={c} variant="secondary" className="gap-1">
                  {c}
                  <button onClick={() => removeCountry(c)} disabled={disabled} className="hover:text-rose-500"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Age + gender */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Age min</Label>
            <Input type="number" min="13" max="65" value={a.ageMin ?? ''} onChange={e => setAudience({ ageMin: e.target.value ? parseInt(e.target.value, 10) : undefined })} disabled={disabled} placeholder="18" />
          </div>
          <div>
            <Label className="text-xs">Age max</Label>
            <Input type="number" min="13" max="65" value={a.ageMax ?? ''} onChange={e => setAudience({ ageMax: e.target.value ? parseInt(e.target.value, 10) : undefined })} disabled={disabled} placeholder="65" />
          </div>
          <div>
            <Label className="text-xs">Gender</Label>
            <Select
              value={!a.genders?.length ? 'all' : a.genders.length === 2 ? 'all' : a.genders[0] === 1 ? 'male' : 'female'}
              onValueChange={v => setAudience({ genders: v === 'all' ? [] : v === 'male' ? [1] : [2] })}
              disabled={disabled}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Custom audiences + lookalikes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Custom audiences {audiencesLoading && <span className="text-slate-400">(loading…)</span>}</Label>
            <div className="border rounded-md p-2 max-h-32 overflow-y-auto bg-white">
              {customAudienceList.length === 0 && <div className="text-xs text-slate-400">None on this account</div>}
              {customAudienceList.map(au => (
                <label key={au.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(a.customAudiences || []).includes(au.id)}
                    onChange={() => setAudience({ customAudiences: toggleId(a.customAudiences, au.id) })}
                    disabled={disabled}
                  />
                  <span className="truncate flex-1">{au.name}</span>
                  {typeof au.approximate_count_lower_bound === 'number' && (
                    <span className="text-slate-400">~{au.approximate_count_lower_bound.toLocaleString()}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Lookalikes</Label>
            <div className="border rounded-md p-2 max-h-32 overflow-y-auto bg-white">
              {lookalikeList.length === 0 && <div className="text-xs text-slate-400">No lookalikes on this account</div>}
              {lookalikeList.map(au => (
                <label key={au.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(a.lookalikes || []).includes(au.id)}
                    onChange={() => setAudience({ lookalikes: toggleId(a.lookalikes, au.id) })}
                    disabled={disabled}
                  />
                  <span className="truncate flex-1">{au.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Interest search */}
        <div>
          <Label className="text-xs flex items-center gap-1"><Search className="h-3 w-3" /> Detailed targeting (interests)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={interestQuery}
              onChange={e => setInterestQuery(e.target.value)}
              placeholder="Search interests (e.g. yoga, gym, jewellery)…"
              disabled={disabled}
            />
          </div>
          {interestQuery && (
            <div className="border rounded-md mt-2 max-h-32 overflow-y-auto bg-white">
              {interestsLoading && <div className="text-xs text-slate-400 p-2">Searching…</div>}
              {!interestsLoading && interestResults.length === 0 && <div className="text-xs text-slate-400 p-2">No matches</div>}
              {interestResults.map(it => {
                const picked = (a.interestIds || []).includes(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setAudience({ interestIds: toggleId(a.interestIds, it.id) })}
                    disabled={disabled}
                    className={`block w-full text-left text-xs px-2 py-1 hover:bg-slate-50 ${picked ? 'bg-emerald-50' : ''}`}
                  >
                    <span className="font-medium">{it.name}</span>
                    {it.path && it.path.length > 0 && <span className="text-slate-400 ml-2">{it.path.join(' › ')}</span>}
                    {typeof it.audience_size_lower_bound === 'number' && (
                      <span className="float-right text-slate-400">~{it.audience_size_lower_bound.toLocaleString()}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {(a.interestIds?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(a.interestIds || []).map(id => {
                const it = interestById(id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {it?.name || id}
                    <button onClick={() => setAudience({ interestIds: toggleId(a.interestIds, id) })} disabled={disabled} className="hover:text-rose-500"><X className="h-3 w-3" /></button>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* Placements */}
        <div>
          <Label className="text-xs">Placements (publisher platforms)</Label>
          <div className="flex flex-wrap gap-3 mt-1">
            {PUBLISHER_PLATFORMS.map(p => (
              <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={(a.publisherPlatforms || []).includes(p)}
                  onChange={() => setAudience({ publisherPlatforms: toggleId(a.publisherPlatforms, p) })}
                  disabled={disabled}
                />
                {p}
              </label>
            ))}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Leave all unchecked to let Facebook use automatic placements.</div>
        </div>
      </CardContent>
    </Card>
  );
};
