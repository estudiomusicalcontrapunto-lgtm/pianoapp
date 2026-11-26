
import React, { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn } from '../lib/utils';
import { capitalize, formatDateTime, formatDay, formatMonth, localParts } from '../lib/time';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

/**
 * "Cambiar clase": the student picks a free make-up slot of their teacher in
 * the same month. Only valid slots are offered. The new class is a make-up:
 * it cannot be changed again, and if the student misses it, it is lost.
 */
export function RescheduleModal({ lesson, rules, onClose, onDone }) {
    const { data, error: loadError, loading } = useApiData(() => api.getRescheduleOptions(lesson.id), [lesson.id]);
    const [chosen, setChosen] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const options = data?.options || [];
    const rule = data?.rule;
    const month = data?.month;
    const byDay = options.reduce((groups, option) => {
        const day = localParts(option.startsAt).date;
        (groups[day] = groups[day] || []).push(option);
        return groups;
    }, {});

    const confirm = async () => {
        setSaving(true);
        setError('');
        try {
            await api.rescheduleLesson(lesson.id, chosen);
            onDone(`Listo: tu clase quedó para el ${formatDateTime(chosen.startsAt)}.`);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <Modal title="Cambiar clase" onClose={onClose}>
            <div className="space-y-4">
                <div className="rounded-lg bg-secondary/50 p-3">
                    <p className="text-xs text-muted-foreground">Clase que vas a cambiar</p>
                    <p className="font-medium">{capitalize(formatDateTime(lesson.startsAt))}{lesson.roomName && ` · ${lesson.roomName}`}</p>
                    {rule?.ok && <p className="text-xs text-muted-foreground mt-1">{rule.message}</p>}
                </div>

                {rule && !rule.ok && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{rule.message}</p>
                )}

                {(rule?.ok ?? true) && (
                    <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        <li>Solo aparecen los cupos de reposición libres de tu profesor{month ? ` en ${formatMonth(month)}` : ''}.</li>
                        <li>La clase nueva es una reposición: ya no se puede volver a cambiar, y si no asistes se pierde.</li>
                        <li>Puedes cambiar una clase hasta {rules?.horas_minimas_aviso ?? 12} horas antes de que empiece.</li>
                    </ul>
                )}

                {loading && <p className="text-sm text-muted-foreground">Buscando cupos libres...</p>}
                {!loading && rule?.ok && options.length === 0 && !loadError && (
                    <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                        No hay cupos de reposición libres{month ? ` en ${formatMonth(month)}` : ''}. Tu clase sigue en su horario; si no puedes asistir, avísale a tu profesor.
                    </p>
                )}

                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    {Object.entries(byDay).map(([day, dayOptions]) => (
                        <div key={day} className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{capitalize(formatDay(day))}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {dayOptions.map(option => {
                                    const key = `${option.availabilityId || option.fixedScheduleId}-${option.startsAt}`;
                                    const selected = chosen && `${chosen.availabilityId || chosen.fixedScheduleId}-${chosen.startsAt}` === key;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setChosen(option)}
                                            className={cn(
                                                "min-h-11 rounded-md border px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                                                selected ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50 hover:bg-primary/5"
                                            )}
                                            aria-pressed={selected}
                                        >
                                            <CalendarClock size={14} />
                                            {localParts(option.startsAt).time}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {(error || loadError) && <p className="text-sm text-red-600">{error || loadError}</p>}

                <div className="flex justify-end gap-2 border-t pt-4">
                    <Button variant="outline" className="min-h-11" onClick={onClose}>Volver</Button>
                    <Button className="min-h-11" onClick={confirm} disabled={!chosen || saving}>Confirmar cambio</Button>
                </div>
            </div>
        </Modal>
    );
}
