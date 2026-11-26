import React, { useState } from 'react';
import { CalendarClock, ClipboardCheck, Lock, Unlock, UserCheck, Plus, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { formatCOP, inputClass } from '../lib/utils';
import { ASSESSMENT_LABELS, PLAN_LABELS } from '../lib/labels';
import { WEEKDAYS, capitalize, formatDateTime, toUtc } from '../lib/time';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Modal, Field } from '../components/ui/Modal';
import { TempPasswordModal } from '../components/TempPasswordModal';

const hoursLeft = (expiresAt) => Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 3600000));

function CreateAssessmentModal({ teachers, onClose, onSaved }) {
    const [form, setForm] = useState({ studentName: '', studentBirthDate: '', contactName: '', contactPhone: '', contactEmail: '', date: '', time: '', teacherId: '' });
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const { date, time, ...data } = form;
            await api.createAssessment({ ...data, scheduledAt: toUtc(date, time).toISOString() });
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title="Nueva valoración" onClose={onClose} className="max-w-2xl">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Nombre del aspirante"><input className={inputClass} value={form.studentName} onChange={set('studentName')} required /></Field>
                    <Field label="Fecha de nacimiento"><input type="date" className={inputClass} value={form.studentBirthDate} onChange={set('studentBirthDate')} /></Field>
                    <Field label="Contacto (acudiente o el mismo aspirante)"><input className={inputClass} value={form.contactName} onChange={set('contactName')} /></Field>
                    <Field label="Teléfono"><input className={inputClass} value={form.contactPhone} onChange={set('contactPhone')} /></Field>
                    <Field label="Email"><input type="email" className={inputClass} value={form.contactEmail} onChange={set('contactEmail')} /></Field>
                    <Field label="Profesor">
                        <select className={inputClass} value={form.teacherId} onChange={set('teacherId')} required>
                            <option value="">Elige un profesor</option>
                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </Field>
                    <Field label="Día de la valoración"><input type="date" className={inputClass} value={form.date} onChange={set('date')} required /></Field>
                    <Field label="Hora"><input type="time" step={900} className={inputClass} value={form.time} onChange={set('time')} required /></Field>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit">Registrar</Button>
                </div>
            </form>
        </Modal>
    );
}

function HoldModal({ assessment, rooms, settings, onClose, onSaved }) {
    const teacherRooms = rooms.filter(r => r.active && r.teachers.some(t => t.id === assessment.teacherId));
    const [form, setForm] = useState({ roomId: teacherRooms[0]?.id || '', weekday: '1', startTime: '' });
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.holdAssessmentSlot(assessment.id, { ...form, weekday: Number(form.weekday) });
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={`Apartar horario para ${assessment.studentName}`} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    El horario queda apartado {settings?.horas_cupo_apartado ?? 48} horas. Si no se registra el pago, se libera solo.
                    Debe estar dentro de las franjas de clase de {assessment.teacherName}.
                </p>
                <Field label="Salón">
                    <select className={inputClass} value={form.roomId} onChange={set('roomId')} required>
                        {teacherRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </Field>
                {teacherRooms.length === 0 && <p className="text-xs text-red-500">{assessment.teacherName} no tiene salones asignados.</p>}
                <div className="grid gap-4 grid-cols-2">
                    <Field label="Día">
                        <select className={inputClass} value={form.weekday} onChange={set('weekday')}>
                            {[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                        </select>
                    </Field>
                    <Field label="Hora de inicio"><input type="time" step={900} className={inputClass} value={form.startTime} onChange={set('startTime')} required /></Field>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" disabled={teacherRooms.length === 0}>Apartar</Button>
                </div>
            </form>
        </Modal>
    );
}

function ConvertModal({ assessment, settings, onClose, onConverted }) {
    const [form, setForm] = useState({ email: assessment.contactEmail || '', plan: 'paquete_4', startDate: '' });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const amount = form.plan === 'suelta' ? settings?.precio_clase_suelta : settings?.precio_paquete_4;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            onConverted(await api.convertAssessment(assessment.id, form));
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Registrar pago e inscribir" onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Se crea la cuenta de {assessment.studentName}, su horario fijo ({WEEKDAYS[assessment.holdWeekday]} {assessment.holdStartTime},
                    {' '}{assessment.holdRoomName}) y la mensualidad pagada con sus clases.
                </p>
                <Field label="Email para la cuenta"><input type="email" className={inputClass} value={form.email} onChange={set('email')} required /></Field>
                <div className="grid gap-4 grid-cols-2">
                    <Field label="Plan">
                        <select className={inputClass} value={form.plan} onChange={set('plan')}>
                            {Object.entries(PLAN_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </Field>
                    <Field label="Inicio (opcional)" hint="Por defecto, la próxima clase.">
                        <input type="date" className={inputClass} value={form.startDate} onChange={set('startDate')} />
                    </Field>
                </div>
                {amount !== undefined && <p className="text-sm">Valor recibido: <span className="font-semibold">{formatCOP(amount)}</span></p>}
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" disabled={saving}>Confirmar pago e inscribir</Button>
                </div>
            </form>
        </Modal>
    );
}

function ResultEditor({ assessment, onSaved }) {
    const [result, setResult] = useState(assessment.result || '');
    const [saved, setSaved] = useState(false);
    const save = async () => {
        await api.updateAssessment(assessment.id, { result, status: assessment.status === 'agendada' ? 'realizada' : undefined });
        setSaved(true);
        onSaved();
    };
    return (
        <div className="space-y-2">
            <textarea
                className={`${inputClass} min-h-[64px]`}
                placeholder="Resultado: nivel sugerido, observaciones..."
                value={result}
                onChange={e => { setResult(e.target.value); setSaved(false); }}
            />
            <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8" onClick={save} disabled={result === (assessment.result || '')}>Guardar resultado</Button>
                {saved && <span className="text-xs text-green-600">Guardado</span>}
            </div>
        </div>
    );
}

export function AcademyAssessments() {
    const { teachers } = useApp();
    const { data, error: loadError, reload: load } = useApiData(
        () => Promise.all([api.getAssessments(), api.getRooms(), api.getSettings()]),
        []
    );
    const [assessments, rooms, settingsData] = data || [[], [], null];
    const settings = settingsData?.settings;
    const [creating, setCreating] = useState(false);
    const [holding, setHolding] = useState(null);
    const [converting, setConverting] = useState(null);
    const [credentials, setCredentials] = useState(null);
    const [showClosed, setShowClosed] = useState(false);
    const [actionError, setError] = useState('');
    const error = actionError || loadError;

    const act = async (fn) => {
        setError('');
        try {
            await fn();
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const isOpen = (a) => !['convertida', 'descartada'].includes(a.status);
    const visible = assessments.filter(a => showClosed || isOpen(a));

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Valoraciones</h2>
                    <p className="text-muted-foreground">El cupo solo queda reservado al pagar. Apartar un horario lo guarda por tiempo limitado.</p>
                </div>
                <Button onClick={() => setCreating(true)} className="gap-2"><Plus size={16} />Nueva valoración</Button>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
                Mostrar inscritas y descartadas
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid gap-4 md:grid-cols-2">
                {visible.map(a => (
                    <Card key={a.id} className={a.holdActive ? 'border-orange-300' : ''}>
                        <CardContent className="p-5 space-y-4">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold">{a.studentName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {[a.contactName, a.contactPhone, a.contactEmail].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                                    </p>
                                </div>
                                <StatusBadge map={ASSESSMENT_LABELS} value={a.status} />
                            </div>

                            <p className="text-sm flex items-center gap-2">
                                <CalendarClock size={14} className="text-primary" />
                                {capitalize(formatDateTime(a.scheduledAt))} con {a.teacherName}
                            </p>

                            {a.holdStatus === 'apartado' && (
                                <div className={`rounded-md p-3 text-sm ${a.holdActive ? 'bg-orange-50 text-orange-900' : 'bg-secondary text-muted-foreground'}`}>
                                    <p className="font-medium flex items-center gap-2"><Lock size={14} />
                                        {WEEKDAYS[a.holdWeekday]} {a.holdStartTime} · {a.holdRoomName}
                                    </p>
                                    <p className="text-xs mt-1">
                                        {a.holdActive
                                            ? `Apartado hasta el ${formatDateTime(a.holdExpiresAt)} (quedan ${hoursLeft(a.holdExpiresAt)} h)`
                                            : 'El tiempo de apartado venció; el horario ya está libre para otros.'}
                                    </p>
                                </div>
                            )}
                            {a.status === 'convertida' && <Badge tone="success">Inscrito con pago confirmado</Badge>}

                            {isOpen(a) && (
                                <>
                                    <ResultEditor assessment={a} onSaved={load} />
                                    <div className="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setHolding(a)}>
                                            <ClipboardCheck size={14} />{a.holdStatus === 'apartado' ? 'Cambiar horario' : 'Apartar horario'}
                                        </Button>
                                        {a.holdStatus === 'apartado' && (
                                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => act(() => api.releaseAssessmentHold(a.id))}>
                                                <Unlock size={14} />Liberar
                                            </Button>
                                        )}
                                        {['apartado', 'liberado'].includes(a.holdStatus) && (
                                            <Button size="sm" className="h-8 gap-1" onClick={() => setConverting(a)}>
                                                <UserCheck size={14} />Registrar pago e inscribir
                                            </Button>
                                        )}
                                        <Button
                                            size="sm" variant="ghost" className="h-8 gap-1 text-muted-foreground"
                                            onClick={() => confirm(`¿Descartar la valoración de ${a.studentName}?`) && act(() => api.updateAssessment(a.id, { status: 'descartada' }))}
                                        >
                                            <XCircle size={14} />Descartar
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ))}
                {visible.length === 0 && <p className="text-sm text-muted-foreground">No hay valoraciones abiertas.</p>}
            </div>

            {creating && <CreateAssessmentModal teachers={teachers} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
            {holding && <HoldModal assessment={holding} rooms={rooms} settings={settings} onClose={() => setHolding(null)} onSaved={() => { setHolding(null); load(); }} />}
            {converting && (
                <ConvertModal
                    assessment={converting}
                    settings={settings}
                    onClose={() => setConverting(null)}
                    onConverted={(result) => {
                        setConverting(null);
                        setCredentials({ name: result.student.name, email: result.student.email, password: result.tempPassword });
                        load();
                    }}
                />
            )}
            {credentials && <TempPasswordModal {...credentials} onClose={() => setCredentials(null)} />}
        </div>
    );
}
