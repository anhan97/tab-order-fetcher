/**
 * Step 3 — Structure: preset, settings, target campaign, the plan diagram
 * and its blocking issues (§3.2).
 */
import { useState, type ReactNode } from 'react';
import type { ExistingCampaign, LaunchPreset, LaunchPresetConfig, NodeStatus } from '@contract/ads-launcher';
import type { PoolItem } from '../lib/pool';
import type { LaunchTarget, PlannedAdset, StructurePlan } from '../lib/structure';
import { AdsetEditDialog } from './AdsetEditDialog';
import { IssuesList } from './IssuesList';
import { PresetForm } from './PresetForm';
import { PresetPicker } from './PresetPicker';
import { StructureDiagram } from './StructureDiagram';
import { TargetPicker } from './TargetPicker';

export interface StepStructureProps {
  presets: LaunchPreset[];
  presetsLoading: boolean;
  presetsFallback: boolean;
  selectedPresetId: string | null;
  presetName: string | null;
  dirty: boolean;
  onSelectPreset: (preset: LaunchPreset) => void;
  onDeletePreset: (preset: LaunchPreset) => void;
  onRestoreStarters: () => void;
  restoring: boolean;
  config: LaunchPresetConfig | null;
  onConfig: (config: LaunchPresetConfig) => void;
  onStatus: (status: NodeStatus) => void;
  canUpdate: boolean;
  saving: boolean;
  onSaveToPreset: () => void;
  onSaveAsNew: (name: string) => void;
  target: LaunchTarget;
  onTarget: (target: LaunchTarget) => void;
  campaigns: ExistingCampaign[];
  campaignsLoading: boolean;
  noAccount: boolean;
  existingCampaign: ExistingCampaign | null;
  currency: string | null;
  plan: StructurePlan | null;
  pool: PoolItem[];
  onOverride: (key: string, itemKeys: string[] | null) => void;
  issues: string[];
  disabled?: boolean;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function StepStructure(props: StepStructureProps) {
  const [editing, setEditing] = useState<PlannedAdset | null>(null);
  const { config, plan, disabled } = props;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PresetPicker
        presets={props.presets}
        selectedId={props.selectedPresetId}
        dirty={props.dirty}
        loading={props.presetsLoading}
        fallback={props.presetsFallback}
        currency={props.currency}
        onSelect={props.onSelectPreset}
        onDelete={props.presetsFallback ? undefined : props.onDeletePreset}
        onRestoreStarters={props.presetsFallback ? undefined : props.onRestoreStarters}
        restoring={props.restoring}
        disabled={disabled}
      />

      {config && (
        <PresetForm
          config={config}
          onChange={props.onConfig}
          presetName={props.presetName}
          dirty={props.dirty}
          canUpdate={props.canUpdate}
          saving={props.saving}
          onSaveToPreset={props.onSaveToPreset}
          onSaveAsNew={props.onSaveAsNew}
          onStatus={props.onStatus}
          currency={props.currency}
          disabled={disabled}
        />
      )}

      <Section title="Where the ads go">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <TargetPicker
            target={props.target}
            onChange={props.onTarget}
            campaigns={props.campaigns}
            loading={props.campaignsLoading}
            noAccount={props.noAccount}
            currency={props.currency}
            disabled={disabled}
          />
        </div>
      </Section>

      <Section title="Plan">
        {config && plan ? (
          <StructureDiagram
            plan={plan}
            config={config}
            target={props.target}
            existingCampaign={props.existingCampaign}
            currency={props.currency}
            onEditAdset={setEditing}
            disabled={disabled}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Pick a preset to see the plan.</div>
        )}
        <IssuesList issues={props.issues} okText="Ready: nothing blocks this plan." />
      </Section>

      {config && (
        <AdsetEditDialog
          open={!!editing}
          onOpenChange={o => !o && setEditing(null)}
          adset={editing}
          pool={props.pool}
          adsPerAdset={config.structure.adsPerAdset}
          repeatToFill={config.structure.repeatToFill !== false}
          onSave={keys => editing && props.onOverride(editing.key, keys)}
        />
      )}
    </div>
  );
}
