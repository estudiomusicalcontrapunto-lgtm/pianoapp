import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { formatCOP, inputClass } from '../lib/utils';
import { addDays, formatMonth, today } from '../lib/time';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

// What the student pays, from their city (only the academy sets prices)
const pricesOf = (student, cities) => {
    const city = (cities || []).find(c => c.id === student.cityId) || (cities || [])[0];
    return city?.prices || null;
};

const MAX_CLASSES = 10;

/**
 * The academy gives a student single classes of one month: how many, in one
 * charge (one receipt), never more than the monthly fee. The teacher books them
 * in their agenda; if the dates are already agreed, the academy can set them here.
 */
export function SingleClassesModal({ student, cities, onClose, onDone }) {
    const { data: allRooms } = useApiData(() => api.getRooms(), []);
    const rooms = (allRooms || []).filter(r => r.active && r.teachers.some(t => t.id === student.teacherId));
    const thisMonth = today().slice(0, 7);
    const nextMonth = addDays(`${thisMonth}-28`, 7).slice(0, 7);
    const [month, setMonth] = useState(thisMonth);
    const [count, setCount] = useState(1);
    const [withDates, setWithDates] = useState(false);
    const defaultTime = student.fixedSchedules?.[0]?.startTime || '16:00';
    const firstDay = month === thisMonth ? addDays(today(), 1) : `${month}-01`;
    const [rows, setRows] = useState([]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const prices = pricesOf(student, cities);

    const set = (i, field) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [field]: e.target.value } : r)));
    const addRow = () => setRows([...rows, { date: rows.length ? addDays(rows[rows.length - 1].date, 7) : firstDay, startTime: defaultTime, roomId: '' }]);
    const removeRow = (i) => setRows(rows.filter((_, j) => j !== i));
    const changeCount = (value) => {
        const n = Math.max(1, Math.min(MAX_CLASSES, Number(value) || 1));
        setCount(n);
        if (rows.length > n) setRows(rows.slice(0, n));
    };

    const outsideMonth = withDates && rows.some(r => r.date.slice(0, 7) !== month);
    const uncapped = prices ? count * prices.singleClassFee : 0;
    const total = prices ? Math.min(uncapped, prices.monthlyFee) : 0;

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const classes = withDates ? rows.map(r => ({ ...r, roomId: r.roomId || rooms[0]?.id })) : [];
            const { payment, left } = await api.bookSingleClasses(student.id, month, count, classes);
            onDone(
                `Listo: ${count === 1 ? '1 clase suelta' : `${count} clases sueltas`} de ${formatMonth(month)} para ${student.name}, en un solo cobro de ${formatCOP(payment.amount)}.`
                + (left ? ` ${student.teacherName} ${left === count ? 'las' : `las ${left} que faltan`} agenda en su agenda.` : '')
            );
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    if (!student.teacherId) {
        return (
            <Modal title="Clases sueltas" onClose={onClose}>
                <p className="text-sm">Primero asígnale un profesor a {student.name}.</p>
            </Modal>
        );
    }

    return (
        <Modal title={`Clases sueltas de ${student.name}`} onClose={onClose} className="max-w-xl">
            <form onSubmit={save} className="space-y-4">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Mes</p>
                    <div className="grid grid-cols-2 gap-2">
                        {[thisMonth, nextMonth].map(m => (
                            <Button key={m} type="button" variant={month === m ? 'primary' : 'outline'} aria-pressed={month === m} onClick={() => { setMonth(m); setRows([]); }}>
                                {formatMonth(m)}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="single-count">Cuántas clases</label>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="icon" aria-label="Una menos" onClick={() => changeCount(count - 1)}>−</Button>
                        <input id="single-count" inputMode="numeric" className={`${inputClass} w-20 text-center`} value={count} onChange={e => changeCount(e.target.value)} />
                        <Button type="button" variant="outline" size="icon" aria-label="Una más" onClick={() => changeCount(count + 1)}>+</Button>
                    </div>
                </div>

                {prices && (
                    <div className="rounded-lg bg-secondary/40 p-3 text-sm">
                        <p>{count} × {formatCOP(prices.singleClassFee)} = <span className="font-semibold">{formatCOP(uncapped)}</span></p>
                        {total < uncapped && <p>Se cobra {formatCOP(total)}: nunca más que la mensualidad.</p>}
                        <p className="text-xs text-muted-foreground">Un solo cobro de {formatCOP(total)}: el estudiante envía un solo comprobante.</p>
                    </div>
                )}

                <p className="text-sm text-muted-foreground">
                    {student.teacherName} las agenda en su agenda, dentro de {formatMonth(month)}.
                </p>
                <label className="flex min-h-11 items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="h-5 w-5" checked={withDates} onChange={e => { setWithDates(e.target.checked); if (e.target.checked && !rows.length) addRow(); }} />
                    Ya acordamos fechas con la familia: ponerlas ahora
                </label>
                {withDates && (
                    <div className="space-y-2">
                        {rows.map((row, i) => (
                            <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_7rem_1fr_auto] gap-2 items-center rounded-lg border p-2">
                                <input type="date" aria-label="Fecha" className={inputClass} value={row.date} min={today()} onChange={set(i, 'date')} required />
                                <input type="time" aria-label="Hora" step={900} className={`${inputClass} order-3 sm:order-none`} value={row.startTime} onChange={set(i, 'startTime')} required />
                                <select aria-label="Salón" className={`${inputClass} order-4 sm:order-none`} value={row.roomId || rooms[0]?.id || ''} onChange={set(i, 'roomId')}>
                                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <Button type="button" variant="ghost" size="icon" aria-label="Quitar fecha" onClick={() => removeRow(i)}>
                                    <Trash2 size={16} />
                                </Button>
                            </div>
                        ))}
                        {rows.length < count && (
                            <Button type="button" variant="outline" className="gap-1" onClick={addRow}><Plus size={14} />Agregar otra fecha</Button>
                        )}
                        {rows.length < count && <p className="text-xs text-muted-foreground">Las {count - rows.length} que no tengan fecha las agenda el profesor.</p>}
                        {rooms.length === 0 && <p className="text-sm text-red-600">{student.teacherName} no tiene salones asignados.</p>}
                        {outsideMonth && <p className="text-sm text-red-600">Todas las fechas deben ser de {formatMonth(month)}.</p>}
                    </div>
                )}

                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Volver</Button>
                    <Button type="submit" disabled={saving || outsideMonth || (withDates && rows.length > 0 && rooms.length === 0)}>Dar y cobrar</Button>
                </div>
            </form>
        </Modal>
    );
}
/** A mensualidad charged by hand: this month's (e.g. on day 1) or next month's (ahead of time). */
export function MonthlyChargeModal({ student, cities, onClose, onDone }) {
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const prices = pricesOf(student, cities);
    const thisMonth = today().slice(0, 7);
    const nextMonth = addDays(`${thisMonth}-28`, 7).slice(0, 7);
    const [month, setMonth] = useState(thisMonth);
    const day = Number(today().slice(8));

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const payment = await api.chargeMonthByHand(student.id, month);
            onDone(`Listo: mensualidad de ${formatMonth(month)} para ${student.name} por ${formatCOP(payment.amount)}.`);
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <Modal title={`Mensualidad de ${student.name}`} onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mes">
                    {[thisMonth, nextMonth].map(m => (
                        <Button key={m} type="button" variant={month === m ? 'primary' : 'outline'} aria-pressed={month === m} onClick={() => setMonth(m)}>
                            {formatMonth(m)}
                        </Button>
                    ))}
                </div>
                <p className="text-sm">
                    Cobrar la mensualidad de <span className="font-semibold">{formatMonth(month)}</span>
                    {prices && <> por <span className="font-semibold">{formatCOP(prices.monthlyFee)}</span></>}.
                </p>
                {!student.fixedSchedules?.length && (
                    <p className="text-sm text-muted-foreground">Todavía no tiene horario: sus clases se crean cuando su profesor se lo asigne.</p>
                )}
                {month === thisMonth && day > 5 && (
                    <p className="rounded-md bg-orange-50 p-3 text-sm text-orange-900">
                        Ya va avanzado el mes. Si el estudiante empieza ahora, es mejor que su profesor le asigne el horario: la app le cobra solo las clases que le quedan.
                    </p>
                )}
                <p className="text-xs text-muted-foreground">Cada día 1 la app cobra sola la mensualidad a quien tiene horario semanal; esto es para hacerlo a mano.</p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Volver</Button>
                    <Button onClick={save} disabled={saving}>Cobrar mensualidad</Button>
                </div>
            </div>
        </Modal>
    );
}
