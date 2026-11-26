import React, { useState } from 'react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { ReceiptModal } from '../components/ReceiptModal';
import { PaymentRow } from './StudentClasses';

/** "Pagos" (phone bottom bar): what to pay, how to pay it and every receipt sent. */
export function StudentPayments() {
    const { data, error, reload } = useApiData(() => api.getMyPayments(), []);
    const payments = data?.payments || [];
    const [paying, setPaying] = useState(null);
    const [confirmation, setConfirmation] = useState('');
    const [receiptError, setReceiptError] = useState('');

    const openReceipt = async (paymentId, receiptId) => {
        setReceiptError('');
        try {
            await api.openPaymentReceipt(paymentId, receiptId);
        } catch (err) {
            setReceiptError(err.message);
        }
    };

    const toPay = payments.filter(p => ['por_pagar', 'rechazado'].includes(p.status));
    const others = payments.filter(p => !toPay.includes(p));

    return (
        <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight">Pagos</h2>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {receiptError && <p className="text-sm text-red-600">{receiptError}</p>}
            {confirmation && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{confirmation}</p>}

            {toPay.map(payment => (
                <PaymentRow key={payment.id} payment={payment} onPay={(p) => { setConfirmation(''); setPaying(p); }} onOpenReceipt={openReceipt} />
            ))}
            {data && payments.length === 0 && (
                <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                    Todavía no tienes cobros. Cuando tu profesor te asigne tu horario o la academia te agende clases, aquí verás cuánto pagar y podrás enviar el comprobante.
                </p>
            )}
            {data && payments.length > 0 && toPay.length === 0 && (
                <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">Estás al día: no tienes pagos pendientes.</p>
            )}

            {data?.paymentText && (
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Cómo pagar</CardTitle></CardHeader>
                    <CardContent><p className="text-sm whitespace-pre-line">{data.paymentText}</p></CardContent>
                </Card>
            )}

            {others.length > 0 && <h3 className="pt-2 text-lg font-semibold">Historial</h3>}
            {others.map(payment => (
                <PaymentRow key={payment.id} payment={payment} onPay={setPaying} onOpenReceipt={openReceipt} />
            ))}

            {paying && (
                <ReceiptModal
                    payment={paying}
                    paymentText={data?.paymentText}
                    onClose={() => setPaying(null)}
                    onDone={(text) => { setPaying(null); setConfirmation(text); reload(); }}
                />
            )}
        </div>
    );
}
