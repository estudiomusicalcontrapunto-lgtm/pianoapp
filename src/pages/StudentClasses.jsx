import React, { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, formatCOP } from '../lib/utils';
import { LESSON_LABELS, PAYMENT_LABELS, PLAN_LABELS, lessonStatusKey } from '../lib/labels';
import { WEEKDAYS_SHORT, capitalize, formatDay, formatMonth, formatShortDay, localParts } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { CycleProgress } from '../components/CycleProgress';
import { CycleReceiptModal } from '../components/CycleReceiptModal';

const TABS = [
    { id: 'ciclo', label: 'Este mes' },
    { id: 'historial', label: 'Historial' },
    // Old 4-week cycles only; payments have their own section ("Pagos")
    { id: 'pagos', label: 'Ciclos anteriores' },
];

function LessonRow({ lesson, lessons }) {
    const { date, time } = localParts(lesson.startsAt);
    const original = lesson.originalLessonId && lessons.find(l => l.id === lesson.originalLessonId);
    const moved = ['reprogramada_por_estudiante', 'cancelada_por_profesor', 'cancelada_por_academia'].includes(lesson.status);
    return (
        <div className={cn("flex items-center gap-4 py-3 border-b last:border-0", moved && "opacity-70")}>
            <div className="w-14 text-center shrink-0">
                <p className="text-xs text-muted-foreground">{WEEKDAYS_SHORT[localParts(lesson.startsAt).weekday]}</p>
                <p className="text-sm font-bold">{formatShortDay(date)}</p>
            </div>
            <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", moved && "line-through")}>{time} · {lesson.roomName}</p>
                <p className="text-xs text-muted-foreground">
                    {lesson.kind === 'reposicion' ? 'Reposición' : `Clase con ${lesson.teacherName}`}
                    {original && ` de la clase del ${formatShortDay(localParts(original.startsAt).date)}`}
                    {lesson.reason && !lesson.moved && ` · ${lesson.reason}`}
                </p>
                {lesson.substituteLabel && (
                    <p className="text-xs text-emerald-700">La dicta {lesson.substituteLabel} (reemplazo de {lesson.teacherName})</p>
                )}
            </div>
            <StatusBadge map={LESSON_LABELS} value={lessonStatusKey(lesson)} />
        </div>
    );
}

const PAYMENT_STATUS = {
    por_pagar: { label: 'Por pagar', tone: 'warning' },
    en_revision: { label: 'En revisión', tone: 'info' },
    aprobado: { label: 'Aprobado', tone: 'success' },
    rechazado: { label: 'Rechazado', tone: 'danger' },
    anulado: { label: 'Vencido', tone: 'neutral' },
};

// One payment of the monthly billing, with its receipts
export function PaymentRow({ payment, onPay, onOpenReceipt }) {
    const actionable = ['por_pagar', 'rechazado'].includes(payment.status) && payment.standing?.state !== 'vencido';
    return (
        <Card>
            <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="font-medium">{capitalize(payment.description)}</p>
                        <p className="text-lg font-bold">{formatCOP(payment.amount)}</p>
                        {payment.netAmount !== payment.amount && (
                            <p className="text-xs text-muted-foreground">Con ajustes: {formatCOP(payment.netAmount)}</p>
                        )}
                        {payment.discounts?.length > 0 && (
                            <p className="text-xs text-green-700">Incluye {payment.discounts.length} descuento(s) por clases no repuestas.</p>
                        )}
                    </div>
                    <StatusBadge map={PAYMENT_STATUS} value={payment.status} />
                </div>
                {payment.standing?.state === 'pendiente' && <p className="text-sm text-orange-800">{payment.standing.message}</p>}
                {payment.status === 'rechazado' && payment.rejectionReason && <p className="text-sm text-red-700">Motivo del rechazo: {payment.rejectionReason}</p>}
                {payment.receipts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {payment.receipts.map((receipt, i) => (
                            <Button key={receipt.id} size="sm" variant="outline" className="min-h-11 gap-1" onClick={() => onOpenReceipt(payment.id, receipt.id)}>
                                <FileText size={14} />Comprobante {i + 1}{receipt.status === 'rechazado' ? ' (rechazado)' : ''}
                            </Button>
                        ))}
                    </div>
                )}
                {actionable && (
                    <Button className="w-full min-h-11 gap-1" onClick={() => onPay(payment)}>
                        <Upload size={16} />{payment.status === 'rechazado' ? 'Enviar otro comprobante' : 'Pagar y enviar comprobante'}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

export function StudentClasses() {
    const [tab, setTab] = useState('ciclo');
    const [paying, setPaying] = useState(null);
    const { data, error, reload } = useApiData(() => Promise.all([api.getLessons(), api.getCycles()]), []);
    const [lessons, cycles] = data || [[], []];
    const [receiptError, setReceiptError] = useState('');

    const today = localParts(new Date()).date;
    const active = cycles.filter(c => c.status === 'activo').sort((a, b) => a.startDate.localeCompare(b.startDate));
    const current = active.find(c => c.startDate <= today && today <= c.endDate) || active[0];
    const cycleLessons = current ? lessons.filter(l => l.cycleId === current.id) : [];
    const history = [...lessons].sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
    // Monthly billing: the classes of this month
    const monthLessons = lessons
        .filter(l => (l.period || localParts(l.startsAt).date.slice(0, 7)) === today.slice(0, 7))
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

    const openReceipt = async (cycleId) => {
        setReceiptError('');
        try {
            await api.openReceipt(cycleId);
        } catch (err) {
            setReceiptError(err.message);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Mis clases</h2>
                <p className="text-muted-foreground">Tu ciclo, el historial de clases y tus pagos.</p>
            </div>

            <div className="flex flex-wrap gap-2">
                {/* On a phone, payments have their own section in the bottom bar */}
                {TABS.map(t => (
                    <Button
                        key={t.id} size="sm" variant={tab === t.id ? 'primary' : 'outline'} onClick={() => setTab(t.id)}
                        className={cn(t.id === 'pagos' && !cycles.some(c => c.status !== 'cancelado') && 'hidden')}
                    >{t.label}</Button>
                ))}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {tab === 'ciclo' && (
                current ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Ciclo del {formatDay(current.startDate)} al {formatDay(current.endDate)}</CardTitle>
                            <p className="text-sm text-muted-foreground">{current.summary.taken} de {current.summary.total} clases tomadas</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <CycleProgress units={current.summary.units} total={current.summary.total} showLegend />
                            <div>
                                {cycleLessons.map(lesson => <LessonRow key={lesson.id} lesson={lesson} lessons={lessons} />)}
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Tus clases de {formatMonth(today.slice(0, 7))}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {monthLessons.map(lesson => <LessonRow key={lesson.id} lesson={lesson} lessons={lessons} />)}
                            {monthLessons.length === 0 && <p className="text-sm text-muted-foreground">No tienes clases este mes.</p>}
                        </CardContent>
                    </Card>
                )
            )}

            {tab === 'historial' && (
                <Card>
                    <CardContent className="pt-4">
                        {history.map(lesson => <LessonRow key={lesson.id} lesson={lesson} lessons={lessons} />)}
                        {history.length === 0 && <p className="text-sm text-muted-foreground">Aún no tienes clases.</p>}
                    </CardContent>
                </Card>
            )}

            {tab === 'pagos' && (
                <div className="space-y-3">
                    {receiptError && <p className="text-sm text-red-500">{receiptError}</p>}
                    <p className="text-sm text-muted-foreground">Tus pagos de cada mes están en la sección Pagos.</p>
                    {cycles.filter(c => c.status !== 'cancelado').map(cycle => (
                        <Card key={cycle.id}>
                            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                <div className="flex-1">
                                    <p className="font-medium">{capitalize(formatDay(cycle.startDate))} al {formatDay(cycle.endDate)}</p>
                                    <p className="text-sm text-muted-foreground">{PLAN_LABELS[cycle.plan]} · {formatCOP(cycle.amount)}</p>
                                    {cycle.rejectionReason && cycle.paymentStatus === 'pendiente' && (
                                        <p className="text-xs text-red-600">Comprobante rechazado: {cycle.rejectionReason}</p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    <StatusBadge map={PAYMENT_LABELS} value={cycle.paymentStatus} />
                                    {cycle.status === 'activo' && cycle.summary?.started === false && (
                                        <Badge tone="info">Empieza el {formatShortDay(cycle.startDate)}</Badge>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {cycle.hasReceipt && (
                                        <Button size="sm" variant="outline" className="gap-1" onClick={() => openReceipt(cycle.id)}>
                                            <FileText size={14} />Ver comprobante
                                        </Button>
                                    )}
                                    {cycle.status === 'pendiente_pago' && (
                                        <Button size="sm" className="gap-1" onClick={() => setPaying(cycle)}>
                                            <Upload size={14} />{cycle.hasReceipt ? 'Cambiar' : 'Subir comprobante'}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {paying && <CycleReceiptModal cycle={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
        </div>
    );
}
