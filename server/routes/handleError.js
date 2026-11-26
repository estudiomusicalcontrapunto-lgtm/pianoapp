// Business-rule errors carry their own HTTP status and a message for the user
const handleError = (res, error) => {
    if (error.name === 'DomainError') {
        return res.status(error.status).json({ message: error.message, code: error.code, ...(error.details && { details: error.details }) });
    }
    // Unexpected errors are logged; the user gets a plain message instead of the technical one
    console.error(error);
    return res.status(500).json({ message: 'Algo salió mal y no se pudo completar. Inténtalo de nuevo; si sigue pasando, avísanos.' });
};

module.exports = handleError;
