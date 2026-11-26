
import { cn } from '../lib/utils';

const UNIT_STYLES = {
    tomada: { color: 'bg-green-500', label: 'Tomada' },
    perdida: { color: 'bg-red-400', label: 'Perdida' },
    por_reponer: { color: 'bg-orange-400', label: 'Por reponer' },
    proxima: { color: 'bg-primary', label: 'Próxima' },
    programada: { color: 'bg-primary/25', label: 'Programada' },
};

// One segment per class of the cycle, colored by its state
export function CycleProgress({ units, total, className, showLegend = false }) {
    const segments = [...units];
    while (segments.length < total) segments.push({ state: 'programada', lessonId: `vacio-${segments.length}` });

    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex gap-1.5" role="img" aria-label={segments.map(s => UNIT_STYLES[s.state]?.label).join(', ')}>
                {segments.map((unit, i) => (
                    <span key={unit.lessonId || i} className={cn('h-2.5 flex-1 rounded-full', UNIT_STYLES[unit.state]?.color)} title={UNIT_STYLES[unit.state]?.label} />
                ))}
            </div>
            {showLegend && (
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {['tomada', 'por_reponer', 'proxima', 'programada'].map(state => (
                        <span key={state} className="flex items-center gap-1">
                            <span className={cn('h-2 w-2 rounded-full', UNIT_STYLES[state].color)} />
                            {UNIT_STYLES[state].label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
