import React, { useState } from 'react';
import { CalendarClock, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { inputClass } from '../lib/utils';
import { levelLabel, isOpenRequest } from '../lib/labels';
import { localParts, toUtc } from '../lib/time';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal, Field } from '../components/ui/Modal';
import { LevelRequestSummary } from '../components/LevelRequests';

function ScheduleModal({ request, onClose, onSaved }) {
    const current = request.showcaseAt ? localParts(request.showcaseAt) : null;
    const [form, setForm] = useState({ date: current?.date || '', time: current?.time || '', place: request.showcasePlace || '' });
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.scheduleShowcase(request.id, toUtc(form.date, form.time).toISOString(), form.place);
            onSaved();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={`Muestra de ${request.studentName}`} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Se avisa al estudiante y a {request.teacherName}. No reserva salón en la agenda de clases.
                </p>
                <div className="grid gap-4 grid-cols-2">
                    <Field label="Día"><input type="date" className={inputClass} value={form.date} onChange={set('date')} required /></Field>
                    <Field label="Hora"><input type="time" step={900} className={inputClass} value={form.time} onChange={set('time')} required /></Field>
                </div>
                <Field label="Lugar"><input className={inputClass} placeholder="Ej: Auditorio, Salón 1" value={form.place} onChange={set('place')} required /></Field>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit">{request.showcaseAt ? 'Reprogramar' : 'Programar'}</Button>
                </div>
            </form>
        </Modal>
    );
}

// approve: optional comment; reject: required reason
function DecisionModal({ request, approve, onClose, onSaved }) {
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            if (approve) await api.approveLevelRequest(request.id, text);
            else await api.rejectLevelRequest(request.id, text);
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={approve ? 'Aprobar ascenso' : 'Rechazar ascenso'} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm">
                    {approve
                        ? <>{request.studentName} pasará de {levelLabel(request.studentLevel)} a <span className="font-semibold">{levelLabel(request.toLevel)}</span>. Se avisa al estudiante y a {request.teacherName}.</>
                        : <>{request.studentName} se queda en {levelLabel(request.studentLevel)}. Se avisa a {request.teacherName}, que podrá enviar una nueva solicitud.</>}
                </p>
                <Field label={approve ? 'Comentario (opcional)' : 'Motivo'}>
                    <textarea className={`${inputClass} min-h-[72px]`} value={text} onChange={e => setText(e.target.value)} required={!approve} />
                </Field>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button type="submit" disabled={saving} variant={approve ? 'primary' : 'destructive'}>{approve ? 'Aprobar' : 'Rechazar'}</Button>
                </div>
            </form>
        </Modal>
    );
}

// "Ascensos": level-up requests the teachers send; only the academy changes a level
export function AcademyLevelRequests() {
    const { data, error, reload } = useApiData(() => api.getLevelRequests(), []);
    const requests = data || [];
    const [showClosed, setShowClosed] = useState(false);
    const [scheduling, setScheduling] = useState(null);
    const [deciding, setDeciding] = useState(null); // { request, approve }

    const visible = requests.filter(r => showClosed || isOpenRequest(r));
    const done = (setter) => () => { setter(null); reload(); };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Ascensos</h2>
                <p className="text-muted-foreground">
                    Los profesores envían videos de tres obras (A, B y C) o piden una muestra. El nivel solo cambia cuando lo apruebas.
                </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
                Mostrar aprobadas, rechazadas y canceladas
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid gap-4 md:grid-cols-2">
                {visible.map(r => {
                    const needsShowcase = r.modality === 'muestra' && r.status === 'pendiente';
                    return (
                        <Card key={r.id} className={needsShowcase ? 'border-orange-300' : ''}>
                            <CardContent className="p-5 space-y-4">
                                <LevelRequestSummary request={r} showStudent />
                                {needsShowcase && <p className="text-xs text-orange-800">Programa la muestra para poder aprobarla.</p>}
                                {isOpenRequest(r) && (
                                    <div className="flex flex-wrap gap-2">
                                        {r.modality === 'muestra' && (
                                            <Button size="sm" variant={needsShowcase ? 'primary' : 'outline'} className="h-8 gap-1" onClick={() => setScheduling(r)}>
                                                <CalendarClock size={14} />{r.showcaseAt ? 'Reprogramar muestra' : 'Programar muestra'}
                                            </Button>
                                        )}
                                        {!needsShowcase && (
                                            <Button size="sm" className="h-8 gap-1" onClick={() => setDeciding({ request: r, approve: true })}>
                                                <CheckCircle2 size={14} />Aprobar
                                            </Button>
                                        )}
                                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-muted-foreground" onClick={() => setDeciding({ request: r, approve: false })}>
                                            <XCircle size={14} />Rechazar
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
                {data && visible.length === 0 && <p className="text-sm text-muted-foreground">No hay solicitudes de ascenso por revisar.</p>}
            </div>

            {scheduling && <ScheduleModal request={scheduling} onClose={() => setScheduling(null)} onSaved={done(setScheduling)} />}
            {deciding && <DecisionModal {...deciding} onClose={() => setDeciding(null)} onSaved={done(setDeciding)} />}
        </div>
    );
}
