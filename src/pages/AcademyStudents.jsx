import React, { useState } from 'react';
import { Search, UserPlus, Pencil, KeyRound, Archive, RotateCcw, Trash2, ChevronDown, ChevronUp, Plus, CheckCircle2, XCircle, FileText, Ban } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, formatCOP, inputClass } from '../lib/utils';
import { PAYMENT_LABELS, PLAN_LABELS, cycleBadge, levelLabel } from '../lib/labels';
import { LEVELS } from '../lib/mockData';
import { WEEKDAYS, formatShortDay, today } from '../lib/time';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Modal, Field } from '../components/ui/Modal';
import { TempPasswordModal } from '../components/TempPasswordModal';
import { CycleProgress } from '../components/CycleProgress';
import { SingleClassesModal, MonthlyChargeModal } from '../components/StudentChargeModals';

const EMPTY_FORM = {
    name: '', email: '', instrumentId: '', teacherId: '', birthDate: '', phone: '', guardianName: '', guardianPhone: '', level: '',
    createCycle: false, plan: 'paquete_4', startDate: today(), paid: false,
};

// A teacher with no instruments set yet can take any student
const teaches = (teacher, instrumentId) => !instrumentId || !teacher.instrumentIds?.length || teacher.instrumentIds.includes(instrumentId);

function StudentForm({ initial, teachers, instruments, onSubmit, onCancel, submitLabel, isNew }) {
    // With a single active instrument there is nothing to choose
    const [form, setForm] = useState(() => {
        const active = instruments.filter(i => i.active);
        return !initial.instrumentId && active.length === 1 ? { ...initial, instrumentId: active[0].id } : initial;
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    const teacherChanged = !isNew && (form.teacherId || '') !== (initial.teacherId || '');
    // Active instruments, plus the student's current one if it was deactivated
    const instrumentOptions = instruments.filter(i => i.active || i.id === initial.instrumentId);
    const teacherOptions = teachers.filter(t => teaches(t, form.instrumentId));
    // With teachers in several cities, the city is shown next to each name
    const severalCities = new Set(teachers.map(t => t.cityId).filter(Boolean)).size > 1;

    // Each instrument has its own levels
    const levelsOf = (instrumentId) => instruments.find(i => i.id === instrumentId)?.levels || LEVELS;
    const levelOptions = levelsOf(form.instrumentId);
    const level = levelOptions.includes(form.level) ? form.level : levelOptions[0];

    // A teacher who does not teach the new instrument is unassigned; a level it does not have goes to its first one
    const setInstrument = (e) => {
        const instrumentId = e.target.value;
        const teacher = teachers.find(t => t.id === form.teacherId);
        const ladder = levelsOf(instrumentId);
        setForm({
            ...form,
            instrumentId,
            level: ladder.includes(form.level) ? form.level : ladder[0],
            ...(teacher && !teaches(teacher, instrumentId) && { teacherId: '' }),
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            await onSubmit({ ...form, level });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nombre completo"><input className={inputClass} value={form.name} onChange={set('name')} required /></Field>
                <Field label="Email (usuario para entrar)"><input type="email" className={inputClass} value={form.email} onChange={set('email')} required /></Field>
                <Field label="Instrumento">
                    <select className={inputClass} value={form.instrumentId || ''} onChange={setInstrument} required>
                        <option value="" disabled>Elige un instrumento</option>
                        {instrumentOptions.map(i => <option key={i.id} value={i.id}>{i.name}{!i.active && ' (inactivo)'}</option>)}
                    </select>
                </Field>
                <Field label="Nivel">
                    <select className={inputClass} value={level} onChange={set('level')}>
                        {levelOptions.map(l => <option key={l} value={l}>{levelLabel(l)}</option>)}
                    </select>
                </Field>
                <Field
                    label="Profesor"
                    hint={[
                        form.instrumentId && 'Solo aparecen los profesores que enseñan este instrumento.',
                        'El estudiante queda en la ciudad de su profesor y paga los valores de esa ciudad.',
                    ].filter(Boolean).join(' ')}
                >
                    <select className={inputClass} value={form.teacherId || ''} onChange={set('teacherId')}>
                        <option value="">Sin asignar</option>
                        {teacherOptions.map(t => (
                            <option key={t.id} value={t.id}>{t.name}{severalCities && t.cityName ? ` (${t.cityName})` : ''}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Fecha de nacimiento"><input type="date" className={inputClass} value={form.birthDate || ''} onChange={set('birthDate')} /></Field>
                <Field label="Teléfono del estudiante"><input type="tel" inputMode="tel" autoComplete="tel" className={inputClass} value={form.phone || ''} onChange={set('phone')} /></Field>
                <Field label="Acudiente" hint="Solo contacto. El acudiente usa la cuenta del estudiante.">
                    <input className={inputClass} value={form.guardianName || ''} onChange={set('guardianName')} />
                </Field>
                <Field label="Teléfono del acudiente"><input type="tel" inputMode="tel" className={inputClass} value={form.guardianPhone || ''} onChange={set('guardianPhone')} /></Field>
            </div>

            {teacherChanged && (
                <p className="rounded-md bg-orange-50 p-3 text-xs text-orange-900">
                    Al cambiar de profesor, su horario actual se libera y las clases que le quedan del ciclo pasan al nuevo profesor para que las agende.
                </p>
            )}

            {isNew && (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                    El cobro se crea solo cuando su profesor le asigna el horario: el primer mes paga las clases que le quedan
                    (nunca más que la mensualidad) y desde el mes siguiente la mensualidad completa el día 1.
                </p>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{submitLabel}</Button>
            </div>
        </form>
    );
}

function NewCycleModal({ student, onClose, onSaved }) {
    const [form, setForm] = useState({ plan: 'paquete_4', startDate: '' });
    const [error, setError] = useState('');
    const { data: suggestion } = useApiData(() => api.suggestCycleStart(student.id), [student.id]);
    const startDate = form.startDate || suggestion?.startDate || '';

    const save = async (e) => {
        e.preventDefault();
        try {
            await api.createCycle({ studentId: student.id, plan: form.plan, startDate });
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={`Nueva mensualidad de ${student.name}`} onClose={onClose}>
            <form onSubmit={save} className="space-y-4">
                <div className="grid gap-4 grid-cols-2">
                    <Field label="Plan">
                        <select className={inputClass} value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>
                            {Object.entries(PLAN_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </Field>
                    <Field label="Desde" hint="Sugerida: después del ciclo actual.">
                        <input type="date" className={inputClass} value={startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} required />
                    </Field>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit">Crear</Button>
                </div>
            </form>
        </Modal>
    );
}

function RejectModal({ cycle, onClose, onSaved }) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const save = async (e) => {
        e.preventDefault();
        try {
            await api.rejectCycle(cycle.id, reason);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };
    return (
        <Modal title="Rechazar pago" onClose={onClose}>
            <form onSubmit={save} className="space-y-4">
                <Field label="Motivo" hint="El estudiante lo verá y podrá subir un nuevo comprobante.">
                    <textarea className={`${inputClass} min-h-[80px]`} value={reason} onChange={e => setReason(e.target.value)} required />
                </Field>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" variant="destructive">Rechazar pago</Button>
                </div>
            </form>
        </Modal>
    );
}

// The student's cycles with the payment actions
function StudentCycles({ student, cycles, onChanged, onError }) {
    const [creating, setCreating] = useState(false);
    const [rejecting, setRejecting] = useState(null);
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? cycles : cycles.filter(c => ['pendiente_pago', 'activo'].includes(c.status));

    const act = async (fn) => {
        try {
            await fn();
            onChanged();
        } catch (err) {
            onError(err.message);
        }
    };

    return (
        <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
                {/* 4-week cycles (old billing): only the ones that exist; new charges are monthly, in Pagos */}
                <p className="text-sm font-semibold">Ciclos de 4 semanas</p>
                <div className="flex gap-1">
                    {cycles.length > visible.length || showAll ? (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll(!showAll)}>
                            {showAll ? 'Solo vigentes' : 'Ver historial'}
                        </Button>
                    ) : null}
                </div>
            </div>
            {visible.map(cycle => {
                const waiting = cycle.status === 'pendiente_pago';
                return (
                    <div key={cycle.id} className={cn("rounded-md border p-3 space-y-2", cycle.paymentStatus === 'en_revision' && "border-blue-300 bg-blue-50/40")}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium">{PLAN_LABELS[cycle.plan]} · {formatCOP(cycle.amount)}</p>
                                <p className="text-xs text-muted-foreground">
                                    {cycle.summary.unscheduled
                                        ? 'Pagada: el profesor debe agendar las clases'
                                        : `${formatShortDay(cycle.startDate)} al ${formatShortDay(cycle.endDate)}`}
                                </p>
                            </div>
                            <div className="flex gap-1">
                                <StatusBadge map={PAYMENT_LABELS} value={cycle.paymentStatus} />
                                <Badge tone={cycleBadge(cycle).tone}>{cycleBadge(cycle).label}</Badge>
                            </div>
                        </div>
                        {cycle.status === 'activo' && !cycle.summary.unscheduled && (
                            <div className="space-y-1">
                                <CycleProgress units={cycle.summary.units} total={cycle.summary.total} />
                                <p className="text-xs text-muted-foreground">
                                    {cycle.summary.taken} de {cycle.summary.total} tomadas{cycle.summary.pendingMakeups > 0 && ` · ${cycle.summary.pendingMakeups} por reponer`}
                                </p>
                            </div>
                        )}
                        {cycle.rejectionReason && cycle.paymentStatus === 'pendiente' && (
                            <p className="text-xs text-red-600">Rechazado: {cycle.rejectionReason}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            {cycle.hasReceipt && (
                                <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => act(() => api.openReceipt(cycle.id))}><FileText size={14} />Comprobante</Button>
                            )}
                            {waiting && (
                                <>
                                    <Button
                                        size="sm" className="h-7 gap-1"
                                        onClick={() => confirm(`¿Confirmar el pago de ${formatCOP(cycle.amount)}?`) && act(() => api.confirmCycle(cycle.id))}
                                    >
                                        <CheckCircle2 size={14} />Confirmar pago
                                    </Button>
                                    {cycle.paymentStatus === 'en_revision' && (
                                        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setRejecting(cycle)}><XCircle size={14} />Rechazar</Button>
                                    )}
                                    <Button
                                        size="sm" variant="ghost" className="h-7 gap-1 text-muted-foreground"
                                        onClick={() => confirm('¿Anular esta mensualidad sin pagar?') && act(() => api.cancelCycle(cycle.id))}
                                    >
                                        <Ban size={14} />Anular
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
            {visible.length === 0 && <p className="text-xs text-muted-foreground">Sin mensualidades vigentes.</p>}

            {creating && <NewCycleModal student={student} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); onChanged(); }} />}
            {rejecting && <RejectModal cycle={rejecting} onClose={() => setRejecting(null)} onSaved={() => { setRejecting(null); onChanged(); }} />}
        </div>
    );
}

const describeSchedule = (fixed) => `${WEEKDAYS[fixed.weekday]} ${fixed.startTime} · ${fixed.roomName}`;

// The badge that sums up a student's payment situation (monthly billing first, then old 4-week cycles)
function PaymentSummary({ cycles, student }) {
    const payment = student.monthlyPayment;
    if (payment) {
        if (payment.status === 'en_revision') return <Badge tone="info">Comprobante por revisar</Badge>;
        if (payment.status === 'aprobado') return <Badge tone="success">Al día</Badge>;
        if (payment.standing === 'vencido') return <Badge tone="danger">Pago vencido</Badge>;
        if (payment.status === 'rechazado') return <Badge tone="danger">Comprobante rechazado</Badge>;
        return <Badge tone="warning">Pago pendiente</Badge>;
    }
    const review = cycles.find(c => c.paymentStatus === 'en_revision');
    const pending = cycles.find(c => c.status === 'pendiente_pago' && c.paymentStatus === 'pendiente');
    const active = cycles.find(c => c.status === 'activo');
    if (review) return <Badge tone="info">Comprobante por revisar</Badge>;
    if (active?.summary.unscheduled) return <Badge tone="warning">Pagada, por agendar</Badge>;
    if (pending && !active) return <Badge tone="warning">Pago pendiente</Badge>;
    if (active) return <Badge tone="success">Al día</Badge>;
    if (!student.fixedSchedules?.length) return <Badge>Sin horario</Badge>;
    return <Badge tone="warning">Horario sin cobro</Badge>;
}

export function AcademyStudents() {
    const { teachers, refreshTeachers } = useApp();
    const [showArchived, setShowArchived] = useState(false);
    const { data, error: loadError, reload } = useApiData(
        () => Promise.all([showArchived ? api.getArchivedStudents() : api.getAcademyStudents(), api.getCycles()]),
        [showArchived]
    );
    const [students, allCycles] = data || [[], []];
    const { data: instruments } = useApiData(() => api.getInstruments(true), []);
    const { data: cities } = useApiData(() => api.getCities(), []);
    // Single classes or a mensualidad charged by the academy
    const [charging, setCharging] = useState(null);
    const [chargeMessage, setChargeMessage] = useState('');
    const chargeDone = (text) => {
        setCharging(null);
        setChargeMessage(text);
        setTimeout(() => setChargeMessage(''), 6000);
        reload();
    };
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(null);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(null);
    const [credentials, setCredentials] = useState(null);
    const [actionError, setError] = useState('');
    const error = actionError || loadError;

    const changed = () => { setError(''); reload(); refreshTeachers(); };

    const handleCreate = async (form) => {
        const { createCycle, plan, startDate, paid, ...studentData } = form;
        const { student, tempPassword } = await api.createStudent({
            ...studentData,
            ...(createCycle && { cycle: { plan, startDate, paid } }),
        });
        setCreating(false);
        setCredentials({ name: student.name, email: student.email, password: tempPassword });
        setExpanded(student.id);
        changed();
    };

    const handleUpdate = async (form) => {
        await api.updateStudent(editing.id, form);
        setEditing(null);
        changed();
    };

    const run = async (fn) => {
        setError('');
        try {
            await fn();
            changed();
        } catch (err) {
            setError(err.message);
        }
    };

    // Warns first when the student still has classes, because archiving loses them
    const handleArchive = async (student) => {
        setError('');
        try {
            const { upcoming, owed, chargesToAnnul = 0 } = await api.getArchivePreview(student.id);
            const pending = upcoming + owed;
            const warning = pending
                ? `⚠ ${student.name} tiene ${pending} clase(s) pendiente(s)`
                    + ` (${upcoming} agendada(s)${owed ? ` y ${owed} por reponer` : ''}). Si lo archivas, esas clases se pierden y no se devuelven.\n\n`
                : '';
            const charges = chargesToAnnul
                ? `Tiene ${chargesToAnnul} cobro(s) sin pagar: se anulan.\n\n`
                : '';
            const ok = confirm(
                `${warning}${charges}¿Archivar a ${student.name}? Se libera su horario, se le avisa a su profesor y no podrá entrar a la app. Puedes restaurarlo después, pero sin las clases perdidas.`
            );
            if (ok) await run(() => api.archiveStudent(student.id));
        } catch (err) {
            setError(err.message);
        }
    };

    // Permanent: asks to type the name to avoid deleting the wrong student
    const handleDelete = async (student) => {
        const typed = prompt(
            `Esto borra para siempre a ${student.name} con todas sus clases, pagos y comprobantes. Sus pagos dejan de contar en los ingresos. No se puede deshacer.\n\nEscribe su nombre para confirmar:`
        );
        if (typed === null) return;
        if (typed.trim().toLowerCase() !== student.name.trim().toLowerCase()) {
            setError('El nombre no coincide; no se eliminó.');
            return;
        }
        await run(() => api.deleteStudent(student.id));
    };

    const handleReset = async (student) => {
        if (!confirm(`¿Generar una nueva contraseña temporal para ${student.name}?`)) return;
        try {
            const { tempPassword } = await api.resetStudentPassword(student.id);
            setCredentials({ name: student.name, email: student.email, password: tempPassword });
        } catch (err) {
            setError(err.message);
        }
    };

    const term = search.trim().toLowerCase();
    const visible = students.filter(s =>
        !term || [s.name, s.email, s.teacherName, s.guardianName, s.instrumentName].some(v => v && v.toLowerCase().includes(term))
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Estudiantes</h2>
                    <p className="text-muted-foreground">Cuentas, profesor, horario y mensualidades de cada estudiante.</p>
                </div>
                <Button onClick={() => setCreating(true)} className="gap-2">
                    <UserPlus size={16} />
                    Nuevo estudiante
                </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative max-w-sm flex-1">
                    <Search size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
                    <input className={`${inputClass} pl-9`} placeholder="Buscar por nombre, email, instrumento, profesor o acudiente" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); setExpanded(null); }} />
                    Ver archivados
                </label>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid gap-3">
                {visible.map(student => {
                    const cycles = allCycles.filter(c => c.studentId === student.id);
                    const open = expanded === student.id;
                    return (
                        <Card key={student.id} className={cn(showArchived && 'opacity-80')}>
                            <CardContent className="p-4 space-y-3">
                                <div className="flex flex-col md:flex-row md:items-center gap-4">
                                    <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(open ? null : student.id)}>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-semibold">{student.name}</p>
                                            {student.mustChangePassword && <Badge tone="info">Contraseña temporal</Badge>}
                                            {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                                        {student.guardianName && (
                                            <p className="text-xs text-muted-foreground">Acudiente: {student.guardianName} {student.guardianPhone && `· ${student.guardianPhone}`}</p>
                                        )}
                                    </button>
                                    <div className="md:w-52 text-sm">
                                        <p className="text-xs text-muted-foreground">{student.instrumentName || 'Sin instrumento'} · {levelLabel(student.level)}</p>
                                        <p>{student.teacherName || 'Sin profesor'}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {student.fixedSchedules.length ? student.fixedSchedules.map(describeSchedule).join(', ') : 'Sin horario'}
                                        </p>
                                    </div>
                                    <div className="md:w-48 space-y-1">
                                        <PaymentSummary cycles={cycles} student={student} />
                                        {student.pendingMakeups > 0 && <p className="text-xs text-orange-700">{student.pendingMakeups} clase(s) por reponer</p>}
                                        {student.singleClassesToBook > 0 && (
                                            <p className="text-xs text-orange-700">
                                                {student.singleClassesToBook === 1 ? '1 clase suelta' : `${student.singleClassesToBook} clases sueltas`} sin agendar por el profesor
                                            </p>
                                        )}
                                        {!showArchived && (
                                            <div className="flex flex-wrap gap-1 pt-1">
                                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCharging({ type: 'sueltas', student })}>Clases sueltas</Button>
                                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCharging({ type: 'mensualidad', student })}>Mensualidad</Button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        {showArchived ? (
                                            <>
                                                <Button variant="outline" size="sm" className="gap-1" onClick={() => run(() => api.restoreStudent(student.id))}><RotateCcw size={14} />Restaurar</Button>
                                                <Button variant="ghost" size="sm" className="gap-1 text-red-600" onClick={() => handleDelete(student)}><Trash2 size={14} />Eliminar</Button>
                                            </>
                                        ) : (
                                            <>
                                                <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing(student)}><Pencil size={16} /></Button>
                                                <Button variant="ghost" size="icon" aria-label="Nueva contraseña temporal" onClick={() => handleReset(student)}><KeyRound size={16} /></Button>
                                                <Button
                                                    variant="ghost" size="icon" aria-label="Archivar"
                                                    onClick={() => handleArchive(student)}
                                                >
                                                    <Archive size={16} />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {open && <StudentCycles student={student} cycles={cycles} onChanged={changed} onError={setError} />}
                            </CardContent>
                        </Card>
                    );
                })}
                {visible.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">{showArchived ? 'No hay estudiantes archivados.' : 'No hay estudiantes.'}</p>
                )}
            </div>

            {charging?.type === 'sueltas' && (
                <SingleClassesModal student={charging.student} cities={cities} onClose={() => setCharging(null)} onDone={chargeDone} />
            )}
            {charging?.type === 'mensualidad' && (
                <MonthlyChargeModal student={charging.student} cities={cities} onClose={() => setCharging(null)} onDone={chargeDone} />
            )}
            {chargeMessage && (
                <p role="status" className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 shadow">
                    {chargeMessage}
                </p>
            )}

            {creating && (
                <Modal title="Nuevo estudiante" onClose={() => setCreating(false)} className="max-w-2xl">
                    <StudentForm initial={EMPTY_FORM} teachers={teachers} instruments={instruments || []} onSubmit={handleCreate} onCancel={() => setCreating(false)} submitLabel="Crear estudiante" isNew />
                </Modal>
            )}
            {editing && (
                <Modal title={`Editar a ${editing.name}`} onClose={() => setEditing(null)} className="max-w-2xl">
                    <StudentForm initial={editing} teachers={teachers} instruments={instruments || []} onSubmit={handleUpdate} onCancel={() => setEditing(null)} submitLabel="Guardar" />
                </Modal>
            )}
            {credentials && <TempPasswordModal {...credentials} onClose={() => setCredentials(null)} />}
        </div>
    );
}
