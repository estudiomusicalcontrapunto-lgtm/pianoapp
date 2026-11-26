
import React, { useEffect, useState } from 'react';
import { Camera, FileText, ImageUp, Copy, Check } from 'lucide-react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/utils';
import { capitalize, formatDay } from '../lib/time';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Phone photos are big: a copy at most 1600 px wide is enough to read a receipt and uploads fast
const shrinkPhoto = async (file) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1.5 * 1024 * 1024) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch {
        return file;
    }
};

/**
 * Pay and send the receipt: what to pay and by when, the academy's payment
 * text, and the photo (camera or gallery) or PDF of the transfer, with a
 * preview before sending.
 */
export function ReceiptModal({ payment, paymentText, onClose, onDone }) {
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pick = async (e) => {
        const selected = e.target.files?.[0] || null;
        e.target.value = '';
        setError('');
        if (!selected) return;
        if (!IMAGE_TYPES.includes(selected.type) && selected.type !== 'application/pdf') {
            setError('El comprobante debe ser una foto o un PDF.');
            return;
        }
        const ready = await shrinkPhoto(selected);
        if (ready.size > MAX_BYTES) {
            setError('El archivo pesa más de 10 MB. Intenta con otra foto o con una captura de pantalla.');
            return;
        }
        setFile(ready);
        setPreview(ready.type.startsWith('image/') && ready.type !== 'image/heic' ? URL.createObjectURL(ready) : null);
    };

    const send = async () => {
        setSaving(true);
        setError('');
        try {
            await api.uploadPaymentReceipt(payment.id, file);
            onDone('Listo: enviamos tu comprobante. Te avisaremos cuando lo revisen.');
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    const copyText = async () => {
        try {
            await navigator.clipboard.writeText(paymentText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Copying is a convenience; the text is on screen anyway
        }
    };

    const rejected = payment.status === 'rechazado';

    return (
        <Modal title="Pagar y enviar comprobante" onClose={onClose}>
            <div className="space-y-4">
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                    <p className="text-sm">{capitalize(payment.description)}</p>
                    <p className="text-2xl font-bold text-orange-900">{formatCOP(payment.amount)}</p>
                    {payment.standing?.message && <p className="text-sm text-orange-900">{payment.standing.message}</p>}
                    {!payment.standing?.message && payment.dueDate && <p className="text-sm text-orange-900">Paga hasta el {formatDay(payment.dueDate)}.</p>}
                </div>

                {rejected && payment.rejectionReason && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        Tu comprobante anterior no se aprobó: {payment.rejectionReason}. Envía uno nuevo.
                    </p>
                )}

                {paymentText && (
                    <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">Cómo pagar</p>
                            <Button type="button" size="sm" variant="ghost" className="min-h-11 gap-1" onClick={copyText}>
                                {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copiado' : 'Copiar'}
                            </Button>
                        </div>
                        <p className="text-sm whitespace-pre-line">{paymentText}</p>
                    </div>
                )}

                <p className="text-sm text-muted-foreground">Cuando pagues, envía la foto o el PDF del comprobante. Cada pago lleva un solo comprobante.</p>

                <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 text-center cursor-pointer hover:bg-accent">
                        <Camera className="text-primary" size={20} />
                        <span className="text-sm font-medium">Tomar foto</span>
                        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
                    </label>
                    <label className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 text-center cursor-pointer hover:bg-accent">
                        <ImageUp className="text-primary" size={20} />
                        <span className="text-sm font-medium">Galería o PDF</span>
                        <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={pick} />
                    </label>
                </div>

                {file && (
                    <div className="rounded-lg border p-2">
                        <p className="text-xs text-muted-foreground mb-2">Revisa que se vea el valor y la fecha antes de enviar:</p>
                        {preview
                            ? <img src={preview} alt="Vista previa del comprobante" className="max-h-64 w-full rounded object-contain bg-secondary/30" />
                            : <p className="flex items-center gap-2 text-sm"><FileText size={16} />{file.name}</p>}
                    </div>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" className="min-h-11" onClick={onClose}>Volver</Button>
                    <Button className="min-h-11" onClick={send} disabled={!file || saving}>{saving ? 'Enviando...' : 'Enviar comprobante'}</Button>
                </div>
            </div>
        </Modal>
    );
}
