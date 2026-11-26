
import { cn } from '../../lib/utils';

const TONES = {
    neutral: 'bg-secondary text-secondary-foreground',
    primary: 'bg-brand/10 text-brand',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-orange-100 text-orange-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
};

export function Badge({ tone = 'neutral', className, ...props }) {
    return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)} {...props} />;
}

// map: one of the label maps in lib/labels.js
export function StatusBadge({ map, value }) {
    const entry = map[value] || { label: value, tone: 'neutral' };
    return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
