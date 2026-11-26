import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Lock, Wallet, CalendarClock, Repeat } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, formatCOP } from '../lib/utils';
import { CHARGE_LABELS } from '../lib/labels';
import { WEEKDAYS, capitalize, formatDateTime, formatDay, formatShortDay } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { NoticeList } from '../components/NoticeList';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const shiftMonth = (month, delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month) => {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
};

function StatTile({ label, value, hint, icon, onClick }) {
    const Icon = icon;
    return (
        <Card className={cn(onClick && "cursor-pointer transition-colors hover:border-primary/50")} onClick={onClick}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </CardContent>
        </Card>
    );
}

// Paid vs still to be paid, as one bar split in two (each part labeled, never color alone)
function IncomeCard({ income, month, onMonthChange }) {
    const total = income.paid + income.pending;
    const paidShare = total ? (income.paid / total) * 100 : 0;
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Ingreso proyectado de {monthLabel(month)}</CardTitle>
                <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Mes anterior" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
                    <Button variant="ghost" size="icon" aria-label="Mes siguiente" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <p className="text-3xl font-bold">{formatCOP(total)}</p>
                    <p className="text-xs text-muted-foreground">Cobros de este mes (mensualidades y clases sueltas), sin contar los vencidos.</p>
                </div>
                {total > 0 && (
                    <div className="flex h-3 gap-0.5" role="img" aria-label={`Pagado ${formatCOP(income.paid)}, pendiente ${formatCOP(income.pending)}`}>
                        {income.paid > 0 && (
                            <div className="h-full rounded bg-primary" style={{ width: `${paidShare}%` }} title={`Pagado: ${formatCOP(income.paid)}`} />
                        )}
                        {income.pending > 0 && (
                            <div className="h-full rounded bg-orange-400" style={{ width: `${100 - paidShare}%` }} title={`Pendiente: ${formatCOP(income.pending)}`} />
                        )}
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />Pagado</p>
                        <p className="text-lg font-semibold">{formatCOP(income.paid)}</p>
                        <p className="text-xs text-muted-foreground">{income.paidCount} cobro(s) aprobado(s)</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />Pendiente de pago</p>
                        <p className="text-lg font-semibold">{formatCOP(income.pending)}</p>
                        <p className="text-xs text-muted-foreground">{income.pendingCount} cobro(s) por pagar o en revisión</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function OccupancyCard({ occupancy }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Ocupación de los salones esta semana</CardTitle>
                <p className="text-xs text-muted-foreground">Horas con clase sobre el horario de la academia (lunes a sábado).</p>
            </CardHeader>
            <CardContent className="space-y-4">
                {occupancy.map(room => (
                    <div key={room.roomId} className="space-y-1">
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium">{room.roomName}</span>
                            <span className="text-muted-foreground">
                                {room.bookedPercent}% · {Math.round(room.bookedMinutes / 60)} h de {Math.round(room.openMinutes / 60)} h
                            </span>
                        </div>
                        <div className="h-2.5 w-full rounded bg-secondary" title={`${room.roomName}: ${room.bookedPercent}% con clase, ${room.windowPercent}% con franjas de profesores`}>
                            <div className="h-full rounded bg-primary" style={{ width: `${Math.min(room.bookedPercent, 100)}%` }} />
                        </div>
                        <p className="text-[11px] text-muted-foreground">{room.windowPercent}% del horario tiene franjas de profesores</p>
                    </div>
                ))}
                {occupancy.length === 0 && <p className="text-sm text-muted-foreground">No hay salones activos.</p>}
            </CardContent>
        </Card>
    );
}

function ListCard({ title, empty, children, action }) {
    const items = React.Children.toArray(children).filter(Boolean);
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{title}</CardTitle>
                {action}
            </CardHeader>
            <CardContent className="space-y-2">
                {items.length ? items : <p className="text-sm text-muted-foreground">{empty}</p>}
            </CardContent>
        </Card>
    );
}

export function AcademyPanel({ onViewChange }) {
    const [month, setMonth] = useState(null);
    const { data, error, reload } = useApiData(() => api.getAcademyOverview(month), [month]);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState('');

    const runTasks = async () => {
        setRunning(true);
        setRunResult('');
        try {
            const result = await api.runMaintenance();
            const makeups = result.makeupsExpired || { lost: 0, discounted: 0 };
            setRunResult(
                `Tareas ejecutadas: ${result.lessonsTaken} clase(s) dadas por tomadas, ${result.monthsCharged} mensualidad(es) cobrada(s), `
                + `${result.unpaidReleased} horario(s) liberado(s) por falta de pago, ${result.holdsReleased} cupo(s) apartado(s) liberado(s), `
                + `${makeups.lost + makeups.discounted} reposición(es) vencida(s).`
            );
            reload();
        } catch (err) {
            setRunResult(err.message);
        } finally {
            setRunning(false);
        }
    };

    if (!data) {
        return error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-muted-foreground">Cargando panel...</p>;
    }

    const { inReview, toPay } = data.payments;
    const goToPayments = () => onViewChange('payments');
    const seeAll = <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={goToPayments}>Ver todos</Button>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Panel de la academia</h2>
                    <p className="text-muted-foreground">{capitalize(formatDay(data.today))}</p>
                </div>
                <Button variant="outline" className="gap-2" onClick={runTasks} disabled={running}>
                    <RefreshCw size={16} className={running ? 'animate-spin' : ''} />
                    Ejecutar tareas ahora
                </Button>
            </div>
            {runResult && <p className="text-sm text-muted-foreground">{runResult}</p>}

            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <StatTile label="Comprobantes por revisar" value={inReview.length} hint="Revísalos en Pagos" icon={Wallet} onClick={goToPayments} />
                <StatTile label="Cobros por pagar" value={toPay.length} hint="sin comprobante o rechazados" icon={CalendarClock} onClick={goToPayments} />
                <StatTile label="Cupos que vencen" value={data.holdsExpiring.length} hint="hoy o mañana" icon={Lock} onClick={() => onViewChange('assessments')} />
                <StatTile label="Reposiciones pendientes" value={data.pendingMakeups} hint="clases canceladas sin reponer" icon={Repeat} onClick={() => onViewChange('cancellations')} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <IncomeCard income={data.income} month={data.month} onMonthChange={setMonth} />
                <OccupancyCard occupancy={data.occupancy} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <ListCard title={`Comprobantes por revisar (${inReview.length})`} empty="No hay comprobantes esperando revisión." action={seeAll}>
                    {inReview.slice(0, 6).map(p => (
                        <div key={p.id} className="border-b last:border-0 pb-2 last:pb-0">
                            <p className="text-sm font-medium truncate">{p.studentName}</p>
                            <p className="text-xs text-muted-foreground">{p.concept} · {formatCOP(p.amount)}</p>
                        </div>
                    ))}
                </ListCard>

                <ListCard title="Cupos apartados que vencen hoy o mañana" empty="Ningún cupo apartado vence pronto.">
                    {data.holdsExpiring.map(h => (
                        <div key={h.id} className="border-b last:border-0 pb-2 last:pb-0">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{h.studentName}</p>
                                {!h.active && <Badge>Vencido</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {WEEKDAYS[h.weekday]} {h.startTime} · {h.roomName} · {h.teacherName}
                            </p>
                            <p className="text-xs text-orange-700">Vence el {formatDateTime(h.expiresAt)}{h.contactPhone && ` · Tel. ${h.contactPhone}`}</p>
                        </div>
                    ))}
                </ListCard>

                <ListCard title={`Cobros por pagar (${toPay.length})`} empty="Nadie tiene cobros por pagar." action={seeAll}>
                    {toPay.slice(0, 6).map(p => (
                        <div key={p.id} className="flex items-center justify-between gap-2 border-b last:border-0 pb-2 last:pb-0">
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{p.studentName}</p>
                                <p className="text-xs text-muted-foreground">{p.concept} · {formatCOP(p.amount)}</p>
                                {p.dueDate && (
                                    <p className={cn('text-xs', p.overdue ? 'text-red-600' : 'text-muted-foreground')}>
                                        {p.overdue ? 'Venció el' : 'Plazo hasta el'} {formatShortDay(p.dueDate)}
                                    </p>
                                )}
                            </div>
                            <StatusBadge map={CHARGE_LABELS} value={p.status} />
                        </div>
                    ))}
                </ListCard>
            </div>

            <NoticeList limit={8} onViewHistory={() => onViewChange('notices')} />
        </div>
    );
}
