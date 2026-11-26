
import React from 'react';
import { cn } from '../lib/utils';
import { WEEKDAYS_SHORT, formatShortDay, localParts, minutesToTime, timeToMinutes, weekdayOf } from '../lib/time';

const PX_PER_MINUTE = 0.9;
const OCCUPYING = ['programada', 'tomada', 'perdida'];

// Windows are drawn behind everything else, across the whole day column
const BACKGROUND_KINDS = ['franja_clase', 'franja_reposicion'];

const STYLES = {
    franja_clase: 'bg-primary/5 border border-dashed border-primary/30',
    franja_reposicion: 'bg-amber-50 border border-dashed border-amber-400',
    clase: 'bg-primary/15 border-l-4 border-primary',
    reposicion: 'bg-violet-100 border-l-4 border-violet-500',
    cancelada: 'bg-muted border-l-4 border-muted-foreground/30 text-muted-foreground',
    horario_fijo: 'bg-card border border-dashed border-primary text-primary',
    cupo_apartado: 'bg-orange-100 border-l-4 border-orange-500 text-orange-900',
    ocupado: 'bg-gray-400/80 border-l-4 border-gray-600 text-white',
};

const styleKey = (block) => {
    if (block.kind !== 'clase') return block.kind;
    if (!OCCUPYING.includes(block.status)) return 'cancelada';
    return block.lessonKind === 'reposicion' ? 'reposicion' : 'clase';
};

// Default text for a block; showTeacher adds the teacher's name (academy view)
const describe = (block, showTeacher) => {
    const teacher = showTeacher && block.teacherName ? ` · ${block.teacherName}` : '';
    switch (block.kind) {
        case 'franja_clase': return { title: `Franja de clase${teacher}` };
        case 'franja_reposicion': return { title: `${block.label || 'Franja de reposición'}${teacher}` };
        case 'ocupado': return { title: 'Ocupado' };
        case 'cupo_apartado': return { title: `Apartado: ${block.studentName}${teacher}` };
        case 'horario_fijo': return { title: block.studentName, subtitle: `Horario fijo · clase aún sin generar${teacher}` };
        default: {
            const notes = [];
            // "Clase 2 de 4", "Clase suelta", "Reposición de la clase 2"
            if (block.classLabel) notes.push(block.classLabel);
            else if (block.lessonKind === 'reposicion') notes.push('Reposición');
            if (block.moved) notes.push('Movida · espacio libre');
            else if (!OCCUPYING.includes(block.status)) notes.push('Cancelada · espacio libre');
            if (block.substituteLabel && OCCUPYING.includes(block.status)) notes.push(`Reemplazo: ${block.substituteLabel}`);
            return { title: block.studentName, subtitle: [notes.join(', '), showTeacher ? block.teacherName : ''].filter(Boolean).join(' · ') };
        }
    }
};

export function WeekCalendar({
    days, hours, blocks, closures = [], slotMinutes = 30, showTeacher = false,
    onSlotClick, onBlockClick, selectedBlockIds = [],
}) {
    const open = timeToMinutes(hours.open);
    const close = timeToMinutes(hours.close);
    const height = (close - open) * PX_PER_MINUTE;
    const slots = [];
    for (let m = open; m < close; m += slotMinutes) slots.push(m);

    const position = (block) => {
        const start = timeToMinutes(localParts(block.startsAt).time);
        const end = timeToMinutes(localParts(block.endsAt).time) || 24 * 60;
        const top = (Math.max(start, open) - open) * PX_PER_MINUTE;
        const bottom = (Math.min(end, close) - open) * PX_PER_MINUTE;
        return { top, height: Math.max(bottom - top, 14) };
    };

    return (
        <div className="overflow-x-auto rounded-lg border bg-card">
            <div className="min-w-[620px]">
                {/* Header */}
                <div className="grid grid-cols-[56px_repeat(6,1fr)] border-b bg-secondary/40">
                    <div />
                    {days.map(day => {
                        const closure = closures.find(c => c.date === day);
                        return (
                            <div key={day} className={cn("px-2 py-2 text-center border-l", closure && "bg-red-50")}>
                                <p className="text-xs text-muted-foreground">{WEEKDAYS_SHORT[weekdayOf(day)]}</p>
                                <p className="text-sm font-semibold">{formatShortDay(day)}</p>
                                {closure && <p className="text-[10px] text-red-600 truncate" title={closure.reason}>Cerrado</p>}
                            </div>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="grid grid-cols-[56px_repeat(6,1fr)]">
                    <div className="relative" style={{ height }}>
                        {slots.filter(m => m % 60 === 0).map(m => (
                            <span key={m} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: (m - open) * PX_PER_MINUTE }}>
                                {minutesToTime(m)}
                            </span>
                        ))}
                    </div>

                    {days.map(day => {
                        const dayBlocks = blocks.filter(b => localParts(b.startsAt).date === day);
                        const closed = closures.some(c => c.date === day);
                        return (
                            <div key={day} className={cn("relative border-l", closed && "bg-red-50/60")} style={{ height }}>
                                {slots.map(m => (
                                    <div
                                        key={m}
                                        className={cn(
                                            "absolute inset-x-0 border-t",
                                            m % 60 === 0 ? "border-border" : "border-border/40 border-dashed",
                                            onSlotClick && !closed && "hover:bg-primary/5 cursor-pointer"
                                        )}
                                        style={{ top: (m - open) * PX_PER_MINUTE, height: slotMinutes * PX_PER_MINUTE }}
                                        onClick={onSlotClick && !closed ? () => onSlotClick({ date: day, time: minutesToTime(m) }) : undefined}
                                    />
                                ))}

                                {dayBlocks.filter(b => BACKGROUND_KINDS.includes(b.kind)).map(block => {
                                    const { title } = describe(block, showTeacher);
                                    return (
                                        <div
                                            key={block.id}
                                            className={cn("absolute inset-x-0.5 rounded-sm pointer-events-none z-10", STYLES[block.kind])}
                                            style={position(block)}
                                        >
                                            <button
                                                type="button"
                                                disabled={!onBlockClick}
                                                onClick={() => onBlockClick?.(block)}
                                                className={cn(
                                                    "pointer-events-auto m-0.5 max-w-full truncate rounded px-1 text-[10px] font-medium",
                                                    block.kind === 'franja_reposicion' ? "bg-amber-200/70 text-amber-900" : "bg-primary/10 text-primary",
                                                    onBlockClick ? "hover:underline" : "cursor-default"
                                                )}
                                            >
                                                {title}
                                            </button>
                                        </div>
                                    );
                                })}

                                {dayBlocks.filter(b => !BACKGROUND_KINDS.includes(b.kind)).map(block => {
                                    const { title, subtitle } = describe(block, showTeacher);
                                    const key = styleKey(block);
                                    const selected = selectedBlockIds.includes(block.id);
                                    // A cancelled or moved class leaves its time free: taps go through to the slot below
                                    const freed = key === 'cancelada';
                                    return (
                                        <button
                                            key={block.id}
                                            type="button"
                                            disabled={!onBlockClick || block.kind === 'ocupado' || freed}
                                            onClick={() => onBlockClick?.(block)}
                                            className={cn(
                                                "absolute left-2 right-1 overflow-hidden rounded-md px-1.5 py-0.5 text-left",
                                                freed ? "z-10 pointer-events-none opacity-60 border-dashed" : "z-20 shadow-sm",
                                                STYLES[key],
                                                selected && "ring-2 ring-primary ring-offset-1",
                                                onBlockClick && block.kind !== 'ocupado' && !freed ? "hover:brightness-95" : "cursor-default"
                                            )}
                                            style={position(block)}
                                            title={[title, subtitle].filter(Boolean).join(' — ')}
                                        >
                                            <p className={cn("truncate text-[11px] font-semibold leading-tight", key === 'cancelada' && "line-through")}>
                                                {localParts(block.startsAt).time} {title}
                                            </p>
                                            {subtitle && <p className="truncate text-[10px] leading-tight opacity-80">{subtitle}</p>}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function CalendarLegend({ kinds }) {
    const LABELS = {
        clase: 'Clase',
        reposicion: 'Reposición',
        cancelada: 'Cancelada o movida (espacio libre)',
        horario_fijo: 'Horario fijo (clase aún sin generar)',
        franja_clase: 'Franja de clase',
        franja_reposicion: 'Franja de reposición',
        cupo_apartado: 'Cupo apartado',
        ocupado: 'Ocupado (otro profesor)',
    };
    return (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {kinds.map(kind => (
                <span key={kind} className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-3 w-4 rounded-sm", STYLES[kind])} />
                    {LABELS[kind]}
                </span>
            ))}
        </div>
    );
}
