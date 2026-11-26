import React, { useState } from 'react';
import { Save, Trash2, Upload, Link2, ArrowUp, ArrowDown, Pencil, Plus, ListOrdered } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn, inputClass } from '../lib/utils';
import { levelLabel } from '../lib/labels';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Modal';
import { LevelList, ResourceItem } from '../components/LevelGuide';

// Edits one level: the requirements text and its PDFs and links
function LevelEditor({ instrument, entry, onChanged }) {
    const [description, setDescription] = useState(entry.description);
    const [link, setLink] = useState({ title: '', url: '' });
    const [pdf, setPdf] = useState({ title: '', file: null });
    const [fileKey, setFileKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const dirty = description.trim() !== entry.description;

    const run = async (fn, success) => {
        setBusy(true);
        setMessage(null);
        try {
            await fn();
            setMessage({ type: 'success', text: success });
            onChanged();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy(false);
        }
    };

    const saveText = () => run(() => api.saveLevelRequirement(instrument.id, entry.level, description), 'Requisitos guardados.');

    const addLink = (e) => {
        e.preventDefault();
        run(async () => {
            await api.addLevelLink(instrument.id, entry.level, link.title, link.url);
            setLink({ title: '', url: '' });
        }, 'Enlace agregado.');
    };

    const uploadPdf = (e) => {
        e.preventDefault();
        run(async () => {
            await api.uploadLevelPdf(instrument.id, entry.level, pdf.file, pdf.title);
            setPdf({ title: '', file: null });
            setFileKey(k => k + 1);
        }, 'PDF subido.');
    };

    const remove = (resource) => {
        if (!confirm(`¿Eliminar "${resource.title}"? Los profesores y estudiantes dejarán de verlo.`)) return;
        run(() => api.deleteLevelResource(resource.id), 'Adjunto eliminado.');
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold">{levelLabel(entry.level)} · {instrument.name}</h3>
                <p className="text-sm text-muted-foreground">Lo ven los profesores que enseñan {instrument.name} y sus estudiantes.</p>
            </div>

            <div className="space-y-2">
                <Field label="Requisitos del nivel" hint="Técnica, obras, teoría o lo que se evalúa para aprobarlo. Déjalo vacío para quitarlo.">
                    <textarea
                        className={`${inputClass} min-h-[180px]`}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder={'Ej.:\n- Escalas mayores hasta 2 alteraciones\n- Una obra barroca, una clásica y una romántica\n- Lectura a primera vista'}
                    />
                </Field>
                <div className="flex items-center gap-3">
                    <Button onClick={saveText} disabled={!dirty || busy} className="gap-2"><Save size={16} />Guardar requisitos</Button>
                    {dirty && <span className="text-xs text-orange-700">Cambios sin guardar</span>}
                </div>
            </div>

            <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-semibold">Documentos y enlaces</p>
                {entry.resources.length > 0 ? (
                    <ul className="space-y-2">
                        {entry.resources.map(r => (
                            <ResourceItem
                                key={r.id}
                                resource={r}
                                onError={text => setMessage({ type: 'error', text })}
                                action={
                                    <Button variant="ghost" size="icon" aria-label={`Eliminar ${r.title}`} onClick={() => remove(r)} disabled={busy}>
                                        <Trash2 size={16} className="text-muted-foreground" />
                                    </Button>
                                }
                            />
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">Este nivel no tiene adjuntos.</p>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                    <form onSubmit={uploadPdf} className="rounded-lg border p-3 space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2"><Upload size={14} />Subir PDF (máx. 10 MB)</p>
                        <input
                            key={fileKey}
                            type="file"
                            accept="application/pdf"
                            className="block w-full text-sm"
                            onChange={e => setPdf({ ...pdf, file: e.target.files[0] || null })}
                        />
                        <input className={inputClass} placeholder="Título (opcional, por defecto el nombre del archivo)" value={pdf.title} onChange={e => setPdf({ ...pdf, title: e.target.value })} />
                        <Button type="submit" size="sm" disabled={!pdf.file || busy}>Subir</Button>
                    </form>
                    <form onSubmit={addLink} className="rounded-lg border p-3 space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2"><Link2 size={14} />Agregar enlace</p>
                        <input className={inputClass} placeholder="Título (ej.: Video de referencia)" value={link.title} onChange={e => setLink({ ...link, title: e.target.value })} />
                        <input type="url" className={inputClass} placeholder="https://..." value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} />
                        <Button type="submit" size="sm" disabled={!link.title.trim() || !link.url.trim() || busy}>Agregar</Button>
                    </form>
                </div>
            </div>

            {message && <p className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>{message.text}</p>}
        </div>
    );
}

// The instrument's ladder: add, rename, move up or down and remove levels
function LadderEditor({ instrument, levels, onChanged, onRenamed, onDone }) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const run = async (fn) => {
        setError('');
        setBusy(true);
        try {
            const result = await fn();
            onChanged(result.levels);
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        } finally {
            setBusy(false);
        }
    };

    const move = (index, delta) => {
        const names = [...levels];
        [names[index], names[index + delta]] = [names[index + delta], names[index]];
        run(() => api.reorderInstrumentLevels(instrument.id, names));
    };

    const rename = async (level) => {
        const to = prompt(`Nuevo nombre para "${levelLabel(level)}" de ${instrument.name}.\nSe cambia también en los estudiantes, requisitos y solicitudes que lo usan.`, level);
        if (!to || to.trim() === level) return;
        if (await run(() => api.renameInstrumentLevel(instrument.id, level, to))) onRenamed(level, to.trim().replace(/\s+/g, ' '));
    };

    const remove = (level) => {
        if (!confirm(`¿Borrar ${levelLabel(level)} de ${instrument.name}? También se borran sus requisitos y adjuntos.`)) return;
        run(() => api.deleteInstrumentLevel(instrument.id, level));
    };

    const add = async (e) => {
        e.preventDefault();
        if (await run(() => api.addInstrumentLevel(instrument.id, name))) setName('');
    };

    return (
        <div className="space-y-3 p-1">
            <div className="flex items-center justify-between px-2 pt-1">
                <p className="text-sm font-semibold">Niveles de {instrument.name}</p>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>Listo</Button>
            </div>
            <p className="px-2 text-xs text-muted-foreground">Del más bajo (arriba) al más alto (abajo).</p>
            <ul className="space-y-1">
                {levels.map((level, index) => (
                    <li key={level} className="flex items-center gap-1 rounded-md border px-2 py-1">
                        <span className="flex-1 text-sm truncate">{levelLabel(level)}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Subir ${levelLabel(level)}`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Bajar ${levelLabel(level)}`} disabled={busy || index === levels.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Renombrar ${levelLabel(level)}`} disabled={busy} onClick={() => rename(level)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Borrar ${levelLabel(level)}`} disabled={busy || levels.length === 1} onClick={() => remove(level)}><Trash2 size={14} className="text-muted-foreground" /></Button>
                    </li>
                ))}
            </ul>
            <form onSubmit={add} className="flex gap-1">
                <input className={inputClass} maxLength={40} placeholder="Nuevo nivel (queda como el más alto)" value={name} onChange={e => setName(e.target.value)} />
                <Button type="submit" size="sm" disabled={busy || !name.trim()}><Plus size={14} /></Button>
            </form>
            {error && <p className="px-1 text-xs text-red-500">{error}</p>}
        </div>
    );
}

// Create, rename and (de)activate instruments. Inactive ones stay on their students but are not offered.
function InstrumentActions({ instrument, onCreated, onChanged, onError }) {
    const run = async (fn) => {
        onError('');
        try {
            return await fn();
        } catch (err) {
            onError(err.message);
            return null;
        }
    };

    const create = async () => {
        const name = prompt('Nombre del instrumento (ej.: Violín, Guitarra, Canto). Arranca con la escala estándar de niveles, que luego puedes ajustar.');
        if (!name?.trim()) return;
        const created = await run(() => api.createInstrument(name));
        if (created) onCreated(created);
    };

    const rename = async () => {
        const name = prompt('Nuevo nombre del instrumento:', instrument.name);
        if (!name?.trim() || name.trim() === instrument.name) return;
        if (await run(() => api.updateInstrument(instrument.id, { name }))) onChanged();
    };

    const toggle = async () => {
        if (instrument.active && !confirm(`¿Desactivar ${instrument.name}? Sus estudiantes lo conservan, pero ya no se ofrece al crear estudiantes ni profesores.`)) return;
        if (await run(() => api.updateInstrument(instrument.id, { active: !instrument.active }))) onChanged();
    };

    return (
        <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={create}><Plus size={16} />Nuevo instrumento</Button>
            {instrument && (
                <>
                    <Button variant="outline" className="gap-2" onClick={rename}><Pencil size={14} />Renombrar</Button>
                    <Button variant="outline" onClick={toggle}>{instrument.active ? 'Desactivar' : 'Activar'}</Button>
                </>
            )}
        </div>
    );
}

// "Grados": the academy's instruments, the levels of each one and what each level asks for
export function AcademyGrades() {
    const { data: instruments, error: instrumentsError, reload: reloadInstruments } = useApiData(() => api.getInstruments(true), []);
    const [chosenId, setChosenId] = useState(null);
    const instrumentId = chosenId || instruments?.find(i => i.active)?.id || instruments?.[0]?.id;
    const instrument = instruments?.find(i => i.id === instrumentId);
    const { data: guide, error: guideError, reload } = useApiData(
        () => (instrumentId ? api.getLevelGuide(instrumentId) : Promise.resolve(null)),
        [instrumentId]
    );
    const [chosenLevel, setSelected] = useState(null);
    const [editingLevels, setEditingLevels] = useState(false);
    const [actionError, setActionError] = useState('');
    const levelNames = guide?.levels.map(l => l.level) || [];
    const selected = levelNames.includes(chosenLevel) ? chosenLevel : levelNames[0];
    const entry = guide?.levels.find(l => l.level === selected);
    const error = actionError || instrumentsError || guideError;

    const chooseInstrument = (id) => {
        setChosenId(id);
        setSelected(null);
        setEditingLevels(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Grados</h2>
                    <p className="text-muted-foreground">Los instrumentos de la academia, los niveles de cada uno y sus requisitos con PDF y enlaces.</p>
                </div>
                <InstrumentActions
                    instrument={instrument}
                    onCreated={(created) => { reloadInstruments(); chooseInstrument(created.id); setEditingLevels(true); }}
                    onChanged={() => { reloadInstruments(); reload(); }}
                    onError={setActionError}
                />
            </div>

            {instruments?.length > 0 && (
                <div className="flex flex-wrap gap-1 rounded-lg border p-1 w-fit" role="tablist" aria-label="Instrumento">
                    {instruments.map(i => (
                        <button
                            key={i.id} type="button" role="tab" aria-selected={i.id === instrumentId}
                            onClick={() => chooseInstrument(i.id)}
                            className={cn("rounded-md px-3 py-1.5 text-sm font-medium", i.id === instrumentId ? "bg-primary text-primary-foreground" : "hover:bg-accent", !i.active && "opacity-60")}
                        >
                            {i.name}{!i.active && ' (inactivo)'}
                        </button>
                    ))}
                </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
            {instruments?.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay instrumentos. Crea el primero con "Nuevo instrumento".</p>}

            {guide && guide.instrument.id === instrumentId && (
                <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                    <Card className="h-fit">
                        <CardContent className="p-2">
                            {editingLevels ? (
                                <LadderEditor
                                    instrument={guide.instrument}
                                    levels={levelNames}
                                    onChanged={() => { reload(); reloadInstruments(); }}
                                    onRenamed={(from, to) => { if (selected === from) setSelected(to); }}
                                    onDone={() => setEditingLevels(false)}
                                />
                            ) : (
                                <div className="space-y-2">
                                    <LevelList levels={guide.levels} selected={selected} onSelect={setSelected} />
                                    <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setEditingLevels(true)}>
                                        <ListOrdered size={14} />Editar niveles
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6">
                            {entry && (
                                <LevelEditor
                                    key={`${instrumentId}-${selected}`}
                                    instrument={guide.instrument}
                                    entry={entry}
                                    onChanged={reload}
                                />
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
