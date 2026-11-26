
import React from 'react';
import { CalendarDays, Wallet, AlertCircle, Clock } from 'lucide-react';
import { cn, formatCOP } from '../lib/utils';
import { capitalize, formatDateTime, formatDay } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { CycleProgress } from './CycleProgress';

// "Próxima clase": when, where and until when it can be changed
export function NextLessonCard({ overview, onReschedule, onOpenCalendar }) {
    const lesson = overview.nextLesson;
    const rule = lesson?.rule;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Próxima clase</CardTitle>
                <CalendarDays className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3">
                {lesson ? (
                    <>
                        <div>
                            <p className="text-xl font-bold">{capitalize(formatDateTime(lesson.startsAt))}</p>
                            <p className="text-sm text-muted-foreground">
                                {lesson.roomName}
                                {lesson.substituteLabel ? ` · con ${lesson.substituteLabel}` : overview.teacherName && ` · con ${overview.teacherName}`}
                                {lesson.kind === 'reposicion' && ' · Reposición'}
                            </p>
                            {lesson.substituteLabel && (
                                <p className="text-xs text-emerald-700">Reemplaza a {overview.teacherName}, que sigue siendo tu profesor.</p>
                            )}
                        </div>
                        {rule && (
                            <p className={cn("text-sm flex items-start gap-1.5", rule.ok ? "text-muted-foreground" : "text-orange-800")}>
                                <Clock size={14} className="mt-0.5 shrink-0" />
                                {rule.message}
                            </p>
                        )}
                        <div className="flex gap-2">
                            <Button className="flex-1 min-h-11" disabled={!rule?.ok} onClick={() => onReschedule(lesson)}>
                                Cambiar clase
                            </Button>
                            <Button variant="outline" className="flex-1 min-h-11" onClick={onOpenCalendar}>Ver horario</Button>
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">No tienes clases programadas.</p>
                )}
            </CardContent>
        </Card>
    );
}

const PAYMENT_STATE_STYLE = {
    pendiente: { box: 'border-orange-300 bg-orange-50', text: 'text-orange-900' },
    vencido: { box: 'border-red-300 bg-red-50', text: 'text-red-900' },
    en_revision: { box: 'border-blue-200 bg-blue-50', text: 'text-blue-900' },
    al_dia: { box: 'border-green-200 bg-green-50', text: 'text-green-900' },
};

/**
 * "Mi pago": the month's payment (or the one waiting for the student), how
 * many days are left and the button to pay and send the receipt.
 */
export function PaymentCard({ overview, onPay, onOpenPayments }) {
    const payment = overview.payment;
    if (!payment) return null;
    const state = payment.standing?.state || 'pendiente';
    const style = PAYMENT_STATE_STYLE[state] || PAYMENT_STATE_STYLE.pendiente;
    const actionable = ['por_pagar', 'rechazado'].includes(payment.status) && state !== 'vencido';
    const title = {
        al_dia: 'Pago aprobado',
        en_revision: 'Comprobante en revisión',
        vencido: 'Pago vencido',
        pendiente: payment.status === 'rechazado' ? 'Comprobante rechazado' : 'Pago pendiente',
    }[state];

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Mi pago</CardTitle>
                <Wallet className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3">
                <div className={cn("rounded-lg border p-3 space-y-1", style.box)}>
                    <p className={cn("text-sm font-semibold", style.text)}>{title}</p>
                    <p className={cn("text-2xl font-bold", style.text)}>{formatCOP(payment.amount)}</p>
                    <p className="text-sm">{capitalize(payment.description)}</p>
                    {state === 'pendiente' && payment.standing.message && <p className={cn("text-sm font-medium", style.text)}>{payment.standing.message}</p>}
                    {state === 'en_revision' && <p className="text-sm">La academia lo está revisando. Te avisaremos.</p>}
                    {state === 'vencido' && <p className="text-sm">{payment.standing.message}</p>}
                    {payment.status === 'rechazado' && payment.rejectionReason && (
                        <p className="text-sm text-red-700 flex items-start gap-1"><AlertCircle size={14} className="mt-0.5 shrink-0" />Motivo: {payment.rejectionReason}</p>
                    )}
                </div>
                {overview.paymentsToPay > 1 && (
                    <p className="text-sm text-orange-800">Tienes {overview.paymentsToPay} pagos pendientes.</p>
                )}
                <div className="flex gap-2">
                    {actionable && (
                        <Button className="flex-1 min-h-11 bg-orange-500 hover:bg-orange-600" onClick={() => onPay(payment)}>
                            {payment.status === 'rechazado' ? 'Enviar otro comprobante' : 'Pagar y enviar comprobante'}
                        </Button>
                    )}
                    <Button variant="outline" className={cn("min-h-11", actionable ? "" : "flex-1")} onClick={onOpenPayments}>Ver pagos</Button>
                </div>
            </CardContent>
        </Card>
    );
}

// Orange box asking for the payment that secures the slot
function PaymentDue({ cycle, onUploadReceipt }) {
    const inReview = cycle.paymentStatus === 'en_revision';
    return (
        <div className={cn("rounded-lg border p-3 space-y-2", inReview ? "border-blue-200 bg-blue-50" : "border-orange-300 bg-orange-50")}>
            <div className={inReview ? "text-blue-900" : "text-orange-900"}>
                <p className="text-2xl font-bold">{formatCOP(cycle.amount)}</p>
                <p className="text-sm font-semibold">
                    {inReview ? 'Comprobante en revisión' : 'Confirma tu pago para asegurar tu horario'}
                </p>
            </div>
            <p className="text-xs text-muted-foreground">
                Mensualidad del {formatDay(cycle.startDate)} al {formatDay(cycle.endDate)}.
                {inReview && ' La academia te avisará cuando lo confirme.'}
            </p>
            {cycle.rejectionReason && !inReview && (
                <p className="text-xs text-red-700 flex items-start gap-1"><AlertCircle size={12} className="mt-0.5 shrink-0" />Tu comprobante anterior fue rechazado: {cycle.rejectionReason}</p>
            )}
            <Button
                size="sm"
                variant={inReview ? 'outline' : 'primary'}
                className={cn("w-full", !inReview && "bg-orange-500 hover:bg-orange-600")}
                onClick={() => onUploadReceipt(cycle)}
            >
                {inReview ? 'Cambiar comprobante' : 'Subir comprobante'}
            </Button>
        </div>
    );
}

// "Mi mensualidad": classes taken, a segment per class and the expiry date
export function CycleCard({ overview, onUploadReceipt }) {
    const { currentCycle: cycle, nextPayment } = overview;
    const onlyPayment = !cycle && nextPayment && nextPayment.paymentStatus !== 'en_revision';

    return (
        <Card className={cn(onlyPayment && "border-orange-300 bg-gradient-to-br from-orange-100 to-orange-50")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Mi mensualidad</CardTitle>
                <Wallet className={cn("h-4 w-4", onlyPayment ? "text-orange-500" : "text-primary")} />
            </CardHeader>
            <CardContent className="space-y-3">
                {cycle?.summary.unscheduled && (
                    <p className="text-sm">Tu pago está confirmado. Tu profesor está agendando tus clases y te avisaremos el horario.</p>
                )}
                {cycle && !cycle.summary.unscheduled && (
                    <>
                        <p className="text-xl font-bold">{cycle.summary.taken} de {cycle.summary.total} clases tomadas</p>
                        <CycleProgress units={cycle.summary.units} total={cycle.summary.total} showLegend />
                        <p className="text-xs text-muted-foreground">Vence el {formatDay(cycle.endDate)}. Las clases no tomadas antes se pierden.</p>
                    </>
                )}
                {nextPayment && <PaymentDue cycle={nextPayment} onUploadReceipt={onUploadReceipt} />}
                {!cycle && !nextPayment && (
                    <p className="text-sm text-muted-foreground">No tienes una mensualidad activa. Comunícate con la academia.</p>
                )}
            </CardContent>
        </Card>
    );
}

// Classes the teacher cancelled: the teacher books the make-up, by its deadline
export function PendingMakeupsCard({ makeups }) {
    if (!makeups.length) return null;
    return (
        <Card className="border-orange-300">
            <CardContent className="p-4 space-y-3">
                <p className="font-semibold flex items-center gap-2 text-orange-900">
                    <AlertCircle size={18} className="text-orange-500" />
                    {makeups.length === 1 ? 'Tienes una clase por reponer' : `Tienes ${makeups.length} clases por reponer`}
                </p>
                {makeups.map(lesson => (
                    <div key={lesson.id} className="rounded-md bg-orange-50 p-3">
                        <p className="text-sm font-medium">Clase del {formatDateTime(lesson.startsAt)}</p>
                        <p className="text-xs text-muted-foreground">
                            {lesson.status === 'cancelada_por_academia' ? 'La canceló la academia' : 'La canceló tu profesor'}, así que no la pierdes.
                            {lesson.makeupDeadline && ` Tu profesor te asignará la reposición a más tardar el ${formatDay(lesson.makeupDeadline)}.`}
                        </p>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
