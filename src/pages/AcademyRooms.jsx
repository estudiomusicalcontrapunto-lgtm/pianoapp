import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, DoorOpen, Plus, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, inputClass } from '../lib/utils';
import { addDays, capitalize, formatDay, mondayOf, today } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal, Field } from '../components/ui/Modal';
import { WeekCalendar, CalendarLegend } from '../components/WeekCalendar';

function RoomModal({ room, teachers: allTeachers, cities, onClose, onSaved, onDeleted }) {
    const activeCities = cities.filter(c => c.active);
    const [name, setName] = useState(room?.name || '');
    const [capacity, setCapacity] = useState(room?.capacity || 1);
    const [active, setActive] = useState(room?.active ?? true);
    const [cityId, setCityId] = useState(room?.cityId || (activeCities.length === 1 ? activeCities[0].id : ''));
    const [teacherIds, setTeacherIds] = useState(room?.teachers?.map(t => t.id) || []);
    const [error, setError] = useState('');
    // Only teachers of the room's city can use it
    const teachers = allTeachers.filter(t => !cityId || !t.cityId || t.cityId === cityId);

    const toggleTeacher = (id) => setTeacherIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!room && !cityId) {
            setError('Elige la ciudad del salón.');
            return;
        }
        try {
            const saved = room
                ? await api.updateRoom(room.id, { name, capacity: Number(capacity), active })
                : await api.createRoom({ name, capacity: Number(capacity), cityId });
            await api.setRoomTeachers(saved.id, teacherIds.filter(id => teachers.some(t => t.id === id)));
            onSaved(saved.id);
        } catch (err) {
            setError(err.message);
        }
    };

    // Only a room that was never used; the server says why otherwise
    const remove = async () => {
        if (!confirm(`¿Eliminar ${room.name}? Solo se puede si nunca ha tenido clases, horarios ni franjas.`)) return;
        setError('');
        try {
            await api.deleteRoom(room.id);
            onDeleted();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title={room ? `Editar ${room.name}` : 'Nuevo salón'} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Nombre"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} required /></Field>
                <Field label="Capacidad (personas)"><input type="number" inputMode="numeric" min={1} className={inputClass} value={capacity} onChange={e => setCapacity(e.target.value)} /></Field>
                {!room && activeCities.length > 1 && (
                    <Field label="Ciudad">
                        <select className={inputClass} value={cityId} onChange={e => setCityId(e.target.value)}>
                            <option value="">Elige la ciudad</option>
                            {activeCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </Field>
                )}
                <Field group label="Profesores que pueden usarlo" hint="Un salón puede estar asignado a varios profesores.">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {teachers.map(t => (
                            <label key={t.id} className="flex items-center gap-2 text-sm rounded-md border p-2 cursor-pointer hover:bg-accent">
                                <input type="checkbox" checked={teacherIds.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                                {t.name}
                            </label>
                        ))}
                        {teachers.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay profesores.</p>}
                    </div>
                </Field>
                {room && (
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                        Salón activo
                    </label>
                )}
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-between gap-2">
                    {room ? <Button type="button" variant="ghost" className="text-red-600" onClick={remove}>Eliminar</Button> : <span />}
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button type="submit">Guardar</Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}

export function AcademyRooms() {
    const { teachers } = useApp();
    const { data: cityData } = useApiData(() => api.getCities(), []);
    const cities = cityData || [];
    const severalCities = cities.filter(c => c.active).length > 1;
    const { data: roomsData, error: roomsError, reload: reloadRooms } = useApiData(() => api.getRooms(), []);
    const rooms = roomsData || [];
    const [chosenId, setChosenId] = useState(null);
    const selectedId = chosenId || rooms[0]?.id || null;
    const [weekDate, setWeekDate] = useState(() => mondayOf(today()));
    const { data: week, error: weekError, reload: reloadWeek } = useApiData(
        () => (selectedId ? api.getRoomWeek(selectedId, weekDate) : Promise.resolve(null)),
        [selectedId, weekDate]
    );
    const [modalRoom, setModalRoom] = useState(undefined);
    const error = roomsError || weekError;

    const selected = rooms.find(r => r.id === selectedId);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Salones</h2>
                    <p className="text-muted-foreground">Asignación de salones a profesores y ocupación semanal.</p>
                </div>
                <Button onClick={() => setModalRoom(null)} className="gap-2">
                    <Plus size={16} />
                    Nuevo salón
                </Button>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {rooms.map(room => (
                    <Card
                        key={room.id}
                        className={cn("cursor-pointer transition-colors hover:border-primary/50", room.id === selectedId && "border-primary ring-1 ring-primary")}
                        onClick={() => setChosenId(room.id)}
                    >
                        <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="font-semibold flex items-center gap-2"><DoorOpen size={16} className="text-primary" />{room.name}</p>
                                {!room.active && <Badge>Inactivo</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Users size={12} />
                                {room.teachers.length ? room.teachers.map(t => t.name).join(', ') : 'Sin profesores asignados'}
                            </p>
                            {severalCities && room.cityName && <p className="text-xs text-muted-foreground">{room.cityName}</p>}
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={(e) => { e.stopPropagation(); setModalRoom(room); }}
                            >
                                Editar y asignar
                            </Button>
                        </CardContent>
                    </Card>
                ))}
                {rooms.length === 0 && <p className="text-sm text-muted-foreground">Crea el primer salón.</p>}
            </div>

            {selected && week && (
                <Card>
                    <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-3 space-y-0">
                        <div>
                            <CardTitle className="text-lg">{selected.name}: semana del {formatDay(week.weekStart)}</CardTitle>
                            <p className="text-sm text-muted-foreground">Todos los profesores que usan este salón.</p>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setWeekDate(addDays(weekDate, -7))}><ChevronLeft size={16} /></Button>
                            <Button variant="outline" size="sm" onClick={() => setWeekDate(mondayOf(today()))}>Hoy</Button>
                            <Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={() => setWeekDate(addDays(weekDate, 7))}><ChevronRight size={16} /></Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <CalendarLegend kinds={['clase', 'reposicion', 'cancelada', 'horario_fijo', 'franja_reposicion', 'cupo_apartado']} />
                        <WeekCalendar days={week.days} hours={week.hours} blocks={week.blocks} closures={week.closures} showTeacher />
                        {week.closures.map(c => (
                            <p key={c.date} className="text-xs text-red-600">{capitalize(formatDay(c.date))}: {c.reason}</p>
                        ))}
                    </CardContent>
                </Card>
            )}

            {modalRoom !== undefined && (
                <RoomModal
                    room={modalRoom}
                    teachers={teachers}
                    cities={cities}
                    onClose={() => setModalRoom(undefined)}
                    onSaved={(id) => { setModalRoom(undefined); setChosenId(id); reloadRooms(); reloadWeek(); }}
                    onDeleted={() => { setModalRoom(undefined); setChosenId(null); reloadRooms(); }}
                />
            )}
        </div>
    );
}
