
import React, { useState } from 'react';
import { ArrowRight, CalendarClock, ExternalLink, Video, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { inputClass } from '../lib/utils';
import { LEVELS } from '../lib/mockData';
import { LEVEL_REQUEST_LABELS, MODALITY_LABELS, levelLabel, isOpenRequest } from '../lib/labels';
import { capitalize, formatDateTime } from '../lib/time';
import { Button } from './ui/Button';
import { Badge, StatusBadge } from './ui/Badge';
import { Modal, Field } from './ui/Modal';

const CATEGORIES = ['A', 'B', 'C'];

const MODALITY_OPTIONS = [
    { value: 'videos', label: 'Enviar videos', icon: Video },
    { value: 'muestra', label: 'Pedir muestra', icon: Users },
];

// What was asked, the three pieces and, when there is one, the showcase and the academy's answer
export function LevelRequestSummary({ request, showStudent = false }) {
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                {showStudent && <span className="font-semibold">{request.studentName}</span>}
                <span className="text-sm flex items-center gap-1">
                    {levelLabel(request.fromLevel)} <ArrowRight size={14} className="text-muted-foreground" /> <span className="font-semibold text-primary">{levelLabel(request.toLevel)}</span>
                </span>
                <Badge tone="neutral" className="gap-1">
                    {request.modality === 'videos' ? <Video size={12} /> : <Users size={12} />}
                    {MODALITY_LABELS[request.modality]}
                </Badge>
                <StatusBadge map={LEVEL_REQUEST_LABELS} value={request.status} />
            </div>

            <ul className="space-y-1.5">
                {request.pieces.map(piece => (
                    <li key={piece.category} className="flex items-start gap-2 text-sm">
                        <span className="h-5 w-5 shrink-0 rounded bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{piece.category}</span>
                        <span className="min-w-0 flex-1">
                            {piece.title}{piece.composer && <span className="text-muted-foreground"> · {piece.composer}</span>}
                        </span>
                        {piece.videoUrl && (
                            <a href={piece.videoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-primary hover:underline flex items-center gap-1">
                                Ver video <ExternalLink size={12} />
                            </a>
                        )}
                    </li>
                ))}
            </ul>

            {request.notes && <p className="text-xs text-muted-foreground">Nota del profesor: {request.notes}</p>}
            {request.showcaseAt && isOpenRequest(request) && (
                <p className="text-sm flex items-center gap-2 rounded-md bg-primary/5 p-2">
                    <CalendarClock size={14} className="text-primary shrink-0" />
                    Muestra: {capitalize(formatDateTime(request.showcaseAt))} · {request.showcasePlace}
                </p>
            )}
            {request.decisionReason && (
                <p className={`text-xs ${request.status === 'rechazada' ? 'text-red-700' : 'text-muted-foreground'}`}>
                    {request.status === 'rechazada' ? 'Motivo del rechazo' : 'Comentario de la academia'}: {request.decisionReason}
                </p>
            )}
            <p className="text-[11px] text-muted-foreground">
                Enviada el {formatDateTime(request.createdAt)}{request.teacherName && ` por ${request.teacherName}`}
            </p>
        </div>
    );
}

// The teacher asks for a student's level-up: videos (a link per piece) or a showcase
export function LevelRequestModal({ student, onClose, onSaved }) {
    // The levels above the student's, on the ladder of their instrument
    const { data: ladder } = useApiData(
        () => (student.instrumentId ? api.getInstrumentLevels(student.instrumentId).then(r => r.levels) : Promise.resolve(LEVELS)),
        [student.instrumentId]
    );
    const levels = ladder || [];
    const higher = levels.slice(levels.indexOf(student.level) + 1);
    const [modality, setModality] = useState('videos');
    const [chosenLevel, setToLevel] = useState('');
    const toLevel = higher.includes(chosenLevel) ? chosenLevel : higher[0] || '';
    const [pieces, setPieces] = useState(CATEGORIES.map(category => ({ category, title: '', composer: '', videoUrl: '' })));
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const setPiece = (index, field) => (e) => setPieces(pieces.map((p, i) => (i === index ? { ...p, [field]: e.target.value } : p)));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            await api.createLevelRequest({ studentId: student.id, modality, toLevel, pieces, notes });
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`Solicitar ascenso de ${student.name}`} onClose={onClose} className="max-w-2xl">
            {!ladder ? (
                <p className="text-sm text-muted-foreground">Cargando niveles…</p>
            ) : higher.length === 0 ? (
                <p className="text-sm text-muted-foreground">{student.name} ya está en el nivel más alto.</p>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        La academia revisa la solicitud. El nivel solo cambia cuando la aprueba.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Modalidad" group>
                            <div className="grid grid-cols-2 gap-2">
                                {MODALITY_OPTIONS.map(option => {
                                    const Icon = option.icon;
                                    return (
                                        <label
                                            key={option.value}
                                            className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${modality === option.value ? 'border-primary bg-primary/5 font-medium' : ''}`}
                                        >
                                            <input type="radio" name="modality" value={option.value} checked={modality === option.value} onChange={() => setModality(option.value)} className="sr-only" />
                                            <Icon size={16} className="text-primary" />{option.label}
                                        </label>
                                    );
                                })}
                            </div>
                        </Field>
                        <Field label="Nivel al que aspira" hint={`Hoy está en ${levelLabel(student.level)}.`}>
                            <select className={inputClass} value={toLevel} onChange={e => setToLevel(e.target.value)}>
                                {higher.map(l => <option key={l} value={l}>{levelLabel(l)}</option>)}
                            </select>
                        </Field>
                    </div>

                    <div className="space-y-3">
                        <p className="text-sm font-medium">
                            Obras de {levelLabel(toLevel)}, una por categoría
                            {modality === 'videos' ? ', con el link de cada video' : ''}
                        </p>
                        {pieces.map((piece, index) => (
                            <div key={piece.category} className="flex gap-3 rounded-md border p-3">
                                <span className="h-7 w-7 shrink-0 rounded bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">{piece.category}</span>
                                <div className="flex-1 grid gap-2 md:grid-cols-2">
                                    <input className={inputClass} placeholder="Título de la obra" aria-label={`Obra ${piece.category}`} value={piece.title} onChange={setPiece(index, 'title')} required />
                                    <input className={inputClass} placeholder="Compositor" aria-label={`Compositor ${piece.category}`} value={piece.composer} onChange={setPiece(index, 'composer')} />
                                    {modality === 'videos' && (
                                        <input
                                            type="url" className={`${inputClass} md:col-span-2`} placeholder="https://youtube.com/..." aria-label={`Video ${piece.category}`}
                                            value={piece.videoUrl} onChange={setPiece(index, 'videoUrl')} required
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <Field label="Nota para la academia (opcional)">
                        <textarea className={`${inputClass} min-h-[60px]`} value={notes} onChange={e => setNotes(e.target.value)} />
                    </Field>

                    {error && <p className="text-sm text-red-500">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" disabled={saving}>{modality === 'videos' ? 'Enviar videos' : 'Solicitar muestra'}</Button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
