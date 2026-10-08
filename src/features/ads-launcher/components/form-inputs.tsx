/**
 * Inputs that keep what the user is typing locally (an empty box, "U" on the
 * way to "US") and only push a parsed value up.
 */
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Count } from '@contract/ads-launcher';

export function IntInput({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  id,
  ariaLabel
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(t => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      className={cn('h-9', className)}
      onChange={e => {
        const t = e.target.value.replace(/[^\d]/g, '');
        setText(t);
        const n = Number(t);
        if (t !== '' && Number.isInteger(n)) onChange(n);
      }}
      onBlur={() => {
        const n = Number(text);
        const clamped = text === '' || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, n));
        setText(String(clamped));
        if (clamped !== value) onChange(clamped);
      }}
    />
  );
}

/** A structure level: 1–50 or `n` (§5.1). */
export function CountInput({
  value,
  onChange,
  disabled,
  label
}: {
  value: Count;
  onChange: (v: Count) => void;
  disabled?: boolean;
  label: string;
}) {
  const isN = value === 'n';
  return (
    <div className="flex items-center gap-1">
      {isN ? (
        <div className="flex h-9 w-16 items-center justify-center rounded-md border border-teal-300 bg-teal-50 font-mono text-sm font-semibold text-teal-800">n</div>
      ) : (
        <IntInput value={value as number} onChange={onChange} min={1} max={50} disabled={disabled} className="w-16 text-center font-mono" ariaLabel={label} />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(isN ? 1 : 'n')}
        className={cn(
          'h-9 rounded-md border px-2 text-xs font-medium transition-colors',
          isN ? 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        )}
        title={isN ? 'Use a fixed number' : 'Use "n": as many as the pool needs'}
        aria-pressed={isN}
      >
        n
      </button>
    </div>
  );
}

const parseCountries = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

export function CountriesInput({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    setText(t => (parseCountries(t).join(',') === value.join(',') ? t : value.join(', ')));
  }, [value]);
  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder="US, CA"
      className="h-9 uppercase"
      aria-label="Countries"
      onChange={e => {
        setText(e.target.value);
        onChange(parseCountries(e.target.value));
      }}
      onBlur={() => setText(value.join(', '))}
    />
  );
}
