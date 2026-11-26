// Contact data for students (the guardian is contact info only, not an account)
// and account flags for users created by the academy.
const { DataTypes } = require('sequelize');

const columns = {
    phone: { type: DataTypes.STRING, allowNull: true },
    birthDate: { type: DataTypes.DATEONLY, allowNull: true },
    guardianName: { type: DataTypes.STRING, allowNull: true },
    guardianPhone: { type: DataTypes.STRING, allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
};

exports.up = async ({ context: queryInterface }) => {
    const existing = await queryInterface.describeTable('Users');
    for (const [name, definition] of Object.entries(columns)) {
        if (!existing[name]) {
            await queryInterface.addColumn('Users', name, definition);
        }
    }
};

exports.down = async ({ context: queryInterface }) => {
    for (const name of Object.keys(columns).reverse()) {
        await queryInterface.removeColumn('Users', name);
    }
};
