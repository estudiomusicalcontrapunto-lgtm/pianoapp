import React, { useState } from 'react';
import { ArrowLeft, CalendarX2, ChevronLeft, ChevronRight, Plus, Trash2, UserRoundCheck, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, inputClass } from '../lib/utils';
import { LESSON_LABELS, lessonStatusKey } from '../lib/labels';
import { capitalize, formatDateTime, formatDay, formatShortDay, localParts, today } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Field } from '../components/ui/Modal';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const shiftMonth = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month) => {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
};

function SummaryBadges({ summary }) {
    return (
        <div className="flex flex-wrap gap-1">
            {summary.covered > 0 && <Badge tone="success">{summary.covered} con reemplazo</Badge>}
            {summary.uncovered > 0 && <Badge tone="warning">{summary.uncovered} sin reemplazo</Badge>}
            {summary.cancelled > 0 && <Badge>{summary.cancelled} cancelada(s)</Badge>}
            {summary.total === 0 && <Badge>Sin clases en esas fechas</Badge>}
        </div>
    );
}

function NewAbsenceForm({ teachers, onCreated, onCancel }) {
    const [form, setForm] = useState({ teacherId: '', startDate: today(), endDate: today(), reason: '' });
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            onCreated(await api.createAbsence(form));
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle className="text-lg">Registrar ausencia</CardTitle></CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Profesor">
                            <select className={inputClass} value={form.teacherId} onChange={set('teacherId')} required>
                                <option value="" disabled>Elige al profesor</option>
                                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </Field>
                        <Field label="Motivo (opcional)">
                            <input className={inputClass} value={form.reason} onChange={set('reason')} placeholder="Ej.: incapacidad, viaje, concierto" maxLength={200} />
                        </Field>
                        <Field label="Desde"><input type="date" className={inputClass} value={form.startDate} onChange={set('startDate')} required /></Field>
                        <Field label="Hasta (incluido)"><input type="date" className={inputClass} min={form.startDate} value={form.endDate} onChange={set('endDate')} required /></Field>
                    </div>
                    <p className="text-xs text-muted-foreground">Después eliges quién da cada clase de esos días, o las cancelas con reposición.</p>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
                        <Button type="submit">Registrar</Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

// Picks who gives the selected lessons: an academy teacher (with how many of them they can take) or an outside one
function SubstitutePicker({ lessons, selectedIds, onAssign }) {
    const [choice, setChoice] = useState('');
    const [external, setExternal] = useState({ name: '', phone: '' });
    const selected = lessons.filter(l => selectedIds.includes(l.id));
    const teachers = new Map();
    for (const lesson of selected) {
        for (const c of lesson.candidates) {
            const entry = teachers.get(c.id) || { id: c.id, name: c.name, free: 0, teachesInstrument: true };
            entry.free += c.free ? 1 : 0;
            entry.teachesInstrument = entry.teachesInstrument && c.teachesInstrument;
            teachers.set(c.id, entry);
        }
    }
    const options = [...teachers.values()].sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
    const chosen = teachers.get(choice);
    const canAssign = selected.length > 0 && (choice === 'externo' ? external.name.trim() : chosen && chosen.free === selected.length);

    const assign = () => onAssign(choice === 'externo' ? { name: external.name, phone: external.phone } : { teacherId: choice });

    return (
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-3">
            <p className="text-sm font-medium">{selected.length ? `${selected.length} clase(s) seleccionada(s)` : 'Selecciona las clases a las que quieres darles reemplazo.'}</p>
            {selected.length > 0 && (
                <div className="flex flex-col md:flex-row gap-2 md:items-end">
                    <Field label="Quién las da">
                        <select className={`${inputClass} md:w-80`} value={choice} onChange={e => setChoice(e.target.value)}>
                            <option value="" disabled>Elige un reemplazo</option>
                            {options.map(t => (
                                <option key={t.id} value={t.id} disabled={t.free < selected.length}>
                                    {t.name}{t.free < selected.length ? ` (libre en ${t.free} de ${selected.length})` : ''}{!t.teachesInstrument ? ' · otro instrumento' : ''}
                                </option>
                            ))}
                            <option value="externo">Profesor externo…</option>
                        </select>
                    </Field>
                    {choice === 'externo' && (
                        <>
                            <Field label="Nombre"><input className={inputClass} value={external.name} onChange={e => setExternal({ ...external, name: e.target.value })} /></Field>
                            <Field label="Teléfono"><input className={inputClass} value={external.phone} onChange={e => setExternal({ ...external, phone: e.target.value })} /></Field>
                        </>
                    )}
                    <Button onClick={assign} disabled={!canAssign} className="gap-2"><UserRoundCheck size={16} />Asignar</Button>
                </div>
            )}
        </div>
    );
}

function AbsenceDetail({ id, onBack, onChanged }) {
    const { data, error: loadError, reload } = useApiData(() => api.getAbsence(id), [id]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [message, setMessage] = useState(null);
    const [pickerKey, setPickerKey] = useState(0);

    const run = async (fn, success) => {
        setMessage(null);
        try {
            await fn();
            setMessage({ type: 'success', text: success });
            setSelectedIds([]);
            setPickerKey(k => k + 1);
            reload();
            onChanged();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    };

    if (!data) return loadError ? <p className="text-sm text-red-500">{loadError}</p> : <p className="text-muted-foreground">Cargando…</p>;
    const { absence, summary, lessons } = data;
    const uncovered = lessons.filter(l => l.editable && !l.substitute);
    const toggle = (lessonId) => setSelectedIds(ids => (ids.includes(lessonId) ? ids.filter(x => x !== lessonId) : [...ids, lessonId]));

    // Lessons grouped by local day
    const days = [];
    for (const lesson of lessons) {
        const date = localParts(lesson.startsAt).date;
        if (days.at(-1)?.date !== date) days.push({ date, lessons: [] });
        days.at(-1).lessons.push(lesson);
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
                <Button variant="ghost" size="icon" aria-label="Volver" onClick={onBack}><ArrowLeft size={18} /></Button>
                <div className="flex-1 min-w-0">
                    <h3 className="text-2xl font-bold">{absence.teacherName}</h3>
                    <p className="text-sm text-muted-foreground">
                        Del {formatDay(absence.startDate)} al {formatDay(absence.endDate)}{absence.reason && ` · ${absence.reason}`}
                    </p>
                    <div className="mt-2"><SummaryBadges summary={summary} /></div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {uncovered.length > 0 && (
                        <Button
                            variant="outline"
                            onClick={() => confirm(`¿Cancelar las ${uncovered.length} clase(s) sin reemplazo? Cada estudiante queda con una reposición pendiente y recibe un aviso.`)
                                && run(() => api.cancelUncovered(id), 'Clases canceladas; los estudiantes podrán reponerlas.')}
                        >
                            Cancelar las {uncovered.length} sin reemplazo
                        </Button>
                    )}
                    <Button
                        variant="ghost" className="gap-1 text-red-600"
                        onClick={() => confirm('¿Eliminar esta ausencia? Las clases que aún no pasan vuelven a su profesor y se avisa a los estudiantes.')
                            && api.deleteAbsence(id).then(() => { onChanged(); onBack(); }).catch(err => setMessage({ type: 'error', text: err.message }))}
                    >
                        <Trash2 size={16} />Eliminar ausencia
                    </Button>
                </div>
            </div>

            {message && <p className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>{message.text}</p>}

            {lessons.some(l => l.editable) && (
                <>
                    <SubstitutePicker key={pickerKey} lessons={lessons} selectedIds={selectedIds} onAssign={(substitute) => run(() => api.assignSubstitute(selectedIds, substitute), 'Reemplazo asignado; se avisó a los estudiantes.')} />
                    {uncovered.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(uncovered.map(l => l.id))}>
                            Seleccionar las {uncovered.length} sin reemplazo
                        </Button>
                    )}
                </>
            )}

            {days.map(day => (
                <Card key={day.date}>
                    <CardContent className="p-4 space-y-2">
                        <p className="text-sm font-semibold">{capitalize(formatDay(day.date))}</p>
                        {day.lessons.map(lesson => {
                            const free = lesson.candidates.filter(c => c.free).map(c => c.name);
                            return (
                                <div key={lesson.id} className={cn("flex flex-wrap items-center gap-3 rounded-md border p-2", selectedIds.includes(lesson.id) && "border-primary bg-primary/5")}>
                                    {lesson.editable ? (
                                        <input type="checkbox" aria-label={`Seleccionar la clase de ${lesson.studentName}`} checked={selectedIds.includes(lesson.id)} onChange={() => toggle(lesson.id)} />
                                    ) : <span className="w-[13px]" />}
                                    <div className="w-14 text-sm font-medium">{localParts(lesson.startsAt).time}</div>
                                    <div className="flex-1 min-w-[10rem]">
                                        <p className="text-sm font-medium">{lesson.studentName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {lesson.roomName}{lesson.editable && !lesson.substitute && ` · Libres: ${free.length ? free.join(', ') : 'nadie de la academia'}`}
                                        </p>
                                    </div>
                                    {lesson.substitute ? (
                                        <div className="flex items-center gap-1">
                                            <Badge tone="success">Reemplazo: {lesson.substitute}{lesson.substitutePhone && ` · ${lesson.substitutePhone}`}</Badge>
                                            {lesson.editable && (
                                                <Button variant="ghost" size="icon" aria-label="Quitar reemplazo" title="Quitar reemplazo" onClick={() => run(() => api.removeSubstitute([lesson.id]), 'La clase volvió a su profesor.')}>
                                                    <X size={14} />
                                                </Button>
                                            )}
                                        </div>
                                    ) : lesson.editable ? (
                                        <Badge tone="warning">Sin reemplazo</Badge>
                                    ) : (
                                        <StatusBadge map={LESSON_LABELS} value={lessonStatusKey(lesson)} />
                                    )}
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>
            ))}
            {lessons.length === 0 && <p className="text-sm text-muted-foreground">{absence.teacherName} no tiene clases en esas fechas.</p>}
        </div>
    );
}

function Report() {
    const [month, setMonth] = useState(today().slice(0, 7));
    const { data, error } = useApiData(() => api.getSubstitutionReport(month), [month]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
                <p className="font-semibold w-40 text-center">{capitalize(monthLabel(month))}</p>
                <Button variant="ghost" size="icon" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Clases dadas por reemplazos</CardTitle>
                    <p className="text-xs text-muted-foreground">Dadas: el estudiante asistió o faltó (ambas se pagan). Por dar: aún programadas.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {data?.given.map(g => (
                        <details key={g.substitute} className="rounded-md border p-3">
                            <summary className="flex flex-wrap items-center gap-2 cursor-pointer">
                                <span className="font-medium">{g.substitute}</span>
                                {g.external && <Badge>Externo{g.phone && ` · ${g.phone}`}</Badge>}
                                <span className="text-sm text-muted-foreground ml-auto">{g.done} dada(s){g.upcoming > 0 && ` · ${g.upcoming} por dar`}</span>
                            </summary>
                            <ul className="mt-2 space-y-1 text-sm">
                                {g.lessons.map(l => (
                                    <li key={l.id} className="flex flex-wrap justify-between gap-2">
                                        <span>{capitalize(formatDateTime(l.startsAt))} · {l.studentName} <span className="text-muted-foreground">(de {l.teacherName})</span></span>
                                        <StatusBadge map={LESSON_LABELS} value={l.status} />
                                    </li>
                                ))}
                            </ul>
                        </details>
                    ))}
                    {data && data.given.length === 0 && <p className="text-sm text-muted-foreground">No hubo reemplazos este mes.</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Clases que movieron los profesores</CardTitle>
                    <p className="text-xs text-muted-foreground">No cuentan como cancelaciones. "2.ª vez" indica que la misma clase ya se había movido antes.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {data?.moves.map(m => (
                        <details key={m.teacherName} className="rounded-md border p-3">
                            <summary className="flex items-center gap-2 cursor-pointer">
                                <span className="font-medium">{m.teacherName}</span>
                                <span className="text-sm text-muted-foreground ml-auto">{m.count} movida(s)</span>
                            </summary>
                            <ul className="mt-2 space-y-1 text-sm">
                                {m.lessons.map(l => (
                                    <li key={l.id} className="flex flex-wrap items-center gap-2">
                                        <span>{l.studentName}: {formatShortDay(localParts(l.from).date)} {localParts(l.from).time} → {l.to ? `${formatShortDay(localParts(l.to).date)} ${localParts(l.to).time}` : '—'}</span>
                                        {l.time > 1 && <Badge tone="warning">{l.time}.ª vez</Badge>}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    ))}
                    {data && data.moves.length === 0 && <p className="text-sm text-muted-foreground">Ningún profesor movió clases este mes.</p>}
                </CardContent>
            </Card>
        </div>
    );
}

// "Reemplazos": the academy records teacher absences and decides who gives each class,
// so lessons do not have to be cancelled and rescheduled one by one
export function AcademySubstitutes() {
    const { teachers } = useApp();
    const [tab, setTab] = useState('absences');
    const [showPast, setShowPast] = useState(false);
    const [creating, setCreating] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const { data: absences, error, reload } = useApiData(() => api.getAbsences(showPast), [showPast]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Reemplazos</h2>
                    <p className="text-muted-foreground">Cuando un profesor se ausenta, otro (de la academia o externo) da sus clases. El estudiante sigue siendo de su profesor.</p>
                </div>
                {tab === 'absences' && !selectedId && !creating && (
                    <Button className="gap-2" onClick={() => setCreating(true)}><Plus size={16} />Registrar ausencia</Button>
                )}
            </div>

            <div className="flex gap-1 rounded-lg border p-1 w-fit" role="tablist">
                {[['absences', 'Ausencias'], ['report', 'Reporte del mes']].map(([id, label]) => (
                    <button
                        key={id} type="button" role="tab" aria-selected={tab === id}
                        onClick={() => { setTab(id); setSelectedId(null); }}
                        className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === id ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'report' && <Report />}

            {tab === 'absences' && selectedId && <AbsenceDetail id={selectedId} onBack={() => setSelectedId(null)} onChanged={reload} />}

            {tab === 'absences' && !selectedId && (
                <>
                    {creating && (
                        <NewAbsenceForm
                            teachers={teachers}
                            onCancel={() => setCreating(false)}
                            onCreated={(absence) => { setCreating(false); reload(); setSelectedId(absence.id); }}
                        />
                    )}
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />
                        Ver también las que ya terminaron
                    </label>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="grid gap-3">
                        {absences?.map(a => (
                            <Card key={a.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setSelectedId(a.id)}>
                                <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                                    <CalendarX2 size={20} className="text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold">{a.teacherName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatShortDay(a.startDate)} al {formatShortDay(a.endDate)}{a.reason && ` · ${a.reason}`}
                                        </p>
                                    </div>
                                    <SummaryBadges summary={a.summary} />
                                    <ChevronRight size={16} className="text-muted-foreground hidden md:block" />
                                </CardContent>
                            </Card>
                        ))}
                        {absences?.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No hay ausencias registradas.</p>}
                    </div>
                </>
            )}
        </div>
    );
}
