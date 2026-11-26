import { useCallback, useEffect, useState } from 'react';

// Loads data from the API when deps change; reload() fetches it again.
// Results of a superseded request are ignored.
export function useApiData(fetcher, deps) {
    const [state, setState] = useState({ data: null, error: '', loading: true });
    const [version, setVersion] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetcher()
            .then(data => { if (!cancelled) setState({ data, error: '', loading: false }); })
            .catch(err => { if (!cancelled) setState(prev => ({ ...prev, error: err.message, loading: false })); });
        return () => { cancelled = true; };
        // fetcher is recreated every render; deps says when it really changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, version]);

    const reload = useCallback(() => setVersion(v => v + 1), []);
    return { ...state, reload };
}
