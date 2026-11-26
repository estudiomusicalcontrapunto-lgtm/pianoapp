import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarX } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { inputClass } from '../lib/utils';
import { capitalize, formatDateTime, formatDay, formatMonth, today } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

const STATUS = {
    repuesta: { label: 'Repuesta', tone: 'success' },
    agendada: { label: 'Reposición agendada', tone: 'info' },
    pendiente: { label: 'Sin reponer', tone: 'warning' },
    descontada: { label: 'Descontada del pago', tone: 'danger' },
};

const shiftMonth = (period, months) => {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Register of the classes each teacher cancelled, month by month, and what
 * became of each make-up. Classes a teacher only moved are not cancellations.
 */
export function AcademyCancellations() {
    const { teachers } = useApp();
    const [month, setMonth] = useState(() => today().slice(0, 7));
    const [teacherId, setTeacherId] = useState('');
    const { data, error, loading } = useApiData(() => api.getCancellations(month, teacherId), [month, teacherId]);
    const rows = data?.teachers || [];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Cancelaciones</h2>
                <p className="text-muted-foreground">
                    Clases que canceló cada profesor y si ya se repusieron. El profesor tiene hasta el final del mes siguiente para reponer cada una;
                    si no, al estudiante se le descuenta una clase de su siguiente pago. Las clases que el profesor solo movió de horario no aparecen aquí.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
                <span className="min-w-40 text-center font-semibold">{capitalize(formatMonth(month))}</span>
                <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
                <select className={`${inputClass} w-auto min-h-11`} value={teacherId} onChange={e => setTeacherId(e.target.value)} aria-label="Profesor">
                    <option value="">Todos los profesores</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {loading && <p className="text-sm text-muted-foreground">Cargando...</p>}
            {!loading && !error && rows.length === 0 && (
                <Card><CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2">
                    <CalendarX size={16} />Ningún profesor canceló clases en {formatMonth(month)}.
                </CardContent></Card>
            )}

            {rows.map(teacher => (
                <Card key={teacher.teacherId}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                            {teacher.teacherName}
                            <Badge>{teacher.total} {teacher.total === 1 ? 'cancelación' : 'cancelaciones'}</Badge>
                            {teacher.pending > 0 && <Badge tone="warning">{teacher.pending} sin reponer</Badge>}
                            {teacher.discounted > 0 && <Badge tone="danger">{teacher.discounted} descontada(s)</Badge>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y">
                        {teacher.lessons.map(lesson => {
                            const status = STATUS[lesson.makeupStatus];
                            return (
                                <div key={lesson.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                                    <div className="text-sm">
                                        <p className="font-medium">{lesson.studentName}: {formatDateTime(lesson.startsAt)}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {lesson.reason ? `Motivo: ${lesson.reason}. ` : ''}
                                            {lesson.makeupStartsAt && `Reposición: ${formatDateTime(lesson.makeupStartsAt)}. `}
                                            {lesson.makeupStatus === 'pendiente' && `Plazo para reponer: ${formatDay(lesson.deadline)}.`}
                                        </p>
                                    </div>
                                    <Badge tone={status.tone} className="self-start sm:self-auto">{status.label}</Badge>
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
