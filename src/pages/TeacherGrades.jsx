import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn } from '../lib/utils';
import { Card, CardContent } from '../components/ui/Card';
import { LevelList, LevelDetail } from '../components/LevelGuide';

// "Grados": the levels of the instruments the teacher teaches, with the
// academy's requirements and which of their students are at each level
export function TeacherGrades() {
    const { user, students } = useApp();
    const instruments = user.instruments || [];
    const [chosenId, setChosenId] = useState(null);
    const instrumentId = chosenId || instruments[0]?.id;
    const { data: guide, error } = useApiData(
        () => (instrumentId ? api.getLevelGuide(instrumentId) : Promise.resolve(null)),
        [instrumentId]
    );
    const [selected, setSelected] = useState('Inicial');
    const entry = guide?.levels.find(l => l.level === selected);
    const studentsAt = (level) => students.filter(s => s.active !== false && s.instrumentId === instrumentId && s.level === level);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Grados</h2>
                    <p className="text-muted-foreground">Lo que pide la academia en cada nivel y en qué nivel está cada uno de tus estudiantes.</p>
                </div>
                {instruments.length > 1 && (
                    <div className="flex gap-1 rounded-lg border p-1" role="tablist" aria-label="Instrumento">
                        {instruments.map(i => (
                            <button
                                key={i.id}
                                type="button"
                                role="tab"
                                aria-selected={i.id === instrumentId}
                                onClick={() => setChosenId(i.id)}
                                className={cn("rounded-md px-3 py-1.5 text-sm font-medium", i.id === instrumentId ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                            >
                                {i.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {instruments.length === 0 && (
                <p className="text-sm text-muted-foreground">La academia aún no te ha asignado instrumentos. Pídele que lo haga en Profesores.</p>
            )}

            {guide && guide.instrument.id === instrumentId && (
                <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                    <Card className="h-fit">
                        <CardContent className="p-2">
                            <LevelList
                                levels={guide.levels}
                                selected={selected}
                                onSelect={setSelected}
                                renderMeta={(e) => {
                                    const count = studentsAt(e.level).length;
                                    return count > 0 && (
                                        <span className="inline-flex items-center gap-0.5 text-[11px]" title={`${count} de tus estudiantes`}>
                                            <Users size={12} />{count}
                                        </span>
                                    );
                                }}
                            />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6 space-y-6">
                            {entry && <LevelDetail key={`${instrumentId}-${selected}`} entry={entry} instrumentName={guide.instrument.name} />}
                            <div className="border-t pt-4">
                                <p className="text-sm font-semibold mb-2">Tus estudiantes en este nivel</p>
                                {studentsAt(selected).length > 0 ? (
                                    <ul className="flex flex-wrap gap-2">
                                        {studentsAt(selected).map(s => (
                                            <li key={s.id} className="rounded-full bg-secondary px-3 py-1 text-sm">{s.name}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground">Ninguno.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
