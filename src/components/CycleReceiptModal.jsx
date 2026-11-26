
import React, { useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/utils';
import { formatDay } from '../lib/time';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

// Receipt of a 4-week cycle (old billing, until the cycles in course end)
export function CycleReceiptModal({ cycle, onClose, onDone }) {
    const [file, setFile] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const pick = (e) => {
        const selected = e.target.files?.[0] || null;
        setError('');
        if (selected && !TYPES.includes(selected.type)) {
            setError('El comprobante debe ser una imagen JPG o PNG, o un PDF.');
            setFile(null);
            return;
        }
        if (selected && selected.size > MAX_BYTES) {
            setError('El archivo no puede pesar más de 5 MB.');
            setFile(null);
            return;
        }
        setFile(selected);
    };

    const send = async () => {
        setSaving(true);
        setError('');
        try {
            await api.uploadReceipt(cycle.id, file);
            onDone();
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <Modal title="Subir comprobante" onClose={onClose}>
            <div className="space-y-4">
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm">
                    <p>Ciclo del {formatDay(cycle.startDate)} al {formatDay(cycle.endDate)}</p>
                    <p className="text-lg font-bold text-orange-900">{formatCOP(cycle.amount)}</p>
                </div>
                <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:bg-accent">
                    <Upload className="text-primary" />
                    <span className="text-sm font-medium">{file ? file.name : 'Elegir archivo (JPG, PNG o PDF, máx. 5 MB)'}</span>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={pick} />
                </label>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" className="min-h-11" onClick={onClose}>Cancelar</Button>
                    <Button className="min-h-11" onClick={send} disabled={!file || saving}>Enviar comprobante</Button>
                </div>
            </div>
        </Modal>
    );
}
