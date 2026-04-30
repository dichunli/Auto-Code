import { cn, getStatusLabel, getStatusColor } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        getStatusColor(status),
        className
      )}
    >
      {getStatusLabel(status)}
    </span>
  );
}
