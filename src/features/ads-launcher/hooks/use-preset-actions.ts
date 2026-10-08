/**
 * Preset actions for the Structure step: pick, save to preset, save as new,
 * delete, restore starters (§6.2, §7.6).
 */
import type { Dispatch } from 'react';
import { normalizePresetConfig, type LaunchPreset } from '@contract/ads-launcher';
import { useToast } from '@/hooks/use-toast';
import { errorMessage } from '../lib/format';
import { configIssues } from '../lib/structure';
import type { WizardAction, WizardState } from '../lib/wizard-state';
import { usePresetMutations } from './queries';

export function usePresetActions(state: WizardState, dispatch: Dispatch<WizardAction>, current: LaunchPreset | null) {
  const m = usePresetMutations();
  const { toast } = useToast();

  const valid = () => {
    const issues = state.config ? configIssues(state.config) : ['Pick a preset'];
    if (issues.length) toast({ title: 'Fix the settings first', description: issues[0], variant: 'destructive' });
    return issues.length === 0;
  };

  const select = (preset: LaunchPreset) => {
    if (preset.id === state.presetId) return;
    if (state.dirty && !window.confirm('Discard the changes you made to this preset?')) return;
    const config = normalizePresetConfig(preset.config);
    if (config) dispatch({ type: 'preset', presetId: preset.id, config });
  };

  const saveToPreset = async () => {
    if (!current || !state.config || current.id.startsWith('starter:') || !valid()) return;
    try {
      const saved = await m.update.mutateAsync({ id: current.id, input: { name: current.name, description: current.description ?? '', config: state.config } });
      dispatch({ type: 'saved', presetId: saved?.id ?? current.id, config: normalizePresetConfig(saved?.config) ?? state.config });
      toast({ title: `Saved "${current.name}"` });
    } catch (e) {
      toast({ title: 'Could not save the preset', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const saveAsNew = async (name: string) => {
    if (!state.config || !valid()) return;
    try {
      const saved = await m.create.mutateAsync({ name, description: '', config: state.config });
      dispatch({ type: 'saved', presetId: saved.id, config: normalizePresetConfig(saved.config) ?? state.config });
      toast({ title: `Preset "${name}" created` });
    } catch (e) {
      toast({ title: 'Could not create the preset', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const remove = async (preset: LaunchPreset) => {
    if (!window.confirm(`Delete the preset "${preset.name}"?`)) return;
    try {
      await m.remove.mutateAsync(preset.id);
      if (preset.id === state.presetId) dispatch({ type: 'preset', presetId: null, config: null });
      toast({ title: `Preset "${preset.name}" deleted` });
    } catch (e) {
      toast({ title: 'Could not delete the preset', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const restoreStarters = async () => {
    try {
      await m.restoreStarters.mutateAsync();
      toast({ title: 'Starter presets restored' });
    } catch (e) {
      toast({ title: 'Could not restore the starters', description: errorMessage(e), variant: 'destructive' });
    }
  };

  return {
    select,
    saveToPreset,
    saveAsNew,
    remove,
    restoreStarters,
    saving: m.create.isPending || m.update.isPending,
    restoring: m.restoreStarters.isPending
  };
}
