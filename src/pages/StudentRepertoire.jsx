
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Button } from '../components/ui/Button';
import { PlayCircle } from 'lucide-react';
import { StudentPractice } from './StudentPractice';


export function StudentRepertoire() {
    const { user } = useApp();
    const [selectedPieceId, setSelectedPieceId] = useState(null);

    const activePiece = user?.repertoire?.find(p => p.id === selectedPieceId);

    if (activePiece) {
        return (
            <StudentPractice
                piece={activePiece}
                onBack={() => setSelectedPieceId(null)}
            />
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Mi Repertorio</h2>
                {user.teacherId && (
                    <span className="text-sm text-muted-foreground bg-secondary px-3 py-1 rounded-full">
                        Clase de: {user.teacherId} (ID)
                    </span>
                )}
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {user.repertoire.map((piece) => (
                    <Card key={piece.id} className="hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex justify-between items-start">
                                <span>{piece.title}</span>
                                <span className={`text-xs px-2 py-1 rounded-full ${piece.status === 'polished' ? 'bg-green-100 text-green-800' :
                                    piece.status === 'mastered' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-blue-100 text-blue-800'
                                    }`}>
                                    {piece.status}
                                </span>
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">{piece.composer}</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                    <span>Progreso</span>
                                    <div className="text-right">
                                        <span className="font-bold">{piece.progress}%</span>
                                        {piece.measureCount > 0 && (
                                            <span className="text-muted-foreground ml-1">
                                                ({piece.currentMeasure || 0}/{piece.measureCount} compases)
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ProgressBar value={piece.progress} />
                            </div>

                            <Button
                                onClick={() => setSelectedPieceId(piece.id)}
                                className="w-full gap-2"
                            >

                                <PlayCircle size={16} />
                                Practicar
                            </Button>
                        </CardContent>
                    </Card>
                ))}
                {user.repertoire.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border-dashed border-2">
                        <p>No tienes obras asignadas.</p>
                        <p className="text-sm">Pide a tu maestro que te asigne una nueva obra.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
