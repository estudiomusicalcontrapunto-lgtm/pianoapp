
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { ChevronRight, PlusCircle, X, Trash2, FileText, Award } from 'lucide-react';
import { ProgressBar } from '../components/ui/ProgressBar';
import { CycleProgress } from '../components/CycleProgress';
import { LevelRequestModal, LevelRequestSummary } from '../components/LevelRequests';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { LEVEL_REQUEST_LABELS, PAYMENT_LABELS, levelLabel, isOpenRequest } from '../lib/labels';
import { WEEKDAYS, formatShortDay } from '../lib/time';

import { RiskMap } from '../components/RiskMap';
import { PracticeWeek, PracticeWeekMini } from '../components/PracticeWeek';

const averageProgress = (repertoire) =>
    repertoire.length ? Math.round(repertoire.reduce((sum, rep) => sum + (rep.progress || 0), 0) / repertoire.length) : 0;

// Current cycle: classes taken out of the package, one segment per class
function CycleSummary({ cycle }) {
    if (!cycle) return <p className="text-sm text-muted-foreground">Sin ciclo activo</p>;
    return (
        <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
                {cycle.summary.taken} de {cycle.summary.total} clases · {formatShortDay(cycle.startDate)} al {formatShortDay(cycle.endDate)}
            </p>
            <CycleProgress units={cycle.summary.units} total={cycle.summary.total} />
        </div>
    );
}

function RepertoireSummary({ repertoire }) {
    if (!repertoire.length) return <p className="text-sm text-muted-foreground">Sin obras asignadas</p>;
    const average = averageProgress(repertoire);
    return (
        <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
                {repertoire.length} {repertoire.length === 1 ? 'obra' : 'obras'} · {average}% de avance promedio
            </p>
            <ProgressBar value={average} className="h-2" />
        </div>
    );
}

// "Mis estudiantes": each student's cycle, repertoire and level-up requests in one place
export function TeacherStudents() {
    const { students, updateTeacherNotes, assignRepertoire, updateProgress, updateCurrentMeasure, updateRiskMap, deleteRepertoire, updateRepertoirePdf } = useApp();
    const { data, error, reload } = useApiData(
        () => Promise.all([api.getAcademyStudents(), api.getCycles({ status: 'pendiente_pago,activo' }), api.getLevelRequests()]),
        []
    );
    const [roster, cycles, levelRequests] = data || [[], [], []];
    const [requestingLevel, setRequestingLevel] = useState(false);
    const [requestError, setRequestError] = useState('');

    const [selectedStudentId, setSelectedStudentId] = useState(null);
    const [noteText, setNoteText] = useState("");
    const [editingNoteId, setEditingNoteId] = useState(null);

    // Risk Map State
    const [editingRiskRep, setEditingRiskRep] = useState(null);
    const [selectedTool, setSelectedTool] = useState('green'); // 'green', 'yellow', 'red', 'eraser'
    const [isDrawing, setIsDrawing] = useState(false);

    // PDF Edit State
    const [editingPdfRep, setEditingPdfRep] = useState(null);
    const [pdfUrlText, setPdfUrlText] = useState("");

    // Assignment Modal State
    const [isAssigning, setIsAssigning] = useState(false);
    const [newPiece, setNewPiece] = useState({ title: '', composer: '', teacherNotes: '', measureCount: '', pdfUrl: '' });

    // Roster (active students, fresh level and schedules) joined with the repertoire held in context
    const rows = roster.map(student => {
        const own = cycles.filter(c => c.studentId === student.id);
        const requests = levelRequests.filter(r => r.studentId === student.id);
        return {
            ...student,
            repertoire: students.find(s => s.id === student.id)?.repertoire || [],
            practiceWeek: students.find(s => s.id === student.id)?.practiceWeek || [],
            activeCycle: own.find(c => c.status === 'activo'),
            nextCycle: own.find(c => c.status === 'pendiente_pago'),
            requests,
            openRequest: requests.find(isOpenRequest),
        };
    });
    const activeRow = rows.find(r => r.id === selectedStudentId);
    const activeStudent = activeRow && { ...students.find(s => s.id === selectedStudentId), ...activeRow };

    const cancelRequest = async (request) => {
        if (!confirm(`¿Cancelar la solicitud de ascenso a ${levelLabel(request.toLevel)}?`)) return;
        setRequestError('');
        try {
            await api.cancelLevelRequest(request.id);
            reload();
        } catch (err) {
            setRequestError(err.message);
        }
    };

    const startEditingNote = (rep) => {
        setEditingNoteId(rep.id);
        setNoteText(rep.teacherNotes || "");
    };

    const saveNote = (studentId, repId) => {
        updateTeacherNotes(studentId, repId, noteText);
        setEditingNoteId(null);
    };

    const savePdf = () => {
        if (editingPdfRep) {
            updateRepertoirePdf(activeStudent.id, editingPdfRep.id, pdfUrlText);
            setEditingPdfRep(null);
        }
    };

    const handleAssignSubmit = (e) => {
        e.preventDefault();
        if (!newPiece.title || !newPiece.composer) return;
        assignRepertoire(activeStudent.id, {
            ...newPiece,
            measureCount: newPiece.measureCount ? parseInt(newPiece.measureCount) : 0
        });
        setIsAssigning(false);
        setNewPiece({ title: '', composer: '', teacherNotes: '', measureCount: '', pdfUrl: '' });
    };

    if (activeStudent) {
        return (
            <div className="space-y-6 relative">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => setSelectedStudentId(null)} className="pl-0 gap-2">
                        &larr; Volver
                    </Button>
                    <h2 className="text-3xl font-bold">{activeStudent.name}</h2>
                </div>

                <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-background">
                    <CardContent className="p-4 space-y-2">
                        <p className="text-sm font-semibold">Racha de estudio</p>
                        <PracticeWeek studentId={activeStudent.id} />
                    </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardContent className="p-4 space-y-3">
                            <p className="text-sm font-semibold">Mensualidad</p>
                            <CycleSummary cycle={activeStudent.activeCycle} />
                            <div className="flex flex-wrap gap-1">
                                {activeStudent.pendingMakeups > 0 && <Badge tone="warning">{activeStudent.pendingMakeups} por reponer</Badge>}
                                {(activeStudent.nextCycle || activeStudent.activeCycle) && (
                                    <StatusBadge map={PAYMENT_LABELS} value={(activeStudent.nextCycle || activeStudent.activeCycle).paymentStatus} />
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {activeStudent.fixedSchedules.length
                                    ? activeStudent.fixedSchedules.map(f => `${WEEKDAYS[f.weekday]} ${f.startTime} · ${f.roomName}`).join(', ')
                                    : 'Sin horario fijo'}
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold">Nivel</p>
                                    <p className="text-2xl font-bold text-primary">{levelLabel(activeStudent.level)}</p>
                                    {activeStudent.instrumentName && <p className="text-xs text-muted-foreground">{activeStudent.instrumentName}</p>}
                                </div>
                                {!activeStudent.openRequest && (
                                    <Button size="sm" className="gap-1" onClick={() => setRequestingLevel(true)}>
                                        <Award size={14} />Solicitar ascenso
                                    </Button>
                                )}
                            </div>
                            {activeStudent.openRequest ? (
                                <div className="rounded-md border p-3 space-y-2">
                                    <LevelRequestSummary request={activeStudent.openRequest} />
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => cancelRequest(activeStudent.openRequest)}>
                                        Cancelar solicitud
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Para subir de nivel, envía los videos de tres obras (A, B y C) o pide una muestra. La academia lo aprueba.
                                </p>
                            )}
                            {requestError && <p className="text-xs text-red-500">{requestError}</p>}
                            {activeStudent.requests.some(r => !isOpenRequest(r)) && (
                                <details className="text-sm">
                                    <summary className="cursor-pointer text-xs text-muted-foreground">Solicitudes anteriores</summary>
                                    <div className="mt-2 space-y-3">
                                        {activeStudent.requests.filter(r => !isOpenRequest(r)).map(r => (
                                            <div key={r.id} className="rounded-md bg-secondary/40 p-3"><LevelRequestSummary request={r} /></div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {requestingLevel && (
                    <LevelRequestModal
                        student={activeStudent}
                        onClose={() => setRequestingLevel(false)}
                        onSaved={() => { setRequestingLevel(false); reload(); }}
                    />
                )}

                <div className="flex items-center justify-between mt-8">
                    <h3 className="text-xl font-bold">Repertorio y observaciones</h3>
                    <Button onClick={() => setIsAssigning(true)} className="gap-2">
                        <PlusCircle size={16} /> Asignar Obra
                    </Button>
                </div>

                {/* Assignment Modal */}
                {isAssigning && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <Card className="w-full max-w-md animate-in fade-in zoom-in duration-200">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Asignar Nueva Obra</CardTitle>
                                <button onClick={() => setIsAssigning(false)} className="text-muted-foreground hover:text-foreground">
                                    <X size={20} />
                                </button>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleAssignSubmit} className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Título de la Obra</label>
                                        <input
                                            className="w-full p-2 border rounded"
                                            value={newPiece.title}
                                            onChange={e => setNewPiece({ ...newPiece, title: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Compositor</label>
                                        <input
                                            className="w-full p-2 border rounded"
                                            value={newPiece.composer}
                                            onChange={e => setNewPiece({ ...newPiece, composer: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Número de Compases</label>
                                        <input
                                            type="number"
                                            min="1"
                                            className="w-full p-2 border rounded"
                                            value={newPiece.measureCount}
                                            onChange={e => setNewPiece({ ...newPiece, measureCount: e.target.value })}
                                            placeholder="Ej: 16"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Enlace al PDF (Opcional)</label>
                                        <input
                                            type="url"
                                            className="w-full p-2 border rounded"
                                            value={newPiece.pdfUrl}
                                            onChange={e => setNewPiece({ ...newPiece, pdfUrl: e.target.value })}
                                            placeholder="https://ejemplo.com/partitura.pdf"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Observaciones Iniciales</label>
                                        <textarea
                                            className="w-full p-2 border rounded resize-none"
                                            rows={3}
                                            value={newPiece.teacherNotes}
                                            onChange={e => setNewPiece({ ...newPiece, teacherNotes: e.target.value })}
                                        />
                                    </div>
                                    <Button type="submit" className="w-full">Asignar</Button>
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* PDF Edit Modal */}
                {
                    editingPdfRep && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <Card className="w-full max-w-md animate-in fade-in zoom-in duration-200">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Editar PDF: {editingPdfRep.title}</CardTitle>
                                    <button onClick={() => setEditingPdfRep(null)} className="text-muted-foreground hover:text-foreground">
                                        <X size={20} />
                                    </button>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Enlace al PDF (URL)</label>
                                            <input
                                                type="url"
                                                className="w-full p-2 border rounded"
                                                value={pdfUrlText}
                                                onChange={e => setPdfUrlText(e.target.value)}
                                                placeholder="https://ejemplo.com/partitura.pdf"
                                            />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" onClick={() => setEditingPdfRep(null)}>Cancelar</Button>
                                            <Button onClick={savePdf}>Guardar</Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }

                {/* Risk Map Modal */}
                {
                    editingRiskRep && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <Card className="w-full max-w-2xl animate-in fade-in zoom-in duration-200 mobile-h-scroll overflow-y-auto max-h-[90vh]">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Mapa de Riesgo: {editingRiskRep.title}</CardTitle>
                                    <button onClick={() => setEditingRiskRep(null)} className="text-muted-foreground hover:text-foreground">
                                        <X size={20} />
                                    </button>
                                </CardHeader>
                                <CardContent className="space-y-4"
                                    onMouseUp={() => setIsDrawing(false)}
                                    onMouseLeave={() => setIsDrawing(false)}
                                >
                                    <p className="text-sm text-muted-foreground">
                                        Selecciona un color y arrastra sobre los compases para marcar:
                                    </p>

                                    {/* Toolbar */}
                                    <div className="flex gap-2 justify-center mb-2">
                                        <Button
                                            size="sm"
                                            variant={selectedTool === 'green' ? 'default' : 'outline'}
                                            onClick={() => setSelectedTool('green')}
                                            className={selectedTool === 'green' ? 'bg-green-600 hover:bg-green-700' : 'text-green-600 border-green-200'}
                                        >
                                            <div className="w-3 h-3 bg-green-500 rounded-sm mr-2"></div> Bien
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={selectedTool === 'yellow' ? 'default' : 'outline'}
                                            onClick={() => setSelectedTool('yellow')}
                                            className={selectedTool === 'yellow' ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : 'text-yellow-600 border-yellow-200'}
                                        >
                                            <div className="w-3 h-3 bg-yellow-400 rounded-sm mr-2"></div> Regular
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={selectedTool === 'red' ? 'default' : 'outline'}
                                            onClick={() => setSelectedTool('red')}
                                            className={selectedTool === 'red' ? 'bg-red-600 hover:bg-red-700' : 'text-red-600 border-red-200'}
                                        >
                                            <div className="w-3 h-3 bg-red-500 rounded-sm mr-2"></div> Crítico
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={selectedTool === 'eraser' ? 'secondary' : 'outline'}
                                            onClick={() => setSelectedTool('eraser')}
                                        >
                                            <div className="w-3 h-3 border border-dashed border-gray-500 rounded-sm mr-2"></div> Borrar
                                        </Button>
                                    </div>

                                    <div className="p-4 bg-secondary/20 rounded-lg select-none">
                                        <RiskMap
                                            totalMeasures={editingRiskRep.measureCount || 0}
                                            riskData={editingRiskRep.riskMap || {}}
                                            onCellClick={(measure, isStart, isEnter) => {
                                                // Handling Drag Logic
                                                if (isStart) setIsDrawing(true);
                                                else if (isEnter && !isDrawing) return;

                                                // Apply Color
                                                const currentMap = editingRiskRep.riskMap || {};
                                                const newMap = { ...currentMap };

                                                if (selectedTool === 'eraser') {
                                                    delete newMap[measure];
                                                } else {
                                                    newMap[measure] = selectedTool;
                                                }

                                                // Update State & Persist
                                                setEditingRiskRep(prev => ({ ...prev, riskMap: newMap }));
                                                updateRiskMap(activeStudent.id, editingRiskRep.id, newMap);
                                            }}
                                        />
                                        {(!editingRiskRep.measureCount || editingRiskRep.measureCount === 0) && (
                                            <p className="text-center text-muted-foreground italic">Esta obra no tiene asignado un número de compases.</p>
                                        )}
                                    </div>
                                    <div className="flex justify-end">
                                        <Button onClick={() => setEditingRiskRep(null)}>Listo</Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )
                }

                <div className="grid gap-4">
                    {activeStudent.repertoire.map(rep => (
                        <Card key={rep.id} className="overflow-hidden">
                            <div className="flex flex-col md:flex-row">
                                <div className="p-6 flex-1">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h4 className="text-lg font-bold">{rep.title}</h4>
                                            <p className="text-sm text-muted-foreground">{rep.composer}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className={`text-xs px-2 py-1 rounded-full ${rep.status === 'polished' ? 'bg-green-100 text-green-800' :
                                                rep.status === 'mastered' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-blue-100 text-blue-800'
                                                }`}>
                                                {rep.status}
                                            </span>
                                            {rep.measureCount > 0 && (
                                                <Button
                                                    variant="outline"
                                                    size="xs"
                                                    className="h-7 text-xs gap-1"
                                                    onClick={() => setEditingRiskRep(rep)}
                                                >
                                                    Mapa de Riesgo
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="xs"
                                                className={`h-7 text-xs gap-1 ${rep.pdfUrl ? 'text-blue-600 border-blue-200' : ''}`}
                                                onClick={() => {
                                                    setEditingPdfRep(rep);
                                                    setPdfUrlText(rep.pdfUrl || "");
                                                }}
                                            >
                                                <FileText size={12} />
                                                {rep.pdfUrl ? 'Editar PDF' : 'Subir PDF'}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                                title="Eliminar obra"
                                                onClick={() => {
                                                    if (confirm(`¿Estás seguro de que quieres eliminar la obra "${rep.title}"?`)) {
                                                        deleteRepertoire(activeStudent.id, rep.id);
                                                    }
                                                }}
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-1 mt-4">
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>Progreso</span>
                                            <span className="font-bold text-primary">{rep.progress}%</span>
                                        </div>

                                        {rep.measureCount > 0 ? (
                                            <div className="flex items-center gap-2 mt-2">
                                                <label className="text-sm text-muted-foreground whitespace-nowrap">Compás:</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={rep.measureCount}
                                                    value={rep.currentMeasure || 0}
                                                    onChange={(e) => updateCurrentMeasure(activeStudent.id, rep.id, Number(e.target.value))}
                                                    className="w-20 p-1 text-center border rounded text-sm font-bold"
                                                />
                                                <span className="text-sm text-muted-foreground">/ {rep.measureCount}</span>
                                                <div className="flex-1 ml-2">
                                                    <ProgressBar value={rep.progress} className="h-2" />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={rep.progress}
                                                    onChange={(e) => updateProgress(activeStudent.id, rep.id, Number(e.target.value))}
                                                    className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-muted/30 p-6 md:w-1/3 border-t md:border-t-0 md:border-l space-y-4">
                                    <div>
                                        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Feedback del Maestro</h5>
                                        {editingNoteId === rep.id ? (
                                            <div className="space-y-2">
                                                <textarea
                                                    className="w-full p-2 text-sm border rounded bg-background"
                                                    rows={3}
                                                    value={noteText}
                                                    onChange={(e) => setNoteText(e.target.value)}
                                                />
                                                <div className="flex gap-2 justify-end">
                                                    <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)}>Cancelar</Button>
                                                    <Button size="sm" onClick={() => saveNote(activeStudent.id, rep.id)}>Guardar</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                className="group cursor-pointer hover:bg-background p-2 -m-2 rounded transition-colors border border-transparent hover:border-border"
                                                onClick={() => startEditingNote(rep)}
                                            >
                                                <p className="text-sm italic text-muted-foreground">
                                                    {rep.teacherNotes || "Haz clic para agregar una observación..."}
                                                </p>
                                            </div>
                                        )}
                                    </div>


                                </div>
                            </div>
                        </Card>
                    ))}
                    {activeStudent.repertoire.length === 0 && <p className="text-muted-foreground text-center py-8">No hay obras asignadas.</p>}
                </div>
            </div >
        );
    }


    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Mis estudiantes</h2>
                <p className="text-muted-foreground">Avance de la mensualidad y del repertorio. Abre un estudiante para editar su repertorio o solicitar su ascenso.</p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid gap-3">
                {rows.map(student => {
                    const payment = student.nextCycle || student.activeCycle;
                    return (
                        <Card
                            key={student.id}
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer hover:border-primary transition-colors group"
                            onClick={() => setSelectedStudentId(student.id)}
                            onKeyDown={(e) => e.key === 'Enter' && setSelectedStudentId(student.id)}
                        >
                            <CardContent className="p-4 grid gap-4 md:grid-cols-[13rem_1fr_1fr_auto] md:items-center">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-10 w-10 shrink-0 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                                        {student.name.charAt(0)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold truncate">{student.name}</p>
                                        <p className="text-xs text-muted-foreground">{student.instrumentName ? `${student.instrumentName} · ` : ''}{levelLabel(student.level)}</p>
                                        <div className="mt-1"><PracticeWeekMini dates={student.practiceWeek} /></div>
                                    </div>
                                </div>
                                <CycleSummary cycle={student.activeCycle} />
                                <RepertoireSummary repertoire={student.repertoire} />
                                <div className="flex flex-wrap items-center gap-1 md:justify-end">
                                    {student.pendingMakeups > 0 && <Badge tone="warning">{student.pendingMakeups} por reponer</Badge>}
                                    {payment && <StatusBadge map={PAYMENT_LABELS} value={payment.paymentStatus} />}
                                    {student.openRequest && (
                                        <Badge tone={LEVEL_REQUEST_LABELS[student.openRequest.status].tone} className="gap-1">
                                            <Award size={12} />Ascenso a {levelLabel(student.openRequest.toLevel)}
                                        </Badge>
                                    )}
                                    <ChevronRight size={18} className="text-muted-foreground group-hover:text-primary hidden md:block" />
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
                {data && rows.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tienes estudiantes asignados. La academia te los asigna.</p>
                )}
            </div>
        </div>
    );
}
