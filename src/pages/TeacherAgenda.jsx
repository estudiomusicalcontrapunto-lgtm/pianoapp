import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Repeat, CalendarCheck, MoveRight, XCircle, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, inputClass } from '../lib/utils';
import { LESSON_LABELS, lessonStatusKey } from '../lib/labels';
import {
    WEEKDAYS, addDays, capitalize, formatDateTime, formatDay, formatMonth, localParts, mondayOf, today, toUtc, weekdayOf,
} from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Modal, Field } from '../components/ui/Modal';
import { WeekCalendar, CalendarLegend } from '../components/WeekCalendar';

function ErrorText({ error }) {
    return error ? <p className="text-sm text-red-500">{error}</p> : null;
}

// Tap on an empty slot: give a student their weekly class there. The teacher
// does not charge anything: the classes come from what the academy charged.
const weekdayPlural = (weekday) => {
    const name = WEEKDAYS[weekday].toLowerCase();
    return name.endsWith('s') ? name : `${name}s`;
};

// Where the classes of a new weekly time go, before saving (nothing is saved)
function SchedulePreview({ preview, studentName, slot, freed }) {
    if (!preview) return <p className="text-sm text-muted-foreground">Revisando dónde quedan las clases…</p>;
    // The tapped time is free only that day (a class there was moved or cancelled): explain it instead of "ocupado"
    if (preview.error && freed) {
        const why = freed.status.startsWith('cancelada') ? 'se canceló' : 'se cambió de horario';
        return (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-2">
                <p>
                    Este espacio solo está libre el <span className="font-semibold">{formatDay(slot.date)}</span>: la clase de {freed.studentName} de ese día {why}.
                    Los demás {weekdayPlural(weekdayOf(slot.date))} a las {localParts(freed.startsAt).time} siguen siendo suyos, así que aquí no se puede poner un horario semanal.
                </p>
                <p>
                    Para usarlo solo ese día: en "Por agendar", toca "Agendar" en una clase suelta o una reposición y luego este espacio.
                    También puedes tocar la clase de otro estudiante y elegir "Mover solo esta clase".
                </p>
            </div>
        );
    }
    if (preview.error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{preview.error}</p>;
    const { lessons = [], needsCharge, fixed, months = [], awaitingPayment = [] } = preview;
    const firstDate = lessons.length ? localParts(lessons[0].startsAt).date : fixed.validFrom;
    const notWhereTapped = firstDate !== slot.date;
    const waitingNote = awaitingPayment.length > 0 && (
        <p className="rounded bg-orange-100 p-2 text-xs text-orange-900">
            Las clases de {awaitingPayment.map(formatMonth).join(' y ')} aparecen cuando la academia apruebe el pago.
        </p>
    );

    if (needsCharge) {
        return (
            <div className="rounded-md bg-orange-50 p-3 text-sm text-orange-900 space-y-1">
                <p className="font-medium">Todavía no se crea ninguna clase.</p>
                <p>
                    {studentName} no tiene mensualidad cobrada. El horario queda reservado desde el {formatDay(fixed.validFrom)} y
                    las clases aparecen cuando la academia cobre la mensualidad y apruebe el pago.
                </p>
            </div>
        );
    }
    if (!lessons.length && awaitingPayment.length) {
        return (
            <div className="rounded-md bg-orange-50 p-3 text-sm text-orange-900 space-y-1">
                <p className="font-medium">Todavía no se crea ninguna clase.</p>
                <p>
                    La academia aún no ha aprobado el pago de {studentName} de {awaitingPayment.map(formatMonth).join(' y ')}.
                    El horario queda reservado desde el {formatDay(fixed.validFrom)} y las clases aparecen cuando lo apruebe.
                </p>
            </div>
        );
    }
    if (!lessons.length) {
        return <p className="rounded-md bg-primary/5 p-3 text-sm">El horario queda desde el {formatDay(fixed.validFrom)}.</p>;
    }
    return (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
            <p className="font-medium">
                Se {lessons.length === 1 ? 'crea 1 clase' : `crean ${lessons.length} clases`}
                {months.length > 0 && <> de {months.map(formatMonth).join(' y ')} (pago aprobado por la academia)</>}:
            </p>
            <ul className="flex flex-wrap gap-1.5">
                {lessons.map(l => (
                    <li key={l.startsAt} className="rounded bg-card px-2 py-0.5 text-xs font-medium border">
                        {capitalize(formatDay(localParts(l.startsAt).date))}
                    </li>
                ))}
            </ul>
            {notWhereTapped && (
                <p className="rounded bg-amber-100 p-2 text-xs text-amber-900">
                    Ojo: la primera clase es el <span className="font-semibold">{formatDay(firstDate)}</span>, no el {formatDay(slot.date)} que tocaste.
                    Las clases van desde la primera semana del mes que la academia cobró.
                </p>
            )}
            {waitingNote}
        </div>
    );
}

function ScheduleModal({ slot, freed, room, students, lessonMinutes, onClose, onSaved }) {
    const eligible = students;
    const [form, setForm] = useState({ studentId: eligible.find(s => s.fixedSchedules.length === 0)?.id || eligible[0]?.id || '', durationMinutes: lessonMinutes });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const student = eligible.find(s => s.id === form.studentId);
    const body = {
        studentId: form.studentId, roomId: room.id, weekday: weekdayOf(slot.date), startTime: slot.time,
        durationMinutes: Number(form.durationMinutes),
        validFrom: slot.date,
    };
    // Each answer carries its own key, so a stale one (another student) is never shown
    const previewKey = `${form.studentId}|${form.durationMinutes}`;
    const { data: previewData } = useApiData(
        () => (form.studentId
            ? api.previewFixedSchedule(body).then(r => ({ key: previewKey, ...r }), err => ({ key: previewKey, error: err.message }))
            : Promise.resolve(null)),
        [previewKey]
    );
    const preview = previewData?.key === previewKey ? previewData : null;

    const save = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            onSaved(await api.createFixedSchedule(body));
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };
    const count = preview?.lessons?.length || 0;
    return (
        <Modal title="Agendar clase semanal" onClose={onClose}>
            <form onSubmit={save} className="space-y-4">
                <p className="text-sm">
                    Todos los <span className="font-semibold">{weekdayPlural(weekdayOf(slot.date))}</span> a las{' '}
                    <span className="font-semibold">{slot.time}</span> en {room.name}.
                </p>
                <Field label="Estudiante">

                    <select className={inputClass} value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })} required>
                        {eligible.length === 0 && <option value="">No tienes estudiantes asignados</option>}
                        {eligible.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.name}{s.fixedSchedules.length ? ` (ya tiene ${s.fixedSchedules.map(f => `${WEEKDAYS[f.weekday].toLowerCase()} ${f.startTime}`).join(', ')})` : ''}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Duración (minutos)">
                    <input type="number" min={15} step={15} className={inputClass} value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} />
                </Field>
                {form.studentId && <SchedulePreview preview={preview} studentName={student?.name} slot={slot} freed={freed} />}
                <p className="text-xs text-muted-foreground">
                    ¿Solo quieres una clase para otro día, sin cambiar el horario de las semanas? Toca la clase y elige "Mover solo esta clase".
                </p>
                <ErrorText error={error} />
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" disabled={!form.studentId || saving || !preview || !!preview.error}>
                        {count ? `Agendar ${count === 1 ? '1 clase' : `${count} clases`}` : 'Reservar horario'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function WindowModal({ window, rooms, onClose, onSaved }) {
    const [form, setForm] = useState(window);
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const save = async (e) => {
        e.preventDefault();
        setError('');
        const data = { ...form, type: 'reposicion', weekday: Number(form.weekday), capacity: Number(form.capacity || 1) };
        try {
            if (window.id) await api.updateAvailability(window.id, data);
            else await api.createAvailability(data);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async () => {
        if (!confirm('¿Quitar esta franja de reposición?')) return;
        try {
            await api.deleteAvailability(window.id);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={window.id ? 'Franja de reposición' : 'Nueva franja de reposición'} onClose={onClose}>
            <form onSubmit={save} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Horas que dejas libres para reposiciones. Tus estudiantes las eligen cuando cambian una clase, dentro del mismo mes. Si la academia o un profesor agenda una clase fija en una franja libre, la franja se reduce y te avisamos.
                    Puede ser una sola hora o un bloque más largo.
                </p>
                {window.id && (
                    <p className="text-xs text-muted-foreground">
                        Si ya hay estudiantes agendados en esta franja, para quitarla o cambiarla primero mueve o cancela esas clases.
                    </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Salón">
                        <select className={inputClass} value={form.roomId} onChange={set('roomId')}>
                            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Día">
                        <select className={inputClass} value={form.weekday} onChange={set('weekday')}>
                            {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                        </select>
                    </Field>
                    <Field label="Desde"><input type="time" step={900} className={inputClass} value={form.startTime} onChange={set('startTime')} required /></Field>
                    <Field label="Hasta"><input type="time" step={900} className={inputClass} value={form.endTime} onChange={set('endTime')} required /></Field>
                    <Field label="Cupo" hint="Reposiciones que caben cada semana.">
                        <input type="number" min={1} className={inputClass} value={form.capacity} onChange={set('capacity')} />
                    </Field>
                </div>
                <ErrorText error={error} />
                <div className="flex justify-between gap-2">
                    {window.id ? <Button type="button" variant="ghost" className="text-red-600" onClick={remove}>Quitar</Button> : <span />}
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit">Guardar</Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}

// fromLesson: the class the teacher tapped; it and the next ones move, the earlier ones stay
function FixedModal({ fixed, rooms, fromLesson = null, onClose, onSaved }) {
    const [form, setForm] = useState({ ...fixed, moveUpcoming: true });
    const fromDay = fromLesson && formatDay(localParts(fromLesson.startsAt).date);
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

    const save = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const { movedLessons } = await api.updateFixedSchedule(fixed.id, {
                roomId: form.roomId, weekday: Number(form.weekday), startTime: form.startTime,
                durationMinutes: Number(form.durationMinutes),
                moveUpcoming: form.moveUpcoming,
                ...(form.moveUpcoming && fromLesson && { fromLessonId: fromLesson.lessonId }),
                ...(!form.moveUpcoming && form.effectiveFrom && { effectiveFrom: form.effectiveFrom }),
            });
            const when = `los ${weekdayPlural(Number(form.weekday))} a las ${form.startTime}`;
            const which = fromLesson
                ? (movedLessons.length === 1 ? `la clase del ${fromDay} pasó` : `la clase del ${fromDay} y las ${movedLessons.length - 1} siguientes pasaron`)
                : (movedLessons.length === 1 ? 'la próxima clase pasó' : `las ${movedLessons.length} próximas clases pasaron`);
            onSaved(movedLessons.length
                ? `Horario cambiado a ${when}: ${which} al nuevo horario.`
                : `Horario cambiado a ${when}.`);
        } catch (err) {
            setError(err.message);
        }
    };

    const end = async () => {
        if (!confirm(`¿Quitar el horario de ${fixed.studentName}? Ya no se generarán clases en este horario.`)) return;
        try {
            await api.endFixedSchedule(fixed.id);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={`Horario semanal de ${fixed.studentName}`} onClose={onClose}>
            <form onSubmit={save} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Hoy: los <span className="font-medium text-foreground">{weekdayPlural(fixed.weekday)} a las {fixed.startTime}</span>.
                    Aquí cambias el día, la hora o el salón de todas las semanas. Para una sola clase, tócala en el calendario y elige "Mover solo esta clase".
                </p>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Salón">
                        <select className={inputClass} value={form.roomId} onChange={set('roomId')}>
                            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Día">
                        <select className={inputClass} value={form.weekday} onChange={set('weekday')}>
                            {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                        </select>
                    </Field>
                    <Field label="Hora"><input type="time" step={900} className={inputClass} value={form.startTime} onChange={set('startTime')} required /></Field>
                    <Field label="Duración (min)"><input type="number" min={15} step={15} className={inputClass} value={form.durationMinutes} onChange={set('durationMinutes')} /></Field>
                </div>
                <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={form.moveUpcoming} onChange={set('moveUpcoming')} />
                    <span>
                        {fromLesson ? `Mover la clase del ${fromDay} y las siguientes` : 'Mover también las clases que ya están agendadas'}
                        <span className="block text-xs text-muted-foreground">
                            {fromLesson
                                ? `Desde la clase del ${fromDay}, las clases semanales pasan al nuevo día y hora, cada una en su misma semana. Las anteriores se quedan como están.`
                                : 'Todas las próximas clases semanales pasan al nuevo día y hora, cada una en su misma semana.'}
                            {' '}Las reposiciones y las clases sueltas no se mueven.
                        </span>
                    </span>
                </label>
                {!form.moveUpcoming && (
                    <Field label="Aplicar desde (opcional)" hint="Por defecto, desde el próximo mes. Las clases ya agendadas se quedan en su fecha.">
                        <input type="date" className={inputClass} value={form.effectiveFrom || ''} onChange={set('effectiveFrom')} />
                    </Field>
                )}
                <ErrorText error={error} />
                <div className="flex justify-between gap-2">
                    <Button type="button" variant="ghost" className="text-red-600" onClick={end}>Quitar horario</Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit">Guardar</Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}

// A big choice button: what it does, said in one line under the title
function OptionButton({ icon, title, text, primary, onClick }) {
    const Icon = icon;
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex w-full min-h-11 items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                primary ? "border-primary bg-primary/5 hover:bg-primary/10" : "hover:bg-accent"
            )}
        >
            <Icon size={18} className={cn("mt-0.5 shrink-0", primary ? "text-primary" : "text-muted-foreground")} />
            <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{text}</span>
            </span>
        </button>
    );
}

// Tap on a class: move it, cancel it or mark attendance
function LessonModal({ block, fixed, onClose, onSaved, onMove, onChangeWeekly }) {
    const { user } = useApp();
    const [reason, setReason] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState('');
    const started = new Date(block.startsAt) <= new Date();
    const gradable = started && ['programada', 'tomada', 'perdida'].includes(block.status);
    // A substitute marks attendance; moving or cancelling stays with the lesson's teacher
    const covering = block.substituteTeacherId === user.id && block.teacherId !== user.id;
    const upcoming = !started && block.status === 'programada' && !covering;

    const run = async (fn) => {
        setError('');
        try {
            await fn();
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={block.studentName} onClose={onClose}>
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <p className="text-sm">{capitalize(formatDateTime(block.startsAt))}</p>
                        {block.classLabel && <p className="text-xs font-medium text-muted-foreground">{block.classLabel}</p>}
                    </div>
                    <StatusBadge map={LESSON_LABELS} value={lessonStatusKey(block)} />
                </div>
                {block.lessonKind === 'reposicion' && <p className="text-xs text-violet-700">Esta clase es una reposición.</p>}
                {covering && <p className="text-xs text-emerald-700">Das esta clase como reemplazo de {block.teacherName}.</p>}
                {block.substituteLabel && !covering && (
                    <p className="text-xs text-emerald-700">La academia asignó a {block.substituteLabel} como reemplazo para esta clase.</p>
                )}

                {upcoming && !cancelling && (
                    <div className="grid gap-2">
                        <OptionButton
                            icon={MoveRight} primary
                            title="Mover solo esta clase"
                            text={`Solo la del ${formatDay(localParts(block.startsAt).date)}: eliges otro día y hora de este mes. Las demás semanas siguen igual. No cuenta como cancelación.`}
                            onClick={() => onMove(block)}
                        />
                        {fixed && (
                            <OptionButton
                                icon={Repeat}
                                title="Cambiar el horario de todas las semanas"
                                text={`Hoy es los ${weekdayPlural(fixed.weekday)} a las ${fixed.startTime}. Esta clase y las siguientes pasan al nuevo día y hora.`}
                                onClick={() => onChangeWeekly(fixed)}
                            />
                        )}
                        <OptionButton
                            icon={XCircle}
                            title="Cancelar clase"
                            text="Queda por reponer y la agendas tú, a más tardar el último día del mes siguiente. Si no se alcanza a dar, se le descuenta al estudiante una clase de su siguiente pago."
                            onClick={() => setCancelling(true)}
                        />
                    </div>
                )}

                {upcoming && cancelling && (
                    <div className="space-y-2">
                        <Field label="Motivo (opcional)">
                            <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej: viaje, concierto" />
                        </Field>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setCancelling(false)}>Volver</Button>
                            <Button variant="destructive" onClick={() => run(() => api.cancelLessons([block.lessonId], reason || undefined))}>Cancelar clase y avisar</Button>
                        </div>
                    </div>
                )}

                {gradable && (
                    <div className="space-y-2">
                        <p className="text-sm font-medium">Asistencia</p>
                        <div className="flex gap-2">
                            <Button className="flex-1" variant={block.status === 'tomada' ? 'primary' : 'outline'} onClick={() => run(() => api.markAttendance(block.lessonId, 'tomada'))}>Tomada</Button>
                            <Button className="flex-1" variant={block.status === 'perdida' ? 'destructive' : 'outline'} onClick={() => run(() => api.markAttendance(block.lessonId, 'perdida'))}>No asistió</Button>
                        </div>
                        <p className="text-xs text-muted-foreground">"No asistió" cuenta como clase tomada.</p>
                    </div>
                )}
                {!gradable && !upcoming && <p className="text-sm text-muted-foreground">No hay acciones disponibles para esta clase.</p>}
                <ErrorText error={error} />
            </div>
        </Modal>
    );
}

// Confirms the target slot of a move or a make-up
function ConfirmSlotModal({ action, slot, room, onClose, onSaved }) {
    const [error, setError] = useState('');
    const startsAt = toUtc(slot.date, slot.time);
    const lesson = action.lesson;
    const isSingle = action.type === 'suelta';
    const confirmIt = async () => {
        try {
            const target = { roomId: room.id, startsAt: startsAt.toISOString() };
            if (action.type === 'move') await api.moveLesson(lesson.lessonId, target);
            else if (isSingle) await api.scheduleSingleClass(lesson.paymentId, target);
            else await api.bookMakeup(lesson.id, target);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };
    const title = { move: 'Mover clase', suelta: 'Agendar clase suelta' }[action.type] || 'Agendar clase pendiente';
    return (
        <Modal title={title} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm">
                    <span className="font-semibold">{lesson.studentName}</span>
                    {isSingle
                        ? `: clase suelta de ${formatMonth(lesson.period)} (${lesson.booked + 1} de ${lesson.total}).`
                        : `: clase del ${formatDateTime(lesson.startsAt)}.`}
                </p>
                <p className="text-sm">Nuevo horario: <span className="font-semibold">{capitalize(formatDateTime(startsAt))}</span> en {room.name}.</p>
                <p className="text-xs text-muted-foreground">El estudiante recibe un aviso con el cambio.</p>
                <ErrorText error={error} />
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button onClick={confirmIt}>Confirmar</Button>
                </div>
            </div>
        </Modal>
    );
}

const lessonAsBlock = (lesson) => ({
    id: `clase:${lesson.id}`,
    lessonId: lesson.id,
    lessonKind: lesson.kind,
    status: lesson.status,
    teacherId: lesson.teacherId,
    teacherName: lesson.teacherName,
    studentId: lesson.studentId,
    studentName: lesson.studentName,
    paymentId: lesson.paymentId || null,
    classLabel: lesson.classLabel || null,
    substituteTeacherId: lesson.substituteTeacherId,
    substituteLabel: lesson.substituteLabel,
    moved: !!lesson.moved,
    startsAt: lesson.startsAt,
    endsAt: lesson.endsAt,
});

/**
 * Phone: the classes of one day as a list (today by default), with attendance
 * one tap away and the full class actions (move, cancel) on tap.
 */
function DayList({ reloadKey, onOpen }) {
    const [date, setDate] = useState(today());
    const { data, error, reload } = useApiData(
        () => api.getLessons({ from: toUtc(date).toISOString(), to: toUtc(addDays(date, 1)).toISOString() }),
        [date, reloadKey]
    );
    const [busy, setBusy] = useState(null);
    const [actionError, setActionError] = useState('');
    const lessons = (data || []).filter(l => ['programada', 'tomada', 'perdida'].includes(l.status));

    const mark = async (lesson, status) => {
        setBusy(lesson.id);
        setActionError('');
        try {
            await api.markAttendance(lesson.id, status);
            reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const label = date === today() ? 'Hoy' : date === addDays(today(), 1) ? 'Mañana' : capitalize(formatDay(date));

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                    <Button variant="outline" size="icon" aria-label="Día anterior" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} /></Button>
                    <div className="text-center">
                        <CardTitle className="text-lg">{label}</CardTitle>
                        {label !== capitalize(formatDay(date)) && <p className="text-xs text-muted-foreground">{capitalize(formatDay(date))}</p>}
                    </div>
                    <Button variant="outline" size="icon" aria-label="Día siguiente" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} /></Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {error && <ErrorText error={error} />}
                {actionError && <ErrorText error={actionError} />}
                {data && lessons.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No tienes clases este día.</p>}
                {lessons.map(lesson => {
                    const started = new Date(lesson.startsAt) <= new Date();
                    return (
                        <div key={lesson.id} className="rounded-lg border p-3 space-y-2">
                            <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => onOpen(lessonAsBlock(lesson))}>
                                <div>
                                    <p className="font-semibold">{localParts(lesson.startsAt).time} · {lesson.studentName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {lesson.roomName}
                                        {lesson.classLabel ? ` · ${lesson.classLabel}` : lesson.kind === 'reposicion' && ' · Reposición'}
                                        {lesson.substituteLabel && ` · la dicta ${lesson.substituteLabel}`}
                                    </p>
                                </div>
                                <StatusBadge map={LESSON_LABELS} value={lessonStatusKey(lesson)} />
                            </button>
                            {started ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <Button variant={lesson.status === 'tomada' ? 'primary' : 'outline'} disabled={busy === lesson.id} onClick={() => mark(lesson, 'tomada')}>Asistió</Button>
                                    <Button variant={lesson.status === 'perdida' ? 'destructive' : 'outline'} disabled={busy === lesson.id} onClick={() => mark(lesson, 'perdida')}>No asistió</Button>
                                </div>
                            ) : (
                                <Button variant="outline" className="w-full gap-1" onClick={() => onOpen(lessonAsBlock(lesson))}>
                                    <MoveRight size={16} />Mover o cancelar
                                </Button>
                            )}
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}

export function TeacherAgenda() {
    const { user } = useApp();
    const { data: rooms } = useApiData(() => api.getRooms(), []);
    const [chosenRoomId, setChosenRoomId] = useState(null);
    const roomId = chosenRoomId || rooms?.[0]?.id || null;
    const room = rooms?.find(r => r.id === roomId);
    const [weekDate, setWeekDate] = useState(() => mondayOf(today()));
    const [slotMinutes, setSlotMinutes] = useState(30);
    // A pending action waiting for a tap on the calendar: { type: 'move' | 'makeup', lesson }
    const [action, setAction] = useState(null);
    const [modal, setModal] = useState(null);
    const [message, setMessage] = useState('');

    const week = useApiData(() => (roomId ? api.getRoomWeek(roomId, weekDate) : Promise.resolve(null)), [roomId, weekDate]);
    const extras = useApiData(
        () => Promise.all([
            api.getAvailability(), api.getFixedSchedules(), api.getPendingMakeups(), api.getAcademyStudents(), api.getSettings(),
            api.getPendingSingleClasses(),
        ]),
        []
    );
    const [windows, fixedSchedules, pending, students, settingsData, singles] = extras.data || [[], [], [], [], null, []];
    const lessonMinutes = settingsData?.settings.duracion_clase_minutos || 60;
    // The academy charged a mensualidad and the student has no weekly time yet
    // Students with a month charged (this month or a later one) and no weekly time yet
    const toSchedule = students.filter(s => s.fixedSchedules.length === 0 && s.monthCharge);

    // Phone: the day's list first; the week calendar to give new times or move classes
    const [mobileView, setMobileView] = useState('hoy');
    const [dayKey, setDayKey] = useState(0);
    const reloadAll = () => { week.reload(); extras.reload(); setDayKey(k => k + 1); };
    const done = (text = '') => { setModal(null); setAction(null); setMessage(text); reloadAll(); };
    const startAction = (next) => { setAction(next); setMobileView('semana'); };

    // The weekly time a regular class comes from (single classes and make-ups have none)
    const weeklyOf = (block) => {
        if (block.lessonKind === 'reposicion' || block.paymentId) return null;
        const date = localParts(block.startsAt).date;
        return fixedSchedules.find(f => f.studentId === block.studentId && f.teacherId === block.teacherId
            && f.validFrom <= date && (!f.validTo || f.validTo >= date)) || null;
    };

    // A class moved or cancelled on that day and time leaves it free only that day
    const freedClassAt = (slot) => (week.data?.blocks || []).find(b => {
        if (b.kind !== 'clase' || ['programada', 'tomada', 'perdida'].includes(b.status)) return false;
        const start = localParts(b.startsAt);
        const end = localParts(b.endsAt).time || '24:00';
        return start.date === slot.date && start.time <= slot.time && slot.time < end;
    }) || null;

    const onSlotClick = (slot) => {
        if (action) setModal({ type: 'confirm', slot });
        else setModal({ type: 'schedule', slot, freed: freedClassAt(slot) });
    };

    const onBlockClick = (block) => {
        if (block.kind === 'franja_reposicion') {
            const window = windows.find(w => w.id === block.sourceId);
            if (window) setModal({ type: 'window', window });
        } else if (block.kind === 'horario_fijo') {
            const fixed = fixedSchedules.find(f => f.id === block.sourceId);
            if (fixed) setModal({ type: 'fixed', fixed });
        } else if (block.kind === 'clase' && !action) {
            setModal({ type: 'lesson', block });
        }
    };

    if (rooms && rooms.length === 0) {
        return (
            <div className="space-y-4">
                <h2 className="text-3xl font-bold tracking-tight">Agenda de {user.name}</h2>
                <p className="text-muted-foreground">Aún no tienes salones asignados. Pídele a la academia que te asigne uno.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Mi agenda</h2>
                    <p className="hidden md:block text-muted-foreground">Toca un espacio libre para agendar una clase, o una clase para moverla o cancelarla.</p>
                </div>
                <Button variant="outline" className={cn("gap-2", mobileView === 'hoy' && "hidden md:inline-flex")} onClick={() => setModal({ type: 'window', window: { roomId, weekday: 6, startTime: '09:00', endTime: '10:00', capacity: 1 } })}>
                    <Repeat size={16} />Franja de reposición
                </Button>
            </div>

            {/* Phone: day list or week calendar */}
            <div className="md:hidden grid grid-cols-2 gap-2" role="tablist">
                <Button variant={mobileView === 'hoy' ? 'primary' : 'outline'} role="tab" aria-selected={mobileView === 'hoy'} onClick={() => setMobileView('hoy')}>Día</Button>
                <Button variant={mobileView === 'semana' ? 'primary' : 'outline'} role="tab" aria-selected={mobileView === 'semana'} onClick={() => setMobileView('semana')}>Semana</Button>
            </div>

            {message && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
            {(week.error || extras.error) && <ErrorText error={week.error || extras.error} />}

            {mobileView === 'hoy' && (
                <div className="md:hidden">
                    <DayList reloadKey={dayKey} onOpen={(block) => setModal({ type: 'lesson', block })} />
                </div>
            )}

            {(toSchedule.length > 0 || pending.length > 0 || singles.length > 0) && (
                <Card className="border-orange-300">
                    <CardHeader className="pb-2"><CardTitle className="text-base">Por agendar</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {toSchedule.map(s => (
                            <div key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-orange-50 p-2 text-sm">
                                <span>
                                    <span className="font-medium">{s.name}</span> ya tiene la mensualidad de {formatMonth(s.monthCharge.period)} y no tiene horario: toca un espacio libre del calendario para darle su clase semanal.
                                    {s.monthCharge.status !== 'aprobado' && (
                                        <span className="block text-xs text-orange-800">El pago aún no está aprobado: el horario queda reservado y las clases aparecen cuando la academia lo apruebe.</span>
                                    )}
                                </span>
                                <Badge tone="warning">Sin horario</Badge>
                            </div>
                        ))}
                        {singles.map(single => {
                            const approved = single.paymentStatus === 'aprobado';
                            return (
                                <div key={single.paymentId} className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md bg-orange-50 p-2", action?.lesson?.paymentId === single.paymentId && "ring-2 ring-primary")}>
                                    <div className="text-sm">
                                        <span className="font-medium">{single.studentName}</span>: {single.left === 1 ? '1 clase suelta' : `${single.left} clases sueltas`} de {formatMonth(single.period)} por agendar
                                        <span className="text-xs text-muted-foreground"> · la academia dio {single.total}</span>
                                        <p className="text-xs text-orange-800">
                                            {approved
                                                ? `Agéndalas dentro de ${formatMonth(single.period)}, en un espacio libre.`
                                                : 'Podrás agendarlas cuando la academia apruebe el pago.'}
                                        </p>
                                    </div>
                                    {approved ? (
                                        <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => { startAction({ type: 'suelta', lesson: single }); setMessage(''); }}>
                                            <CalendarCheck size={14} />Agendar
                                        </Button>
                                    ) : (
                                        <Badge tone="warning">Pago sin aprobar</Badge>
                                    )}
                                </div>
                            );
                        })}
                        {pending.map(lesson => (
                            <div key={lesson.id} className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md bg-orange-50 p-2", action?.lesson?.id === lesson.id && "ring-2 ring-primary")}>
                                <div className="text-sm">
                                    <span className="font-medium">{lesson.studentName}</span>: clase del {formatDateTime(lesson.startsAt)}
                                    <span className="text-xs text-muted-foreground"> · {lesson.reason || 'cancelada'}</span>
                                    {lesson.makeupDeadline && (
                                        <p className="text-xs text-orange-800">Repónla a más tardar el {formatDay(lesson.makeupDeadline)}, en cualquier hueco libre.</p>
                                    )}
                                </div>
                                <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => { startAction({ type: 'makeup', lesson }); setMessage(''); }}>
                                    <CalendarCheck size={14} />Agendar
                                </Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {action && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-primary bg-primary/5 p-3 text-sm">
                    <span className="flex items-center gap-2">
                        <Info size={16} className="text-primary" />
                        {action.type === 'move'
                            ? <>Toca en el calendario el nuevo horario <span className="font-semibold">solo para la clase del {formatDateTime(action.lesson.startsAt)}</span> de {action.lesson.studentName}. Las demás semanas no cambian.</>
                            : <>Toca en el calendario el nuevo horario para la clase de <span className="font-semibold">{action.lesson.studentName}</span>.</>}
                        {' '}Puedes cambiar de salón o de semana.
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancelar</Button>
                </div>
            )}

            <Card className={cn(mobileView === 'hoy' && 'hidden md:block')}>
                <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-3 space-y-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <select className={cn(inputClass, 'w-auto font-semibold')} value={roomId || ''} onChange={e => setChosenRoomId(e.target.value)} aria-label="Salón">
                            {(rooms || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        {week.data && <span className="text-sm text-muted-foreground">Semana del {formatDay(week.data.weekStart)}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                        <select className={cn(inputClass, 'w-auto mr-2')} value={slotMinutes} onChange={e => setSlotMinutes(Number(e.target.value))} aria-label="Tamaño de bloque">
                            <option value={30}>30 min</option>
                            <option value={15}>15 min</option>
                        </select>
                        <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setWeekDate(addDays(weekDate, -7))}><ChevronLeft size={16} /></Button>
                        <Button variant="outline" size="sm" onClick={() => setWeekDate(mondayOf(today()))}>Hoy</Button>
                        <Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={() => setWeekDate(addDays(weekDate, 7))}><ChevronRight size={16} /></Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    <CalendarLegend kinds={['clase', 'reposicion', 'cancelada', 'horario_fijo', 'franja_reposicion', 'cupo_apartado', 'ocupado']} />
                    {week.data && (
                        <WeekCalendar
                            days={week.data.days}
                            hours={week.data.hours}
                            blocks={week.data.blocks}
                            closures={week.data.closures}
                            slotMinutes={slotMinutes}
                            onSlotClick={onSlotClick}
                            onBlockClick={onBlockClick}
                            selectedBlockIds={action?.type === 'move' ? [action.lesson.id] : []}
                        />
                    )}
                </CardContent>
            </Card>

            <div className={cn("grid gap-4 lg:grid-cols-2", mobileView === 'hoy' && 'hidden md:grid')}>
                <Card>
                    <CardHeader><CardTitle className="text-base">Horarios de mis estudiantes</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {fixedSchedules.map(f => (
                            <button key={f.id} className="w-full text-left rounded-md border p-2 hover:bg-accent" onClick={() => setModal({ type: 'fixed', fixed: f })}>
                                <p className="text-sm font-medium">{f.studentName}</p>
                                <p className="text-xs text-muted-foreground">
                                    {WEEKDAYS[f.weekday]} {f.startTime} · {f.roomName}
                                    {f.validFrom > today() && ` · desde el ${formatDay(f.validFrom)}`}
                                    {f.validTo && ` · hasta el ${formatDay(f.validTo)}`}
                                </p>
                            </button>
                        ))}
                        {fixedSchedules.length === 0 && <p className="text-sm text-muted-foreground">Aún no has agendado clases.</p>}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle className="text-base">Franjas de reposición</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {windows.map(w => (
                            <button key={w.id} className="w-full text-left rounded-md border border-amber-200 p-2 hover:bg-amber-50" onClick={() => setModal({ type: 'window', window: w })}>
                                <p className="text-sm font-medium">{WEEKDAYS[w.weekday]} {w.startTime}–{w.endTime}</p>
                                <p className="text-xs text-amber-700">Cupo {w.capacity} · {w.roomName}</p>
                            </button>
                        ))}
                        {windows.length === 0 && <p className="text-sm text-muted-foreground">Sin franjas. Créalas para que tus estudiantes puedan reprogramar.</p>}
                    </CardContent>
                </Card>
            </div>

            {modal?.type === 'schedule' && room && (
                <ScheduleModal
                    slot={modal.slot} freed={modal.freed} room={room} students={students} lessonMinutes={lessonMinutes}
                    onClose={() => setModal(null)}
                    onSaved={({ scheduled, firstClassAt, months, needsCharge, awaitingPayment = [], fixed }) => {
                        // Show the week of the first class, which may not be this week
                        if (firstClassAt) setWeekDate(mondayOf(localParts(firstClassAt).date));
                        const waiting = awaitingPayment.length
                            ? ` Las clases de ${awaitingPayment.map(formatMonth).join(' y ')} aparecen cuando la academia apruebe el pago.`
                            : '';
                        done(
                            scheduled
                                ? `Horario agendado: se crearon ${scheduled} clases (${(months || []).map(formatMonth).join(' y ')}, pago aprobado por la academia). La primera es el ${formatDateTime(firstClassAt)}.${waiting}`
                                : needsCharge
                                    ? `Horario reservado desde el ${formatDay(fixed.validFrom)}. Las clases aparecen cuando la academia cobre la mensualidad y apruebe el pago.`
                                    : awaitingPayment.length
                                        ? `Horario reservado desde el ${formatDay(fixed.validFrom)}.${waiting}`
                                        : `Horario agendado desde el ${formatDay(fixed.validFrom)}.`
                        );
                    }}
                />
            )}
            {modal?.type === 'window' && <WindowModal window={modal.window} rooms={rooms} onClose={() => setModal(null)} onSaved={() => done()} />}
            {modal?.type === 'fixed' && <FixedModal fixed={modal.fixed} rooms={rooms} fromLesson={modal.fromLesson || null} onClose={() => setModal(null)} onSaved={(text) => done(text)} />}
            {modal?.type === 'lesson' && (
                <LessonModal
                    block={modal.block}
                    fixed={weeklyOf(modal.block)}
                    onChangeWeekly={(fixed) => setModal({ type: 'fixed', fixed, fromLesson: modal.block })}
                    onClose={() => setModal(null)}
                    onSaved={() => done()}
                    onMove={(block) => { setModal(null); setMessage(''); startAction({ type: 'move', lesson: { ...block, lessonId: block.lessonId, id: block.id } }); }}
                />
            )}
            {modal?.type === 'confirm' && action && room && (
                <ConfirmSlotModal
                    action={action} slot={modal.slot} room={room} onClose={() => setModal(null)}
                    onSaved={() => {
                        setWeekDate(mondayOf(modal.slot.date));
                        const remaining = action.type === 'suelta' ? action.lesson.left - 1 : 0;
                        const more = remaining > 0 ? ` ${remaining === 1 ? 'Falta 1' : `Faltan ${remaining}`} por agendar.` : '';
                        done(`Listo: la clase quedó para el ${formatDateTime(toUtc(modal.slot.date, modal.slot.time))}.${more}`);
                    }}
                />
            )}
        </div>
    );
}
