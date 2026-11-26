import React, { useState } from 'react';
import { CheckCircle2, XCircle, FileText, History, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, formatCOP, inputClass } from '../lib/utils';
import { capitalize, formatDateTime, formatDay } from '../lib/time';
import { CHARGE_LABELS } from '../lib/labels';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/Badge';
import { Modal, Field } from '../components/ui/Modal';

const PAYMENT_STATUS = CHARGE_LABELS;

const TABS = [
    { id: 'en_revision', label: 'Por revisar' },
    { id: 'por_pagar,rechazado', label: 'Pendientes' },
    { id: 'aprobado', label: 'Aprobados' },
    { id: '', label: 'Todos' },
];

const ACTIONS = {
    crear: 'Cobro registrado', subir_comprobante: 'Comprobante enviado', aprobar: 'Aprobado', rechazar: 'Rechazado',
    ajuste: 'Ajuste', vencer_pago: 'Venció sin pago',
};

function RejectModal({ payment, onClose, onDone }) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const send = async (e) => {
        e.preventDefault();
        try {
            await api.rejectPayment(payment.id, reason);
            onDone(`Rechazado. ${payment.studentName} recibe el motivo y puede enviar otro comprobante.`);
        } catch (err) {
            setError(err.message);
        }
    };
    return (
        <Modal title={`Rechazar comprobante de ${payment.studentName}`} onClose={onClose}>
            <form onSubmit={send} className="space-y-4">
                <Field label="Motivo" hint="El estudiante lo ve tal cual. Ej: no se ve el valor, es de otro mes.">
                    <textarea className={inputClass} rows={3} value={reason} onChange={e => setReason(e.target.value)} required />
                </Field>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Volver</Button>
                    <Button type="submit" variant="destructive" className="min-h-11" disabled={!reason.trim()}>Rechazar</Button>
                </div>
            </form>
        </Modal>
    );
}

// A correction never edits the payment: it is a separate adjustment kept in the history
function AdjustModal({ payment, onClose, onDone }) {
    const [form, setForm] = useState({ direction: 'menos', amount: '', reason: '' });
    const [error, setError] = useState('');
    const send = async (e) => {
        e.preventDefault();
        const value = Number(String(form.amount).replace(/\D/g, ''));
        try {
            await api.addPaymentAdjustment(payment.id, form.direction === 'menos' ? -value : value, form.reason);
            onDone('Ajuste registrado. El pago original queda igual y el ajuste aparece en su historial.');
        } catch (err) {
            setError(err.message);
        }
    };
    return (
        <Modal title="Corregir con un ajuste" onClose={onClose}>
            <form onSubmit={send} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {capitalize(payment.description)} de {payment.studentName}: {formatCOP(payment.amount)}. Los pagos no se editan; la corrección queda como un ajuste aparte.
                </p>
                <Field label="Tipo">
                    <select className={inputClass} value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}>
                        <option value="menos">Debe menos (descuento o devolución)</option>
                        <option value="mas">Debe más</option>
                    </select>
                </Field>
                <Field label="Valor (COP)">
                    <input inputMode="numeric" className={inputClass} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="65000" required />
                </Field>
                <Field label="Motivo">
                    <textarea className={inputClass} rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required />
                </Field>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Volver</Button>
                    <Button type="submit" className="min-h-11">Registrar ajuste</Button>
                </div>
            </form>
        </Modal>
    );
}

function HistoryModal({ payment, onClose }) {
    const { data, error } = useApiData(() => api.getPaymentHistory(payment.id), [payment.id]);
    return (
        <Modal title={`Historial: ${payment.studentName}`} onClose={onClose}>
            <div className="space-y-3">
                <p className="text-sm">{capitalize(payment.description)}: {formatCOP(payment.amount)}{data && data.netAmount !== payment.amount && ` · con ajustes ${formatCOP(data.netAmount)}`}</p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <ul className="divide-y text-sm">
                    {(data?.changes || []).map(change => (
                        <li key={change.id} className="py-2">
                            <p className="font-medium">{ACTIONS[change.action] || change.action}</p>
                            <p className="text-xs text-muted-foreground">
                                {formatDateTime(change.createdAt)}
                                {change.details?.reason && ` · ${change.details.reason}`}
                                {change.details?.amount !== undefined && change.action === 'ajuste' && ` · ${formatCOP(change.details.amount)}`}
                            </p>
                        </li>
                    ))}
                </ul>
            </div>
        </Modal>
    );
}

/** Receipts to review and every payment, with approve / reject, corrections and history. */
export function AcademyPayments() {
    const [tab, setTab] = useState('en_revision');
    const [search, setSearch] = useState('');
    const [modal, setModal] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const { data, error: loadError, loading, reload } = useApiData(() => api.getPayments(tab ? { status: tab } : {}), [tab]);
    const term = search.trim().toLowerCase();
    const payments = (data || []).filter(p => !term || p.studentName?.toLowerCase().includes(term));

    const done = (text) => { setModal(null); setMessage(text); reload(); };
    const approve = async (payment) => {
        setError('');
        try {
            await api.approvePayment(payment.id);
            done(`Aprobado el pago de ${payment.studentName}.`);
        } catch (err) {
            setError(err.message);
        }
    };
    const openReceipt = async (payment, receipt) => {
        setError('');
        try {
            await api.openPaymentReceipt(payment.id, receipt.id);
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Pagos</h2>
                <p className="text-muted-foreground">Comprobantes por revisar, cobros pendientes e historial. Los pagos no se editan ni se borran: las correcciones son ajustes.</p>
            </div>

            <div className="flex flex-wrap gap-2">
                {TABS.map(t => (
                    <Button key={t.id} variant={tab === t.id ? 'primary' : 'outline'} className="min-h-11" onClick={() => { setTab(t.id); setMessage(''); }}>{t.label}</Button>
                ))}
            </div>
            <input className={cn(inputClass, 'min-h-11')} placeholder="Buscar estudiante" value={search} onChange={e => setSearch(e.target.value)} />

            {message && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
            {(error || loadError) && <p className="text-sm text-red-600">{error || loadError}</p>}
            {loading && <p className="text-sm text-muted-foreground">Cargando...</p>}
            {!loading && payments.length === 0 && <p className="text-sm text-muted-foreground">No hay pagos en esta lista.</p>}

            <div className="grid gap-3 md:grid-cols-2">
                {payments.map(payment => {
                    const current = payment.receipts[payment.receipts.length - 1];
                    return (
                        <Card key={payment.id}>
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="font-semibold">{payment.studentName}</p>
                                        <p className="text-sm text-muted-foreground">{capitalize(payment.description)}{payment.cityName && ` · ${payment.cityName}`}</p>
                                        <p className="text-xl font-bold">{formatCOP(payment.amount)}</p>
                                        {payment.netAmount !== payment.amount && <p className="text-xs text-muted-foreground">Con ajustes: {formatCOP(payment.netAmount)}</p>}
                                    </div>
                                    <StatusBadge map={PAYMENT_STATUS} value={payment.status} />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {payment.dueDate && `Plazo: ${formatDay(payment.dueDate)}. `}
                                    {payment.calculation?.capped && 'Proporcional con tope en la mensualidad. '}
                                    {payment.calculation?.classesLeft && !payment.calculation.capped && `${payment.calculation.classesLeft} clases × ${formatCOP(payment.calculation.singleClassFee)}. `}
                                    {payment.calculation?.debt && 'Clase tomada sin pagar la mensualidad. '}
                                    {payment.discounts?.length > 0 && `Con ${payment.discounts.length} descuento(s) por clases no repuestas.`}
                                </p>
                                {payment.status === 'rechazado' && <p className="text-sm text-red-700">Rechazado: {payment.rejectionReason}</p>}
                                {payment.receipts.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {payment.receipts.map((receipt, i) => (
                                            <Button key={receipt.id} size="sm" variant="outline" className="min-h-11 gap-1" onClick={() => openReceipt(payment, receipt)}>
                                                <FileText size={14} />Comprobante {i + 1}{receipt.status === 'rechazado' ? ' (rechazado)' : ''}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                                {payment.status === 'en_revision' && current && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button className="min-h-11 gap-1" onClick={() => approve(payment)}><CheckCircle2 size={16} />Aprobar</Button>
                                        <Button variant="outline" className="min-h-11 gap-1 text-red-700" onClick={() => setModal({ type: 'reject', payment })}><XCircle size={16} />Rechazar</Button>
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" variant="ghost" className="min-h-11 gap-1" onClick={() => setModal({ type: 'history', payment })}><History size={14} />Historial</Button>
                                    <Button size="sm" variant="ghost" className="min-h-11 gap-1" onClick={() => setModal({ type: 'adjust', payment })}><SlidersHorizontal size={14} />Corregir</Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {modal?.type === 'reject' && <RejectModal payment={modal.payment} onClose={() => setModal(null)} onDone={done} />}
            {modal?.type === 'adjust' && <AdjustModal payment={modal.payment} onClose={() => setModal(null)} onDone={done} />}
            {modal?.type === 'history' && <HistoryModal payment={modal.payment} onClose={() => setModal(null)} />}
        </div>
    );
}
