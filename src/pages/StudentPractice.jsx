
import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ArrowLeft, Repeat, Save, CheckCircle2, RotateCcw, Plus, Minus, FileText, ExternalLink, Trash2, Edit2 } from 'lucide-react';


import { RiskMap } from '../components/RiskMap';

export function StudentPractice({ piece, onBack }) {
    const { user, incrementRepetitions, updateStudentNotes } = useApp();
    const [notesList, setNotesList] = useState([]);
    const [newNote, setNewNote] = useState("");
    const [editingNoteId, setEditingNoteId] = useState(null);
    const [editingText, setEditingText] = useState("");
    const [sessionReps, setSessionReps] = useState(0);
    const [saved, setSaved] = useState(false);


    // Sync local state if piece changes
    useEffect(() => {
        let initialNotes = [];
        if (piece.studentNotes) {
            try {
                const parsed = JSON.parse(piece.studentNotes);
                if (Array.isArray(parsed)) {
                    initialNotes = parsed;
                } else {
                    throw new Error("Not an array");
                }
            } catch (e) {
                initialNotes = [{
                    id: Date.now().toString(),
                    text: piece.studentNotes,
                    date: new Date().toISOString()
                }];
            }
        }
        setNotesList(initialNotes);
        setSessionReps(0);
        setEditingNoteId(null);
        setNewNote("");
    }, [piece.id]);

    const saveNotesToBackend = (updatedNotes) => {
        if (!user) return;
        updateStudentNotes(user.id, piece.id, JSON.stringify(updatedNotes));
    };

    const handleAddNote = () => {
        if (!newNote.trim()) return;
        const note = {
            id: Date.now().toString(),
            text: newNote,
            date: new Date().toISOString()
        };
        const updatedList = [note, ...notesList];
        setNotesList(updatedList);
        setNewNote("");
        saveNotesToBackend(updatedList);
    };

    const handleDeleteNote = (id) => {
        const updatedList = notesList.filter(n => n.id !== id);
        setNotesList(updatedList);
        saveNotesToBackend(updatedList);
    };

    const startEditing = (note) => {
        setEditingNoteId(note.id);
        setEditingText(note.text);
    };

    const handleUpdateNote = (id) => {
        if (!editingText.trim()) return;
        const updatedList = notesList.map(n => 
            n.id === id ? { ...n, text: editingText } : n
        );
        setNotesList(updatedList);
        setEditingNoteId(null);
        setEditingText("");
        saveNotesToBackend(updatedList);
    };

    const cancelEditing = () => {
        setEditingNoteId(null);
        setEditingText("");
    };

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleRepetition = (val = 1) => {
        if (!user) return;

        // Prevent negative totals if needed, though usually repetitions just add up.
        // If val is negative, we are "undoing" a rep.

        incrementRepetitions(user.id, piece.id, val);
        setSessionReps(p => Math.max(0, p + val)); // Prevent negative session reps
    };

    const handleResetSession = () => {
        setSessionReps(0);
    };


    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <Button variant="ghost" onClick={onBack} className="gap-2 mb-4 pl-0">
                <ArrowLeft size={16} /> Volver al Repertorio
            </Button>

            <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold">{piece.title}</h1>
                    <p className="text-xl text-muted-foreground">{piece.composer}</p>
                </div>
                <div className="flex items-center gap-4">
                    {piece.pdfUrl && (
                        <a
                            href={piece.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-200 transition-colors font-medium text-sm"
                        >
                            <FileText size={18} />
                            Ver Partitura
                            <ExternalLink size={14} />
                        </a>
                    )}
                    <div className="flex items-center gap-2 bg-secondary/50 px-4 py-2 rounded-lg">
                        <span className="text-sm font-medium text-muted-foreground">Repeticiones Totales:</span>
                        <span className="text-2xl font-bold">{piece.repetitions || 0}</span>
                    </div>
                </div>
            </div>



            <div className="grid gap-6 md:grid-cols-2">
                {/* Practice Tools */}
                <Card className="h-full">
                    <CardHeader>
                        <CardTitle>Herramientas de Práctica</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        <div className="space-y-4">
                            <label className="text-sm font-medium flex justify-between items-center">
                                <span>Contador de Repeticiones (Sesión)</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleResetSession}
                                    className="h-6 w-6 p-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                                    title="Reiniciar contador de sesión"
                                >
                                    <RotateCcw size={14} />
                                </Button>
                            </label>
                            <div className="flex items-center gap-4">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-16 rounded-full shrink-0"
                                    onClick={() => handleRepetition(-1)}
                                    disabled={sessionReps <= 0}
                                >
                                    <Minus size={24} />
                                </Button>

                                <div className="flex-1 text-center bg-background border rounded-lg h-24 flex items-center justify-center text-4xl font-bold">
                                    {sessionReps}
                                </div>

                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-16 rounded-full shrink-0"
                                    onClick={() => handleRepetition(1)}
                                >
                                    <Plus size={24} />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-sm font-medium">Progreso (% Dominado)</label>
                            <div className="flex items-center gap-4">
                                <ProgressBar value={piece.progress} className="h-4 flex-1" />
                                <span className="w-12 text-right font-bold">{piece.progress}%</span>
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                                El progreso es actualizado por tu maestro.
                            </p>
                        </div>
                    </CardContent>
                </Card>


                {/* Journal and Notes */}
                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>Diario de Práctica / Notas</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col gap-4">
                        {piece.teacherNotes && (
                            <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border border-blue-100 dark:border-blue-900">
                                <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-1 text-sm">Nota del Maestro:</h4>
                                <p className="text-sm text-blue-900 dark:text-blue-100 italic">"{piece.teacherNotes}"</p>
                            </div>
                        )}

                        <div className="flex-1 flex flex-col gap-4 min-h-[300px]">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Tus Observaciones</label>
                                <div className="space-y-2">
                                    <textarea
                                        className="w-full h-20 p-3 rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                                        placeholder="Registra pasajes practicados, dificultades..."
                                        value={newNote}
                                        onChange={(e) => setNewNote(e.target.value)}
                                    />
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" onClick={handleAddNote} className="gap-2">
                                            <Plus size={16} />
                                            Añadir Nota
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                                {notesList.map(note => (
                                    <div key={note.id} className="bg-muted/30 border rounded-lg p-3 group">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] text-muted-foreground font-medium">
                                                {new Date(note.date).toLocaleDateString()} {new Date(note.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {editingNoteId !== note.id && (
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditing(note)}>
                                                        <Edit2 size={12} />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteNote(note.id)}>
                                                        <Trash2 size={12} />
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        {editingNoteId === note.id ? (
                                            <div className="space-y-2 mt-2">
                                                <textarea
                                                    className="w-full h-20 p-2 rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                                                    value={editingText}
                                                    onChange={(e) => setEditingText(e.target.value)}
                                                    autoFocus
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" onClick={cancelEditing}>Cancelar</Button>
                                                    <Button size="sm" onClick={() => handleUpdateNote(note.id)} className="gap-2">
                                                        <Save size={14} /> Guardar
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm whitespace-pre-wrap">{note.text}</p>
                                        )}
                                    </div>
                                ))}
                                {notesList.length === 0 && (
                                    <div className="text-center text-muted-foreground text-sm py-8 italic border-2 border-dashed rounded-lg">
                                        Aún no hay observaciones para esta obra.
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Risk Map Section - Only if measures exist */}
            {piece.measureCount > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">Mapa de Riesgo</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <RiskMap
                            totalMeasures={piece.measureCount}
                            riskData={piece.riskMap}
                            readOnly={true}
                        />
                        <div className="flex gap-4 mt-4 text-xs text-muted-foreground justify-center">
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded-sm"></div> Dominado</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-400 rounded-sm"></div> En Progreso</div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Difícil</div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end">
                <Button size="lg" onClick={handleSave} className="gap-2 min-w-[150px]">
                    {saved ? <CheckCircle2 size={18} /> : <Save size={18} />}
                    {saved ? "Guardado" : "Guardar Sesión"}
                </Button>
            </div>
        </div>
    );
}
