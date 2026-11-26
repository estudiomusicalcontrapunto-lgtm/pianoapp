import React, { useState } from 'react';
import { MapPin, Pencil, PlusCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { formatCOP } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

const inputClass = 'w-full p-2 min-h-11 rounded-md border bg-background';
const EMPTY = { name: '', monthlyFee: '', singleClassFee: '', paymentText: '' };

// Only digits: "260.000" or "$260000" -> "260000"
const digits = (value) => String(value ?? '').replace(/\D/g, '');

function CityForm({ initial, onSave, onCancel }) {
    const [form, setForm] = useState(initial);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const monthly = Number(digits(form.monthlyFee)) || 0;

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await onSave({
                name: form.name,
                monthlyFee: digits(form.monthlyFee),
                singleClassFee: digits(form.singleClassFee),
                paymentText: form.paymentText,
            });
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-lg border p-4 bg-secondary/20">
            <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="city-name">Nombre de la ciudad</label>
                <input id="city-name" className={inputClass} value={form.name} onChange={set('name')} placeholder="Ej: Medellín" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="city-monthly">Mensualidad (COP)</label>
                    <input id="city-monthly" inputMode="numeric" className={inputClass} value={form.monthlyFee} onChange={set('monthlyFee')} placeholder="260000" />
                    {monthly > 0 && <p className="text-xs text-muted-foreground">{formatCOP(monthly)}</p>}
                </div>
                <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="city-single">Clase suelta (COP)</label>
                    <input
                        id="city-single" inputMode="numeric" className={inputClass} value={form.singleClassFee} onChange={set('singleClassFee')}
                        placeholder={monthly ? String(Math.round(monthly / 4)) : 'Vacío = mensualidad ÷ 4'}
                    />
                    <p className="text-xs text-muted-foreground">
                        {digits(form.singleClassFee)
                            ? formatCOP(Number(digits(form.singleClassFee)))
                            : `Vacío = mensualidad ÷ 4${monthly ? ` (${formatCOP(Math.round(monthly / 4))})` : ''}`}
                    </p>
                </div>
            </div>
            <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="city-payment-text">Texto de pago</label>
                <textarea
                    id="city-payment-text" rows={4} className="w-full p-2 rounded-md border bg-background"
                    value={form.paymentText} onChange={set('paymentText')}
                    placeholder="Cuenta bancaria, número de Nequi e instrucciones. Los estudiantes lo ven en la pantalla de pago."
                />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
                <Button type="submit" disabled={saving}>Guardar</Button>
                <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
            </div>
        </form>
    );
}

/**
 * "Ciudades": each one with its monthly fee, single-class fee and payment text.
 * Only the academy sets prices, and only per city.
 */
export function CitiesCard() {
    const { data, error, reload } = useApiData(() => api.getCities(), []);
    const [editing, setEditing] = useState(null); // city id, 'new' or null
    const cities = data || [];

    const save = async (city, values) => {
        if (city) await api.updateCity(city.id, values);
        else await api.createCity(values);
        setEditing(null);
        reload();
    };

    const toggleActive = async (city) => {
        try {
            await api.updateCity(city.id, { active: !city.active });
            reload();
        } catch (err) {
            alert(err.message);
        }
    };

    // Only possible while nobody uses the city; the server says why otherwise
    const remove = async (city) => {
        if (!confirm(`¿Eliminar ${city.name}? Solo se puede si no tiene estudiantes, profesores, salones ni pagos.`)) return;
        try {
            await api.deleteCity(city.id);
            reload();
        } catch (err) {
            alert(err.message);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="text-lg flex items-center gap-2"><MapPin size={18} className="text-primary" />Ciudades</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Cada ciudad tiene su mensualidad, su clase suelta y su texto de pago. Los estudiantes, profesores y salones pertenecen a una ciudad.
                    </p>
                </div>
                {editing !== 'new' && (
                    <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => setEditing('new')}>
                        <PlusCircle size={14} />Nueva ciudad
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                {error && <p className="text-sm text-red-500">{error}</p>}
                {editing === 'new' && <CityForm initial={EMPTY} onSave={(values) => save(null, values)} onCancel={() => setEditing(null)} />}
                {cities.map(city => (
                    editing === city.id ? (
                        <CityForm
                            key={city.id}
                            initial={{
                                name: city.name,
                                monthlyFee: String(city.monthlyFee),
                                singleClassFee: city.singleClassFee ? String(city.singleClassFee) : '',
                                paymentText: city.paymentText || '',
                            }}
                            onSave={(values) => save(city, values)}
                            onCancel={() => setEditing(null)}
                        />
                    ) : (
                        <div key={city.id} className="rounded-lg border p-4 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold flex items-center gap-2">
                                        {city.name}
                                        {!city.active && <Badge tone="neutral">Desactivada</Badge>}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Mensualidad {formatCOP(city.prices.monthlyFee)} · Clase suelta {formatCOP(city.prices.singleClassFee)}
                                        {city.prices.singleSource === 'mensualidad' && ' (mensualidad ÷ 4)'}
                                    </p>
                                </div>
                                <Button size="icon" variant="ghost" aria-label={`Editar ${city.name}`} onClick={() => setEditing(city.id)}>
                                    <Pencil size={16} />
                                </Button>
                            </div>
                            <p className="text-sm whitespace-pre-line rounded-md bg-secondary/30 p-2">
                                {city.paymentText || <span className="text-muted-foreground">Sin texto de pago.</span>}
                            </p>
                            <div className="flex flex-wrap gap-4">
                                <button type="button" className="text-xs text-muted-foreground underline min-h-8" onClick={() => toggleActive(city)}>
                                    {city.active ? 'Desactivar ciudad' : 'Activar ciudad'}
                                </button>
                                {cities.length > 1 && (
                                    <button type="button" className="text-xs text-red-700 underline min-h-8" onClick={() => remove(city)}>
                                        Eliminar ciudad
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                ))}
            </CardContent>
        </Card>
    );
}
