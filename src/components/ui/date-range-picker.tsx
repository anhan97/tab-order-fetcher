import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

export type DatePreset = "today" | "last7days" | "last30days" | "custom";

export interface DateRangePickerProps {
  from: Date;
  to: Date;
  onSelect: (range: { from: Date; to: Date }) => void;
  selectedPreset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onSelect,
  selectedPreset,
  onPresetChange,
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [tempDateRange, setTempDateRange] = React.useState<{ from: Date; to: Date }>({ from, to });

  const handlePresetSelect = (value: DatePreset) => {
    onPresetChange(value);
    if (value !== "custom") {
      const range = getDateRangeFromPreset(value);
      setTempDateRange(range);
      onSelect(range);
      setIsOpen(false);
    }
  };

  const handleApply = () => {
    onSelect(tempDateRange);
    setIsOpen(false);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[300px] justify-start text-left font-normal",
              !from && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {from ? (
              format(from, "LLL dd, y") + " - " + format(to, "LLL dd, y")
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-4 space-y-4">
            <RadioGroup value={selectedPreset} onValueChange={handlePresetSelect}>
              <div className="grid gap-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="today" id="today" />
                  <Label htmlFor="today">Today</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="last7days" id="last7days" />
                  <Label htmlFor="last7days">Last 7 days</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="last30days" id="last30days" />
                  <Label htmlFor="last30days">Last 30 days</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="custom" id="custom" />
                  <Label htmlFor="custom">Custom range</Label>
                </div>
              </div>
            </RadioGroup>

            {selectedPreset === "custom" && (
              <div className="border rounded-md p-4">
                <Calendar
                  mode="range"
                  selected={{ from: tempDateRange.from, to: tempDateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setTempDateRange({ from: range.from, to: range.to });
                    }
                  }}
                  numberOfMonths={2}
                />
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleApply}>Apply</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function getDateRangeFromPreset(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "today":
      return {
        from: today,
        to: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
      };
    case "last7days":
      return {
        from: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
        to: today,
      };
    case "last30days":
      return {
        from: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
        to: today,
      };
    default:
      return {
        from: today,
        to: today,
      };
  }
} 