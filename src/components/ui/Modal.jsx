
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './Card';
import { cn } from '../../lib/utils';

// Same overlay + card pattern the existing pages use, as a reusable piece.
// On a phone it opens as a sheet from the bottom, within reach of the thumb.
export function Modal({ title, onClose, children, className }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true">
            <Card className={cn("w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] overflow-y-auto rounded-b-none sm:rounded-b-xl pb-[env(safe-area-inset-bottom)] animate-in fade-in duration-200", className)}>
                <CardHeader className="sticky top-0 z-10 flex flex-row items-center justify-between space-y-0 bg-card">
                    <CardTitle className="text-lg">{title}</CardTitle>
                    {onClose && (
                        <button onClick={onClose} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                            <X size={20} />
                        </button>
                    )}
                </CardHeader>
                <CardContent>{children}</CardContent>
            </Card>
        </div>
    );
}

// Wraps one input in its <label>. Use group for several controls (e.g. checkboxes).
export function Field({ label, children, hint, group = false }) {
    const Wrapper = group ? 'div' : 'label';
    return (
        <Wrapper className="block space-y-1">
            <span className="block text-sm font-medium">{label}</span>
            {children}
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </Wrapper>
    );
}
