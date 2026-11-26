import React, { useState } from 'react';
import { Megaphone, Send, Pencil, Trash2, EyeOff, Eye } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, inputClass } from '../lib/utils';
import { AUDIENCE_LABELS } from '../lib/labels';
import { addDays, formatShortDay, today } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field } from '../components/ui/Modal';

const MAX_CONTENT = 2000;
const ACADEMY_AUDIENCES = ['todos', 'estudiantes', 'profesores'];

// Title, message, audience (academy only) and until when it is shown
function AnnouncementForm({ initial, isAcademy, submitLabel, onSubmit, onCancel }) {
    const [form, setForm] = useState(initial);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            await onSubmit(form);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Título">
                <input className={inputClass} maxLength={120} value={form.title} onChange={set('title')} placeholder="Ej.: Recital de fin de año" required />
            </Field>
            <Field label="Mensaje" hint={`${form.content.length} de ${MAX_CONTENT} caracteres`}>
                <textarea className={`${inputClass} min-h-[120px]`} maxLength={MAX_CONTENT} value={form.content} onChange={set('content')} placeholder="Escribe tu mensaje aquí..." required />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
                {isAcademy && form.audience !== 'mis_estudiantes' && (
                    <Field label="Para quién">
                        <select className={inputClass} value={form.audience} onChange={set('audience')}>
                            {ACADEMY_AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>)}
                        </select>
                    </Field>
                )}
                <Field label="Visible hasta" hint="Después de esa fecha sale de los avisos y queda en el historial.">
                    <input type="date" className={inputClass} min={today()} value={form.visibleUntil} onChange={set('visibleUntil')} required />
                </Field>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
                {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>}
                <Button type="submit" disabled={saving} className="gap-2"><Send size={16} />{submitLabel}</Button>
            </div>
        </form>
    );
}

// "Anuncios": the academy publishes for everyone, students or teachers; a teacher for their students.
// Published announcements show in the readers' "Avisos" until their end date.
export function Announcements() {
    const { user } = useApp();
    const isAcademy = user.role === 'academy';
    const { data: settingsData } = useApiData(() => api.getSettings(), []);
    const { data, error: loadError, reload } = useApiData(() => api.getAnnouncements(), []);
    const [tab, setTab] = useState('current');
    const [editing, setEditing] = useState(null);
    const [formKey, setFormKey] = useState(0);
    const [actionError, setError] = useState('');
    const error = actionError || loadError;
    const defaultDays = settingsData?.settings.dias_vigencia_anuncio ?? 15;

    const announcements = data || [];
    const current = announcements.filter(a => a.current);
    const past = announcements.filter(a => !a.current);
    const visible = tab === 'current' ? current : past;

    const publish = async (form) => {
        await api.createAnnouncement(form);
        setFormKey(k => k + 1);
        setTab('current');
        reload();
    };

    const saveEdit = async (form) => {
        const { title, content, visibleUntil, audience } = form;
        await api.updateAnnouncement(editing.id, { title, content, visibleUntil, ...(isAcademy && { audience }) });
        setEditing(null);
        reload();
    };

    const run = async (fn) => {
        setError('');
        try {
            await fn();
            reload();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Anuncios</h2>
                <p className="text-muted-foreground">
                    {isAcademy
                        ? 'Publica para toda la academia, solo para estudiantes o solo para profesores. Aquí también ves los anuncios de los profesores.'
                        : 'Lo que publiques aquí lo ven tus estudiantes en sus avisos hasta la fecha que elijas.'}
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Megaphone size={18} />Nuevo anuncio</CardTitle>
                </CardHeader>
                <CardContent>
                    {settingsData && (
                        <AnnouncementForm
                            key={formKey}
                            initial={{ title: '', content: '', audience: 'todos', visibleUntil: addDays(today(), defaultDays) }}
                            isAcademy={isAcademy}
                            submitLabel="Publicar"
                            onSubmit={publish}
                        />
                    )}
                </CardContent>
            </Card>

            <div className="space-y-4">
                <div className="flex gap-1 rounded-lg border p-1 w-fit" role="tablist">
                    {[['current', `Se muestran (${current.length})`], ['past', `Ya no se muestran (${past.length})`]].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            onClick={() => setTab(id)}
                            className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === id ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}

                {visible.map(a => (
                    <Card key={a.id}>
                        <CardContent className="p-4 space-y-2">
                            {editing?.id === a.id ? (
                                <AnnouncementForm
                                    initial={{ title: a.title, content: a.content, audience: a.audience, visibleUntil: a.current ? a.visibleUntil : today() }}
                                    isAcademy={isAcademy}
                                    submitLabel={a.current ? 'Guardar' : 'Guardar y volver a mostrar'}
                                    onSubmit={saveEdit}
                                    onCancel={() => setEditing(null)}
                                />
                            ) : (
                                <>
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold">{a.title}</p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                                <Badge tone={a.audience === 'mis_estudiantes' ? 'neutral' : 'primary'}>{AUDIENCE_LABELS[a.audience]}</Badge>
                                                {isAcademy && a.audience === 'mis_estudiantes' && <span className="text-xs text-muted-foreground">de {a.author}</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing(a)}><Pencil size={16} /></Button>
                                            {a.current ? (
                                                <Button variant="ghost" size="icon" aria-label="Dejar de mostrar" title="Dejar de mostrar" onClick={() => run(() => api.endAnnouncement(a.id))}><EyeOff size={16} /></Button>
                                            ) : (
                                                <Button variant="ghost" size="icon" aria-label="Volver a mostrar" title="Volver a mostrar" onClick={() => setEditing(a)}><Eye size={16} /></Button>
                                            )}
                                            <Button
                                                variant="ghost" size="icon" aria-label="Eliminar" className="text-red-600"
                                                onClick={() => confirm(`¿Eliminar "${a.title}"? También desaparece del historial.`) && run(() => api.deleteAnnouncement(a.id))}
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground whitespace-pre-line">{a.content}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Publicado el {formatShortDay(a.date)}
                                        {a.current ? ` · visible hasta el ${formatShortDay(a.visibleUntil)}` : ` · se mostró hasta el ${formatShortDay(a.visibleUntil)}`}
                                        {` · leído por ${a.readCount} ${a.readCount === 1 ? 'persona' : 'personas'}`}
                                    </p>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ))}
                {data && visible.length === 0 && (
                    <p className="text-muted-foreground text-center py-8">{tab === 'current' ? 'No hay anuncios a la vista.' : 'Aún no hay anuncios vencidos.'}</p>
                )}
            </div>
        </div>
    );
}
