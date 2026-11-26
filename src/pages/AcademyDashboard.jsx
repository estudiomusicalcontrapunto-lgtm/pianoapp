import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { School, Users, ChevronRight, PlusCircle, X, KeyRound, Trash2, Pencil } from 'lucide-react';
import { ProgressBar } from '../components/ui/ProgressBar';
import { RiskMap } from '../components/RiskMap';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { levelLabel } from '../lib/labels';
import { formatCOP } from '../lib/utils';

// Checkboxes for the instruments a teacher teaches
function InstrumentPicker({ instruments, value, onChange }) {
    const toggle = (id) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
            {instruments.map(i => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={value.includes(i.id)} onChange={() => toggle(i.id)} />
                    {i.name}
                </label>
            ))}
            {instruments.length === 0 && <p className="text-sm text-muted-foreground">Primero crea instrumentos en Grados.</p>}
        </div>
    );
}

// A teacher's city. Prices and payment text are never per teacher: the academy collects, per city.
function TeacherCityCard({ teacher, cities, onSaved }) {
    const [cityId, setCityId] = useState(teacher.cityId || '');
    const [message, setMessage] = useState(null);
    const activeCities = cities.filter(c => c.active);
    const changed = cityId !== (teacher.cityId || '');

    const save = async () => {
        setMessage(null);
        try {
            await api.updateTeacherBilling(teacher.id, { cityId: cityId || undefined });
            setMessage({ type: 'ok', text: 'Guardado.' });
            onSaved();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Ciudad</CardTitle>
                {teacher.prices && (
                    <p className="text-sm text-muted-foreground">
                        Sus estudiantes le pagan a la academia los valores de {teacher.cityName}: mensualidad {formatCOP(teacher.prices.monthlyFee)} y clase suelta {formatCOP(teacher.prices.singleClassFee)}.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="teacher-city">Ciudad</label>
                    <select id="teacher-city" className="w-full p-2 min-h-11 border rounded-md bg-background" value={cityId} onChange={e => setCityId(e.target.value)}>
                        {activeCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                {message && <p className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>{message.text}</p>}
                <Button onClick={save} disabled={!changed}>Guardar</Button>
            </CardContent>
        </Card>
    );
}

export function AcademyDashboard() {
    const { teachers, createTeacher, deleteTeacher, refreshTeachers } = useApp();
    const { data: instrumentData } = useApiData(() => api.getInstruments(), []);
    const instruments = instrumentData || [];
    const { data: cityData } = useApiData(() => api.getCities(), []);
    const cities = cityData || [];
    const activeCities = cities.filter(c => c.active);
    const severalCities = activeCities.length > 1;
    const [selectedTeacherId, setSelectedTeacherId] = useState(null);
    const [selectedStudentId, setSelectedStudentId] = useState(null);
    const [isCreatingTeacher, setIsCreatingTeacher] = useState(false);
    const [newTeacher, setNewTeacher] = useState({ name: '', email: '', password: '', instrumentIds: [] });
    const [editingInstruments, setEditingInstruments] = useState(null);
    const [error, setError] = useState('');
    const [viewingRiskRep, setViewingRiskRep] = useState(null);

    const activeTeacher = teachers.find(t => t.id === selectedTeacherId);
    const activeStudent = activeTeacher?.students?.find(s => s.id === selectedStudentId);

    const handleCreateTeacher = async (e) => {
        e.preventDefault();
        setError('');
        if (!newTeacher.name || !newTeacher.email || !newTeacher.password) {
            setError('Todos los campos son obligatorios');
            return;
        }
        if (!newTeacher.instrumentIds.length) {
            setError('Elige al menos un instrumento que enseñe.');
            return;
        }
        if (severalCities && !newTeacher.cityId) {
            setError('Elige la ciudad donde enseña.');
            return;
        }

        const res = await createTeacher(newTeacher);
        if (res.success) {
            setIsCreatingTeacher(false);
            setNewTeacher({ name: '', email: '', password: '', instrumentIds: [] });
            refreshTeachers();
        } else {
            setError(res.message);
        }
    };

    const handleSaveInstruments = async () => {
        setError('');
        try {
            await api.setTeacherInstruments(activeTeacher.id, editingInstruments);
            setEditingInstruments(null);
            refreshTeachers();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteTeacher = async () => {
        setError('');
        if (!confirm(`¿Eliminar a ${activeTeacher.name}? Ya no podrá entrar y sus franjas y salones quedan libres.`)) return;
        const res = await deleteTeacher(activeTeacher.id);
        if (res.success) setSelectedTeacherId(null);
        else setError(res.message);
    };

    // 3rd Level Drill Down: Student Detail View
    if (activeStudent) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => setSelectedStudentId(null)} className="pl-0 gap-2">
                        &larr; Volver al Maestro
                    </Button>
                    <h2 className="text-3xl font-bold">{activeStudent.name} <span className="text-muted-foreground text-xl">(Solo Lectura)</span></h2>
                </div>

                <div className="flex flex-wrap gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Nivel</p>
                        <p className="font-bold text-primary">{levelLabel(activeStudent.level)}</p>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Racha de Práctica</p>
                        <p className="font-medium">{activeStudent.streak} días</p>
                    </div>
                </div>

                <h3 className="text-xl font-bold mt-8">Repertorio</h3>
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
                                                    onClick={() => setViewingRiskRep(rep)}
                                                >
                                                    Ver Mapa de Riesgo
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-1 mt-4">
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>Progreso</span>
                                            <span className="font-bold text-primary">{rep.progress}%</span>
                                        </div>
                                        <ProgressBar value={rep.progress} className="h-2" />
                                    </div>
                                </div>
                                <div className="bg-muted/30 p-6 md:w-1/3 border-t md:border-t-0 md:border-l space-y-4">
                                    <div>
                                        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Feedback del Maestro</h5>
                                        <p className="text-sm italic text-muted-foreground">
                                            {rep.teacherNotes || "Sin observaciones."}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    ))}
                    {activeStudent.repertoire.length === 0 && <p className="text-muted-foreground text-center py-8">No hay obras asignadas.</p>}
                </div>

                {viewingRiskRep && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <Card className="w-full max-w-2xl animate-in fade-in zoom-in duration-200 mobile-h-scroll overflow-y-auto max-h-[90vh]">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>Mapa de Riesgo (Lectura): {viewingRiskRep.title}</CardTitle>
                                <button onClick={() => setViewingRiskRep(null)} className="text-muted-foreground hover:text-foreground">
                                    <X size={20} />
                                </button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="p-4 bg-secondary/20 rounded-lg pointer-events-none">
                                    <RiskMap
                                        totalMeasures={viewingRiskRep.measureCount || 0}
                                        riskData={viewingRiskRep.riskMap || {}}
                                        onCellClick={() => {}}
                                    />
                                    {(!viewingRiskRep.measureCount || viewingRiskRep.measureCount === 0) && (
                                        <p className="text-center text-muted-foreground italic">Esta obra no tiene asignado un número de compases.</p>
                                    )}
                                </div>
                                <div className="flex justify-end">
                                    <Button onClick={() => setViewingRiskRep(null)}>Cerrar</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        );
    }

    // 2nd Level Drill Down: Teacher Detail View (List of Students)
    if (activeTeacher) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => setSelectedTeacherId(null)} className="pl-0 gap-2">
                        &larr; Volver
                    </Button>
                    <h2 className="text-3xl font-bold">Maestro: {activeTeacher.name}</h2>
                </div>

                <Card className="bg-primary/10 border-primary/20">
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Email del Maestro</p>
                            <p className="font-medium">{activeTeacher.email}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Total Alumnos</p>
                            <p className="font-bold text-xl">{activeTeacher.students?.length || 0}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Instrumentos</p>
                            <div className="flex items-center gap-1">
                                <p className="font-medium">{activeTeacher.instrumentNames?.join(', ') || 'Sin definir'}</p>
                                <Button variant="ghost" size="icon" aria-label="Editar instrumentos" onClick={() => setEditingInstruments(activeTeacher.instrumentIds || [])}>
                                    <Pencil size={14} />
                                </Button>
                            </div>
                        </div>
                        <Button variant="outline" className="gap-2 text-red-600" onClick={handleDeleteTeacher}>
                            <Trash2 size={16} />
                            Eliminar profesor
                        </Button>
                    </CardContent>
                    {editingInstruments && (
                        <CardContent className="border-t p-4 space-y-3">
                            <p className="text-sm font-medium">Instrumentos que enseña {activeTeacher.name}</p>
                            <InstrumentPicker instruments={instruments} value={editingInstruments} onChange={setEditingInstruments} />
                            <div className="flex gap-2">
                                <Button size="sm" onClick={handleSaveInstruments} disabled={!editingInstruments.length}>Guardar</Button>
                                <Button size="sm" variant="outline" onClick={() => { setEditingInstruments(null); setError(''); }}>Cancelar</Button>
                            </div>
                        </CardContent>
                    )}
                </Card>
                {error && <p className="text-sm text-red-500">{error}</p>}

                <TeacherCityCard key={activeTeacher.id} teacher={activeTeacher} cities={cities} onSaved={refreshTeachers} />

                <h3 className="text-xl font-bold mt-8">Alumnos del Maestro</h3>
                
                {!activeTeacher.students || activeTeacher.students.length === 0 ? (
                    <Card className="text-center py-12">
                        <CardContent>
                            <p className="text-muted-foreground">Este maestro aún no tiene alumnos registrados.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {activeTeacher.students.map(student => (
                            <Card
                                key={student.id}
                                className="cursor-pointer hover:border-primary transition-colors group relative overflow-hidden"
                                onClick={() => setSelectedStudentId(student.id)}
                            >
                                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ChevronRight className="text-primary" />
                                </div>
                                <CardHeader className="flex flex-row items-center gap-4">
                                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary group-hover:bg-primary group-hover:text-white transition-colors text-xl">
                                        {student.name.charAt(0)}
                                    </div>
                                    <div>
                                        <CardTitle className="text-lg">{student.name}</CardTitle>
                                        <p className="text-sm text-muted-foreground">{levelLabel(student.level)}</p>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-muted-foreground">Racha</p>
                                            <p className="font-bold">{student.streak} días</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">Repertorio</p>
                                            <p className="font-bold">{student.repertoire?.length || 0} obras</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // 1st Level: List of all Teachers
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Panel de Academia</h2>
                    <p className="text-muted-foreground mt-1">Gestiona los perfiles de maestros.</p>
                </div>
                <Button onClick={() => setIsCreatingTeacher(true)} className="gap-2">
                    <PlusCircle size={16} /> Crear Maestro
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Maestros</CardTitle>
                        <School className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{teachers.length}</div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Alumnos (Global)</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {teachers.reduce((acc, t) => acc + (t.students?.length || 0), 0)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-8">
                {teachers.map(teacher => (
                    <Card
                        key={teacher.id}
                        className="cursor-pointer hover:border-primary transition-colors group relative overflow-hidden"
                        onClick={() => setSelectedTeacherId(teacher.id)}
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight className="text-primary" />
                        </div>
                        <CardHeader className="flex flex-row items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center font-bold text-primary group-hover:bg-primary group-hover:text-white transition-colors text-xl">
                                {teacher.name.charAt(0)}
                            </div>
                            <div>
                                <CardTitle className="text-lg">{teacher.name}</CardTitle>
                                <p className="text-sm text-muted-foreground">{teacher.email}</p>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-2">
                                {teacher.instrumentNames?.join(', ') || 'Instrumentos sin definir'}
                                {severalCities && teacher.cityName && ` · ${teacher.cityName}`}
                            </p>
                            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                                {teacher.students?.length || 0} Alumnos
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {teachers.length === 0 && (
                <Card className="text-center py-12 mt-4">
                    <CardContent>
                        <p className="text-muted-foreground mb-4">No hay maestros registrados en la academia.</p>
                        <Button onClick={() => setIsCreatingTeacher(true)}>
                            Crear el primer maestro
                        </Button>
                    </CardContent>
                </Card>
            )}

            {isCreatingTeacher && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-md animate-in fade-in zoom-in duration-200">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Crear Perfil de Maestro</CardTitle>
                            <button onClick={() => setIsCreatingTeacher(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleCreateTeacher} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Nombre del Maestro</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded"
                                        value={newTeacher.name}
                                        onChange={e => setNewTeacher({ ...newTeacher, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Correo Electrónico</label>
                                    <input
                                        type="email"
                                        className="w-full p-2 border rounded"
                                        value={newTeacher.email}
                                        onChange={e => setNewTeacher({ ...newTeacher, email: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Contraseña Temporal</label>
                                    <div className="relative">
                                        <KeyRound size={16} className="absolute left-3 top-3 text-muted-foreground" />
                                        <input
                                            type="password"
                                            className="w-full p-2 pl-9 border rounded"
                                            value={newTeacher.password}
                                            onChange={e => setNewTeacher({ ...newTeacher, password: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                {severalCities && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium" htmlFor="new-teacher-city">Ciudad</label>
                                        <select
                                            id="new-teacher-city"
                                            className="w-full p-2 min-h-11 border rounded bg-background"
                                            value={newTeacher.cityId || ''}
                                            onChange={e => setNewTeacher({ ...newTeacher, cityId: e.target.value })}
                                        >
                                            <option value="">Elige la ciudad</option>
                                            {activeCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Instrumentos que enseña</label>
                                    <InstrumentPicker
                                        instruments={instruments}
                                        value={newTeacher.instrumentIds}
                                        onChange={instrumentIds => setNewTeacher({ ...newTeacher, instrumentIds })}
                                    />
                                </div>

                                {error && <p className="text-sm text-red-500">{error}</p>}

                                <Button type="submit" className="w-full">
                                    Crear Maestro
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
