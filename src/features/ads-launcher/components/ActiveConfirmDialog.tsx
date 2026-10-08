import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';

interface ActiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  ads?: number;
  /** "Launch" when confirming at launch time, "Use Active" when switching the status. */
  action?: string;
}

/** ACTIVE needs one more confirmation (§3.2 step 4). */
export function ActiveConfirmDialog({ open, onOpenChange, onConfirm, ads, action = 'Use Active' }: ActiveConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Launch as Active?</AlertDialogTitle>
          <AlertDialogDescription>
            {ads ? `${ads} ad${ads === 1 ? '' : 's'} ` : 'The ads '}will start delivering — and spending — as soon as Meta approves them. Paused lets you review everything in Ads Manager first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep paused</AlertDialogCancel>
          <AlertDialogAction className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
