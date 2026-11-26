import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn } from '../lib/utils';
import { WEEKDAYS_SHORT, addDays, formatShortDay, mondayOf, today, weekdayOf } from '../lib/time';
import { Button } from './ui/Button';

// One day of the week: a lit flame if the student practiced, a grey one if not, faint if still ahead
function DayFlame({ date, practiced, isToday, size = 'md' }) {
    const future = date > today();
    const [, , day] = date.split('-').map(Number);
    const small = size === 'sm';
    return (
        <div
            className={cn('flex flex-col items-center', small ? 'gap-0' : 'gap-1')}
            title={`${formatShortDay(date)}: ${practiced ? 'estudió' : future ? 'aún no llega' : 'no estudió'}`}
        >
            {!small && <span className="text-[10px] text-muted-foreground">{WEEKDAYS_SHORT[weekdayOf(date)]}</span>}
            <span className={cn(
                'flex items-center justify-center rounded-full',
                small ? 'h-5 w-5' : 'h-9 w-9',
                isToday && 'ring-2 ring-orange-400 ring-offset-1 ring-offset-background',
                practiced ? 'bg-orange-100' : 'bg-muted/60'
            )}>
                <Flame
                    size={small ? 12 : 18}
                    className={practiced ? 'text-orange-500 fill-orange-500' : future ? 'text-muted-foreground/30' : 'text-muted-foreground/60'}
                />
            </span>
            {!small && <span className={cn('text-[10px]', isToday ? 'font-semibold text-orange-600' : 'text-muted-foreground')}>{day}</span>}
        </div>
    );
}

// This week's seven flames from a list of practiced dates, for lists of students
export function PracticeWeekMini({ dates = [] }) {
    const start = mondayOf(today());
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(start, i));
    const label = `Esta semana estudió ${dates.length} de 7 días`;
    return (
        <div className="flex gap-0.5" role="img" aria-label={label} title={label}>
            {days.map(date => <DayFlame key={date} date={date} practiced={dates.includes(date)} isToday={date === today()} size="sm" />)}
        </div>
    );
}

// A student's week of practice (Monday to Sunday) with their streak; earlier weeks one click away
export function PracticeWeek({ studentId, reloadKey = 0, showStreak = true }) {
    const [weekStart, setWeekStart] = useState(() => mondayOf(today()));
    const { data, error } = useApiData(() => api.getPracticeWeek(studentId, weekStart), [studentId, weekStart, reloadKey]);
    const isCurrentWeek = weekStart === mondayOf(today());
    const practicedCount = data?.days.filter(d => d.practiced).length ?? 0;

    return (
        <div className="space-y-2">
            {showStreak && data && (
                <p className="text-2xl font-bold flex items-center gap-2">
                    <Flame className={cn('h-6 w-6', data.streak > 0 ? 'text-orange-500 fill-orange-500' : 'text-muted-foreground')} />
                    {data.streak} {data.streak === 1 ? 'día' : 'días'} de racha
                </p>
            )}
            <div className="flex items-center justify-between gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Semana anterior" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                    <ChevronLeft size={16} />
                </Button>
                <div className="grid flex-1 grid-cols-7 gap-1">
                    {(data?.days || []).map(d => <DayFlame key={d.date} date={d.date} practiced={d.practiced} isToday={d.date === data.today} />)}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Semana siguiente" disabled={isCurrentWeek} onClick={() => setWeekStart(addDays(weekStart, 7))}>
                    <ChevronRight size={16} />
                </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
                {isCurrentWeek ? 'Esta semana' : `Semana del ${formatShortDay(weekStart)}`}: {practicedCount} de 7 días
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}
