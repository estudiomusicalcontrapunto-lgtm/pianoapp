import React from 'react';

export function RiskMap({ totalMeasures, riskData = {}, onCellClick, readOnly = false }) {
    // Generate an array of measure numbers from 1 to totalMeasures
    const measures = Array.from({ length: totalMeasures }, (_, i) => i + 1);

    const getColorClass = (measure) => {
        const status = riskData[measure];
        switch (status) {
            case 'green': return 'bg-green-500 hover:bg-green-600 text-white';
            case 'yellow': return 'bg-yellow-400 hover:bg-yellow-500 text-black';
            case 'red': return 'bg-red-500 hover:bg-red-600 text-white';
            default: return 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600';
        }
    };

    if (!totalMeasures || totalMeasures <= 0) return null;

    return (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {measures.map((measure) => (
                <div
                    key={measure}
                    onMouseDown={(e) => {
                        if (readOnly) return;
                        e.preventDefault(); // Prevent text selection
                        onCellClick && onCellClick(measure, true); // true = start of action
                    }}
                    onMouseEnter={() => {
                        if (readOnly) return;
                        onCellClick && onCellClick(measure, false, true); // isEnter = true
                    }}
                    className={`
                        aspect-square flex items-center justify-center rounded-md transition-colors font-bold text-lg select-none
                        ${getColorClass(measure)}
                        ${readOnly ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}
                    `}
                    title={`Compás ${measure}`}
                >
                    {measure}
                </div>
            ))}
        </div>
    );
}
