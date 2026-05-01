import { Router } from 'express'
import { getExpenses, createExpense, updateExpense, deleteExpense, getExpenseStats, getExpenseCategories, createExpenseCategory, getUsers, updateUser, blockUser, unblockUser, deleteUser } from '../controllers/expenses'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'
import { upload, validateUpload } from '../middleware/upload'

const router = Router()
router.use(authenticate)
router.get('/categories', getExpenseCategories)
router.post('/categories', authorize('admin', 'manager'), createExpenseCategory)
router.get('/users', authorize('admin', 'manager'), getUsers)
router.put('/users/:id', authorize('admin'), updateUser)
router.post('/users/:id/block', authorize('admin', 'super_admin'), blockUser)
router.post('/users/:id/unblock', authorize('admin', 'super_admin'), unblockUser)
router.delete('/users/:id', authorize('admin', 'super_admin'), deleteUser)
router.get('/stats', getExpenseStats)
router.get('/', getExpenses)
router.post('/', upload.single('receipt'), validateUpload, createExpense)
router.put('/:id', authorize('admin', 'manager', 'branch_manager'), upload.single('receipt'), validateUpload, updateExpense)
router.delete('/:id', authorize('admin', 'manager', 'branch_manager'), deleteExpense)
export default router
