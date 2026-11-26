
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Flame, Trophy, Music } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { NextLessonCard, CycleCard, PendingMakeupsCard, PaymentCard } from '../components/StudentCards';
import { NoticeList } from '../components/NoticeList';
import { RescheduleModal } from '../components/RescheduleModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { CycleReceiptModal } from '../components/CycleReceiptModal';
import { levelLabel } from '../lib/labels';
import { today } from '../lib/time';
import { PracticeWeek } from '../components/PracticeWeek';

export function StudentDashboard({ onViewChange }) {
    const { user, togglePracticeStreak } = useApp();
    const { data: overview, error: overviewError, reload } = useApiData(() => api.getStudentOverview(), []);
    const [moving, setMoving] = useState(null);
    const [paying, setPaying] = useState(null);
    const [noticesKey, setNoticesKey] = useState(0);

    const [practiceKey, setPracticeKey] = useState(0);
    const hasPracticed = user.lastPractice === today();

    const markPractice = async () => {
        await togglePracticeStreak(user.id);
        setPracticeKey(k => k + 1);
    };

    const [confirmation, setConfirmation] = useState('');

    const afterChange = (text = '') => {
        setMoving(null);
        setPaying(null);
        setConfirmation(typeof text === 'string' ? text : '');
        reload();
        setNoticesKey(k => k + 1);
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Hola, {user.name.split(' ')[0]} 👋</h2>

            {overviewError && <p className="text-sm text-red-500">{overviewError}</p>}
            {confirmation && (
                <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{confirmation}</p>
            )}
            {/* What matters first: the next class (and changing it) and the month's payment */}
            {overview && (
                <>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <NextLessonCard
                            overview={overview}
                            onReschedule={(lesson) => { setConfirmation(''); setMoving({ lesson }); }}
                            onOpenCalendar={() => onViewChange('classes')}
                        />
                        {overview.payment
                            ? <PaymentCard overview={overview} onPay={(payment) => { setConfirmation(''); setPaying({ payment }); }} onOpenPayments={() => onViewChange('payments')} />
                            : <CycleCard overview={overview} onUploadReceipt={(cycle) => setPaying({ cycle })} />}
                    </div>
                    <PendingMakeupsCard makeups={overview.pendingMakeups} />
                </>
            )}

            <NoticeList key={noticesKey} limit={3} onViewHistory={() => onViewChange('notices')} />

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="md:col-span-2 bg-gradient-to-br from-orange-100 to-orange-50 dark:from-orange-950 dark:to-background border-orange-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Racha de Estudio</CardTitle>
                        <Flame className={`h-4 w-4 ${hasPracticed ? "text-orange-500 fill-orange-500" : "text-muted-foreground"}`} />
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <PracticeWeek studentId={user.id} reloadKey={practiceKey} />
                        <p className="text-xs text-muted-foreground text-center">
                            {hasPracticed ? "¡Ya practicaste hoy!" : "Marca el día cuando practiques: solo cuenta el de hoy."}
                        </p>
                        {!hasPracticed && (
                            <Button
                                size="sm"
                                className="w-full bg-orange-500 hover:bg-orange-600 border-none"
                                onClick={markPractice}
                            >
                                Marcar Práctica
                            </Button>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Nivel Actual</CardTitle>
                        <Trophy className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{levelLabel(user.level)}</div>
                        <p className="text-xs text-muted-foreground">{user.instrument ? `${user.instrument.name} · ` : ''}Sigue así para subir de nivel.</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Repertorio Activo</CardTitle>
                        <Music className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{user.repertoire.length} Obras</div>
                        <p className="text-xs text-muted-foreground">En progreso</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4">
                {/* Recent Repertoire */}
                <Card>
                    <CardHeader>
                        <CardTitle>Tu Repertorio</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {user.repertoire.slice(0, 3).map((rep) => (
                                <div key={rep.id} className="flex items-center">
                                    <div className="flex-1 space-y-1">
                                        <p className="text-sm font-medium leading-none">{rep.title}</p>
                                        <p className="text-xs text-muted-foreground">{rep.composer}</p>
                                    </div>
                                    <div className="w-[30%] flex items-center gap-2">
                                        <ProgressBar value={rep.progress} className="h-2" />
                                        <span className="text-xs font-bold w-8 text-right">{rep.progress}%</span>
                                    </div>
                                </div>
                            ))}
                            {user.repertoire.length === 0 && (
                                <p className="text-sm text-muted-foreground">No tienes obras asignadas aún.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {moving && (
                <RescheduleModal
                    lesson={moving.lesson}
                    rules={overview.rules}
                    onClose={() => setMoving(null)}
                    onDone={afterChange}
                />
            )}
            {paying?.payment && (
                <ReceiptModal payment={paying.payment} paymentText={overview?.paymentText} onClose={() => setPaying(null)} onDone={afterChange} />
            )}
            {paying?.cycle && <CycleReceiptModal cycle={paying.cycle} onClose={() => setPaying(null)} onDone={afterChange} />}
        </div>
    );
}
