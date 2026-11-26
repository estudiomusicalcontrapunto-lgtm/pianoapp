import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Save } from 'lucide-react';
import { api } from '../lib/api';
import { formatCOP } from '../lib/utils';
import { CitiesCard } from '../components/CitiesCard';

const GROUPS = [
    {
        title: 'Mensualidad y pagos',
        hint: 'Los valores de la mensualidad y la clase suelta se definen por ciudad, en "Ciudades".',
        keys: [
            'dia_limite_pago', 'dias_pago_primer_cobro', 'dias_extra_comprobante_rechazado',
            'mensualidad_cubre_todas_las_clases',
        ],
    },
    {
        title: 'Cambios de clase',
        hint: 'El estudiante cambia una clase eligiendo un cupo de reposición de su profesor en el mismo mes. Las reposiciones no se pueden volver a cambiar.',
        keys: ['horas_minimas_aviso', 'tope_cambios_mes'],
    },
    {
        title: 'Ciclos de 4 semanas',
        hint: 'El cobro por ciclos se reemplaza por la mensualidad del día 1. Estos valores solo aplican a los ciclos que ya existen.',
        keys: ['duracion_ciclo_semanas', 'precio_paquete_4', 'precio_clase_suelta', 'dias_recordatorio_pago'],
    },
    { title: 'Valoraciones', keys: ['horas_cupo_apartado'] },
    { title: 'Avisos y anuncios', keys: ['dias_vigencia_anuncio', 'dias_avisos_leidos'] },
    { title: 'Horario de la academia', keys: ['hora_apertura', 'hora_cierre', 'duracion_clase_minutos'] },
];

export function AcademySettings() {
    const [definitions, setDefinitions] = useState([]);
    const [values, setValues] = useState({});
    const [saved, setSaved] = useState({});
    const [message, setMessage] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const settingsData = await api.getSettings();
                setDefinitions(settingsData.definitions);
                setValues(settingsData.settings);
                setSaved(settingsData.settings);
            } catch (error) {
                setMessage({ type: 'error', text: error.message });
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const changedKeys = Object.keys(values).filter(key => String(values[key]) !== String(saved[key]));

    const handleSave = async () => {
        setMessage(null);
        const changes = Object.fromEntries(changedKeys.map(key => [key, values[key]]));
        try {
            const data = await api.updateSettings(changes);
            setValues(data.settings);
            setSaved(data.settings);
            setMessage({ type: 'success', text: 'Ajustes guardados.' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        }
    };

    if (loading) {
        return <p className="text-muted-foreground">Cargando ajustes...</p>;
    }

    const renderField = (key) => {
        const definition = definitions.find(d => d.key === key);
        if (!definition) return null;

        if (definition.type === 'boolean') {
            return (
                <label key={key} className="flex items-start gap-3 min-h-11 cursor-pointer">
                    <input
                        id={key}
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0"
                        checked={!!values[key]}
                        onChange={e => setValues({ ...values, [key]: e.target.checked })}
                    />
                    <span className="text-sm font-medium">{definition.label}</span>
                </label>
            );
        }

        if (definition.type === 'choice') {
            return (
                <div key={key} className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={key}>{definition.label}</label>
                    <select id={key} className="w-full p-2 min-h-11 rounded-md border bg-background" value={values[key] ?? ''} onChange={e => setValues({ ...values, [key]: e.target.value })}>
                        {definition.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
            );
        }

        if (definition.type === 'month') {
            return (
                <div key={key} className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={key}>{definition.label}</label>
                    <input id={key} type="month" className="w-full p-2 min-h-11 rounded-md border bg-background" value={values[key] ?? ''} onChange={e => setValues({ ...values, [key]: e.target.value })} />
                </div>
            );
        }

        const isPrice = key.startsWith('precio_');
        return (
            <div key={key} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={key}>{definition.label}</label>
                <input
                    id={key}
                    type={definition.type === 'time' ? 'time' : 'number'}
                    inputMode={definition.type === 'time' ? undefined : 'numeric'}
                    min={definition.min}
                    max={definition.max}
                    step={definition.type === 'time' ? 900 : 1}
                    className="w-full p-2 min-h-11 rounded-md border bg-background"
                    value={values[key] ?? ''}
                    onChange={e => setValues({
                        ...values,
                        [key]: definition.type === 'time' ? e.target.value : (e.target.value === '' ? '' : Number(e.target.value))
                    })}
                />
                {isPrice && <p className="text-xs text-muted-foreground">{formatCOP(values[key])}</p>}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Ajustes</h2>
                    <p className="text-muted-foreground">Ciudades y valores, reglas de clases, pagos y valoraciones de la academia.</p>
                </div>
                <Button onClick={handleSave} disabled={changedKeys.length === 0} className="gap-2">
                    <Save size={16} />
                    Guardar cambios
                </Button>
            </div>

            {message && (
                <p className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>{message.text}</p>
            )}

            <CitiesCard />

            <div className="grid gap-4 md:grid-cols-2">
                {GROUPS.map(group => (
                    <Card key={group.title}>
                        <CardHeader>
                            <CardTitle className="text-lg">{group.title}</CardTitle>
                            {group.hint && <p className="text-sm text-muted-foreground">{group.hint}</p>}
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {group.keys.map(renderField)}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
