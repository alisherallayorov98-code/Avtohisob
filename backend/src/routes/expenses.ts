import { Router } from 'express'
import { getExpenses, createExpense, getExpenseCategories, createExpenseCategory, getUsers, updateUser } from '../controllers/expenses'
import { authenticate } from '../middleware/auth'
import { authorize } from '../middleware/rbac'

const router = Router()
router.use(authenticate)
router.get('/categories', getExpenseCategories)
router.post('/categories', authorize('admin', 'manager'), createExpenseCategory)
router.get('/users', authorize('admin', 'manager'), getUsers)
router.put('/users/:id', authorize('admin'), updateUser)
router.get('/', getExpenses)
router.post('/', createExpense)
export default router
