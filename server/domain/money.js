// COP amounts are whole pesos. 260000 -> "$260.000"
const formatCOP = (amount) => {
    const value = Math.round(Number(amount) || 0);
    const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${value < 0 ? '-' : ''}$${digits}`;
};

module.exports = { formatCOP };
