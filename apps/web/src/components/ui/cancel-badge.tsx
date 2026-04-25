import { AlertTriangle, Shield } from 'lucide-react';
import { Badge } from './badge';

export type CancelLevel = 'free' | 'partial' | 'none';

export interface CancelBadgeProps {
  level: CancelLevel;
  label: string;
  compact?: boolean;
}

export function CancelBadge({ level, label, compact }: CancelBadgeProps) {
  const variant =
    level === 'free' ? 'success' : level === 'partial' ? 'warning' : 'danger';
  const iconSize = compact ? 'h-3 w-3' : 'h-[13px] w-[13px]';
  const icon =
    level === 'none' ? (
      <AlertTriangle className={iconSize} aria-hidden="true" />
    ) : (
      <Shield className={iconSize} aria-hidden="true" />
    );

  return (
    <Badge variant={variant} size={compact ? 'sm' : 'md'} icon={compact ? undefined : icon}>
      {label}
    </Badge>
  );
}
