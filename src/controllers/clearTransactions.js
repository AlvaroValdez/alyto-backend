import Withdrawal from '../models/Withdrawal.js';

// DELETE /api/admin/clear-transactions
export const clearAllTransactions = async (req, res) => {
    try {
        const result = await Withdrawal.deleteMany({});

        console.log(`🗑️  Cleared ${result.deletedCount} transactions`);

        return res.json({
            ok: true,
            message: `Successfully deleted ${result.deletedCount} transactions`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('❌ Error clearing transactions:', error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
};
