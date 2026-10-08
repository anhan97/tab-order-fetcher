import { useEffect, useState } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { LIMITS, creativeCopySchema, type CreativeDto } from '@contract/ads-launcher';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCreativeMutations } from '@/features/ads-launcher/hooks/queries';
import { errorMessage, normalizeAngle, renameWithAngle } from '../lib/library';

interface EditCreativeDialogProps {
  creative: CreativeDto | null;
  onOpenChange: (open: boolean) => void;
}

/** Edit angle + copy. The name is regenerated server-side and keeps the created date. */
export function EditCreativeDialog({ creative: target, onOpenChange }: EditCreativeDialogProps) {
  const { toast } = useToast();
  const { update } = useCreativeMutations();
  // Keep the last creative while the dialog animates closed.
  const [creative, setCreative] = useState<CreativeDto | null>(target);
  const [angle, setAngle] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!target) return;
    setCreative(target);
    setAngle(target.angle);
    setPrimaryText(target.primaryText ?? '');
    setHeadline(target.headline ?? '');
    setDescription(target.description ?? '');
  }, [target]);

  const parsed = creativeCopySchema.safeParse({ angle, primaryText, headline, description });
  const angleError = !parsed.success ? parsed.error.issues.find(i => i.path[0] === 'angle')?.message : undefined;
  const newName = creative
    ? renameWithAngle(creative.name, angle.trim() || creative.angle, { creator: creative.creatorName, code: creative.productCode, createdAt: creative.createdAt })
    : '';
  const dirty = !!creative && (
    angle.trim() !== creative.angle ||
    primaryText !== (creative.primaryText ?? '') ||
    headline !== (creative.headline ?? '') ||
    description !== (creative.description ?? '')
  );

  const save = async () => {
    if (!creative || !parsed.success) return;
    try {
      await update.mutateAsync({
        id: creative.id,
        body: {
          angle: parsed.data.angle,
          primaryText: primaryText.trim() ? primaryText : null,
          headline: headline.trim() || null,
          description: description.trim() || null
        }
      });
      toast({ title: 'Creative updated' });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not save', description: errorMessage(e), variant: 'destructive' });
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={o => !update.isPending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b px-4 py-3 sm:px-6">
          <DialogTitle>Edit creative</DialogTitle>
          <DialogDescription>Ads already launched keep their copy — changes apply to new launches.</DialogDescription>
        </DialogHeader>

        <form
          id="edit-creative"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6"
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1 rounded-md border bg-slate-50 px-2.5 py-2 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Current name</div>
            <div className="break-words text-slate-700">{creative?.name}</div>
            <ArrowDown className="h-3 w-3 text-slate-400" />
            <div className="text-[10px] font-medium uppercase tracking-wide text-teal-700">New name</div>
            <div className="break-words font-medium text-slate-900">{newName}</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-angle">Angle <span className="text-rose-500">*</span></Label>
            <Input
              id="edit-angle"
              value={angle}
              onChange={e => setAngle(normalizeAngle(e.target.value))}
              maxLength={255}
              aria-invalid={!!angleError}
              autoFocus
            />
            {angleError && <p className="text-xs text-rose-600">{angleError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-primary">Primary text</Label>
            <Textarea id="edit-primary" value={primaryText} onChange={e => setPrimaryText(e.target.value)} maxLength={LIMITS.primaryTextLength} rows={5} className="resize-y" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-headline">Headline</Label>
              <Input id="edit-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={LIMITS.headlineLength} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Input id="edit-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={LIMITS.descriptionLength} />
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2 border-t px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancel</Button>
          <Button type="submit" form="edit-creative" disabled={!dirty || !parsed.success || update.isPending} className="bg-teal-600 hover:bg-teal-700">
            {update.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
