
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LEVELS } from '../lib/mockData';
import { levelLabel } from '../lib/labels';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { LevelDetail } from '../components/LevelGuide';
import { Star, Trophy, Lock } from 'lucide-react';

export function StudentLevel() {
    const { user } = useApp();
    const { data: guide, error } = useApiData(
        () => (user.instrumentId ? api.getLevelGuide(user.instrumentId) : Promise.resolve(null)),
        [user.instrumentId]
    );
    // The ladder of the student's instrument (the standard one if they have none yet)
    const ladder = guide ? guide.levels.map(l => l.level) : (user.instrumentId ? [] : LEVELS);
    const currentLevelIndex = ladder.indexOf(user.level);
    // The requirements shown first are those of the level the student is working towards
    const [chosen, setSelected] = useState(null);
    const selected = ladder.includes(chosen) ? chosen : ladder[Math.min(currentLevelIndex + 1, ladder.length - 1)];
    const entry = guide?.levels.find(l => l.level === selected);
    const selectedIndex = ladder.indexOf(selected);

    return (
        <div className="space-y-6">
            <div className="relative overflow-hidden text-center py-8 bg-sidebar text-sidebar-foreground rounded-xl shadow-lg">
                <div className="staff-lines absolute inset-x-0 top-1/2 -translate-y-1/2 h-[141px] text-sidebar-foreground/10 pointer-events-none" aria-hidden="true" />
                <div className="relative">
                    <Trophy className="h-16 w-16 mx-auto mb-4 text-brand" strokeWidth={1.5} />
                    <h2 className="text-4xl font-semibold mb-2">{levelLabel(user.level)}</h2>
                    {user.instrument && <p className="text-lg font-medium mb-1">{user.instrument.name}</p>}
                    <p className="text-sidebar-muted">Sigue practicando para alcanzar el siguiente nivel.</p>
                </div>
            </div>

            <div>
                <h3 className="text-xl font-bold mt-8">Camino a la Maestría</h3>
                <p className="text-sm text-muted-foreground">Toca un nivel para ver lo que pide la academia.</p>
            </div>

            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {ladder.map((level, index) => {
                    const isUnlocked = index <= currentLevelIndex;
                    const isCurrent = index === currentLevelIndex;
                    const isProdigy = ["Prodigy", "Legend", "Genius"].includes(level);

                    return (
                        <Card
                            key={level}
                            role="button"
                            tabIndex={0}
                            aria-pressed={selected === level}
                            onClick={() => setSelected(level)}
                            onKeyDown={e => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                setSelected(level);
                            }}
                            className={`relative overflow-hidden transition-all cursor-pointer ${isCurrent ? 'ring-2 ring-primary border-primary shadow-xl' :
                                    !isUnlocked ? 'opacity-60 bg-muted' : ''
                                } ${selected === level ? 'outline outline-2 outline-offset-2 outline-brand' : ''}`}
                        >
                            <CardHeader className="pb-2">
                                <CardTitle className={`text-lg md:text-2xl flex justify-between items-center ${isProdigy ? 'text-purple-600' : ''}`}>
                                    <span>{levelLabel(level)}</span>
                                    {isUnlocked ? (
                                        <Star className={`h-5 w-5 ${isCurrent ? 'text-yellow-500 fill-yellow-500' : 'text-primary'}`} />
                                    ) : (
                                        <Lock className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {isCurrent && (
                                    <p className="text-xs font-medium text-primary">¡Tu nivel actual!</p>
                                )}
                                {!isUnlocked && (
                                    <p className="text-xs text-muted-foreground">Bloqueado</p>
                                )}
                                {isUnlocked && !isCurrent && (
                                    <p className="text-xs text-muted-foreground">Completado</p>
                                )}
                                {isProdigy && (
                                    <div className="absolute -right-4 -bottom-4 h-16 w-16 rounded-full bg-purple-100 blur-xl opacity-50 pointer-events-none"></div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <Card>
                <CardContent className="p-6">
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    {!user.instrumentId && <p className="text-sm text-muted-foreground">La academia aún no te ha asignado un instrumento.</p>}
                    {entry && (
                        <LevelDetail
                            key={selected}
                            entry={entry}
                            instrumentName={guide.instrument.name}
                            badge={
                                selectedIndex === currentLevelIndex ? <Badge tone="primary">Tu nivel actual</Badge>
                                    : selectedIndex === currentLevelIndex + 1 ? <Badge tone="info">Tu siguiente nivel</Badge>
                                        : null
                            }
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
