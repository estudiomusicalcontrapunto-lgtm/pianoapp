

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Users, Trophy, BookOpen, UserRoundCheck } from 'lucide-react';
import { NoticeList } from '../components/NoticeList';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';
import { LESSON_LABELS, levelLabel } from '../lib/labels';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { capitalize, formatDateTime, today } from '../lib/time';
import { PracticeWeekMini } from '../components/PracticeWeek';

// Lessons of other teachers this teacher covers (from a week ago on), with attendance.
// They may be in a room this teacher does not have, so they are listed here too.
function SubstituteLessonsCard({ userId }) {
    const [from] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const { data, reload } = useApiData(() => api.getLessons({ from }), [from]);
    const [error, setError] = useState('');
    const covered = (data || []).filter(l => l.substituteTeacherId === userId && l.teacherId !== userId);
    if (!covered.length) return null;

    const mark = async (lessonId, status) => {
        setError('');
        try {
            await api.markAttendance(lessonId, status);
            reload();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><UserRoundCheck size={18} className="text-emerald-600" />Clases que das como reemplazo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {covered.map(lesson => {
                    const started = new Date(lesson.startsAt) <= new Date();
                    return (
                        <div key={lesson.id} className="flex flex-wrap items-center gap-2 border-b last:border-0 pb-2 last:pb-0">
                            <div className="flex-1 min-w-[12rem]">
                                <p className="text-sm font-medium">{capitalize(formatDateTime(lesson.startsAt))} · {lesson.roomName}</p>
                                <p className="text-xs text-muted-foreground">{lesson.studentName}, estudiante de {lesson.teacherName}</p>
                            </div>
                            {started && ['programada', 'tomada', 'perdida'].includes(lesson.status) ? (
                                <div className="flex gap-1">
                                    <Button size="sm" variant={lesson.status === 'tomada' ? 'primary' : 'outline'} onClick={() => mark(lesson.id, 'tomada')}>Tomada</Button>
                                    <Button size="sm" variant={lesson.status === 'perdida' ? 'destructive' : 'outline'} onClick={() => mark(lesson.id, 'perdida')}>No asistió</Button>
                                </div>
                            ) : (
                                <StatusBadge map={LESSON_LABELS} value={lesson.status} />
                            )}
                        </div>
                    );
                })}
                {error && <p className="text-sm text-red-500">{error}</p>}
            </CardContent>
        </Card>
    );
}

export function TeacherDashboard({ onViewChange }) {

    const { user, students } = useApp();

    const totalStudents = students.length;
    const activeStudents = students.filter(s => s.lastPractice === today()).length;
    const advancedStudents = students.filter(s =>
        ["Prodigy", "Legend", "Genius"].includes(s.level)
    ).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Dashboard Maestro</h2>
                </div>
            </div>

            <NoticeList onViewHistory={() => onViewChange('notices')} />

            <SubstituteLessonsCard userId={user.id} />



            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Alumnos</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalStudents}</div>
                        <p className="text-xs text-muted-foreground">
                            {activeStudents} han practicado hoy
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Niveles Avanzados</CardTitle>
                        <Trophy className="h-4 w-4 text-yellow-500" />
                    </CardHeader>

                    <CardContent>
                        <div className="text-2xl font-bold">{advancedStudents}</div>
                        <p className="text-xs text-muted-foreground">Prodigios, Leyendas o Genios</p>
                    </CardContent>

                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Recursos</CardTitle>
                        <BookOpen className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Gestión</div>
                        <p className="text-xs text-muted-foreground">Administra alumnos y material</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Actividad Reciente de Alumnos</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {students.map(student => (
                            <div key={student.id} className="flex items-center justify-between border-b last:border-0 pb-4 last:pb-0">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                                        {student.name.charAt(0)}
                                    </div>
                                    <div>
                                        <p className="font-medium">{student.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {student.instrument ? `${student.instrument.name} · ` : ''}{levelLabel(student.level)} • Racha: {student.streak} {student.streak === 1 ? 'día' : 'días'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <PracticeWeekMini dates={student.practiceWeek} />
                                    <span className={`text-[10px] ${student.lastPractice === today() ? 'text-green-700 font-medium' : 'text-muted-foreground'}`}>
                                        {student.lastPractice === today() ? 'Practicó hoy' : 'Sin práctica hoy'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div >
    );
}
