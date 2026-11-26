import React, { useState } from 'react';
import { FileText, Link2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { levelLabel } from '../lib/labels';

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const hasContent = (entry) => !!entry.description || entry.resources.length > 0;

// The levels of an instrument as a vertical list; marks the ones with requirements
export function LevelList({ levels, selected, onSelect, renderMeta }) {
    return (
        <nav className="space-y-1" aria-label="Niveles">
            {levels.map(entry => (
                <button
                    key={entry.level}
                    type="button"
                    onClick={() => onSelect(entry.level)}
                    aria-current={selected === entry.level ? 'true' : undefined}
                    className={cn(
                        "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        selected === entry.level ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                    )}
                >
                    <span className="flex-1 font-medium">{levelLabel(entry.level)}</span>
                    {renderMeta?.(entry)}
                    {hasContent(entry)
                        ? <CheckCircle2 size={14} className={selected === entry.level ? '' : 'text-green-600'} aria-label="Con requisitos" />
                        : <span className={cn("text-[11px]", selected === entry.level ? 'opacity-80' : 'text-muted-foreground')}>Sin definir</span>}
                </button>
            ))}
        </nav>
    );
}

// One attachment: a PDF opens in a new tab through the API, a link opens directly
export function ResourceItem({ resource, onError, action }) {
    const [opening, setOpening] = useState(false);
    const openPdf = async () => {
        setOpening(true);
        try {
            await api.openLevelResource(resource.id);
        } catch (err) {
            onError?.(err.message);
        } finally {
            setOpening(false);
        }
    };
    const isPdf = resource.kind === 'pdf';
    const Icon = isPdf ? FileText : Link2;
    return (
        <li className="flex items-center gap-3 rounded-md border p-3">
            <Icon size={18} className={isPdf ? 'text-red-600 shrink-0' : 'text-blue-600 shrink-0'} />
            <div className="flex-1 min-w-0">
                {isPdf ? (
                    <button type="button" onClick={openPdf} disabled={opening} className="text-sm font-medium hover:underline text-left truncate max-w-full">
                        {resource.title}
                    </button>
                ) : (
                    <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline inline-flex items-center gap-1 max-w-full">
                        <span className="truncate">{resource.title}</span>
                        <ExternalLink size={12} className="shrink-0" />
                    </a>
                )}
                <p className="text-xs text-muted-foreground truncate">
                    {isPdf ? `PDF · ${formatSize(resource.fileSize)}` : new URL(resource.url).hostname}
                </p>
            </div>
            {action}
        </li>
    );
}

// Read-only view of a level: the academy's text and its attachments
export function LevelDetail({ entry, instrumentName, badge }) {
    const [error, setError] = useState('');
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold">{levelLabel(entry.level)}</h3>
                {instrumentName && <span className="text-sm text-muted-foreground">· {instrumentName}</span>}
                {badge}
            </div>
            {entry.description ? (
                <p className="text-sm whitespace-pre-line leading-relaxed">{entry.description}</p>
            ) : (
                <p className="text-sm text-muted-foreground">La academia aún no ha escrito los requisitos de este nivel.</p>
            )}
            {entry.resources.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-semibold">Documentos y enlaces</p>
                    <ul className="space-y-2">
                        {entry.resources.map(r => <ResourceItem key={r.id} resource={r} onError={setError} />)}
                    </ul>
                </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}
