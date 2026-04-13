import { Request } from 'express'

export interface AuthUser {
  id: string
  email: string
  role: string
  branchId: string | null
  fullName: string
}

export interface AuthRequest extends Request {
  user?: AuthUser
}

export interface PaginationQuery {
  page?: string
  limit?: string
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export function paginate(query: PaginationQuery) {
  const page = Math.max(1, parseInt(query.page || '1') || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20') || 20))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

export function successResponse<T>(data: T, message?: string, meta?: ApiResponse['meta']): ApiResponse<T> {
  return { success: true, data, message, meta }
}

export function errorResponse(error: string, message?: string): ApiResponse {
  return { success: false, error, message }
}
