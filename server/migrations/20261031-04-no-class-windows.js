// Teachers no longer define class windows: they schedule each student's class
// directly. Existing 'clase' windows are deactivated (make-up windows stay).
exports.up = async ({ context: queryInterface }) => {
    await queryInterface.bulkUpdate('Availabilities', { active: false }, { type: 'clase' });
};

exports.down = async () => {
    // Deactivated windows are not restored automatically
};
