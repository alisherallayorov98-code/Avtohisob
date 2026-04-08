import swaggerJsdoc from 'swagger-jsdoc'

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AutoHisob Fleet Management API',
      version: '1.0.0',
      description: `
## AutoHisob — Enterprise Fleet Management System

REST API for managing vehicles, fuel, maintenance, inventory and more for 100+ vehicle fleets.

### Authentication
All protected endpoints require a **Bearer JWT token** in the \`Authorization\` header.

\`\`\`
Authorization: Bearer <access_token>
\`\`\`

Obtain a token via \`POST /api/auth/login\`.

### Rate Limiting
- 100 requests per 15 minutes per IP
- Login endpoint: 10 requests per 15 minutes
      `,
      contact: {
        name: 'AutoHisob Support',
        email: 'support@avtohisob.uz',
      },
      license: { name: 'Proprietary' },
    },
    servers: [
      { url: '/api', description: 'Current server' },
      { url: 'http://localhost:3001/api', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Xatolik yuz berdi' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string' },
          },
        },
        PaginatedSuccess: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: {} },
            meta: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'manager', 'branch_manager', 'operator'] },
            branchId: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
            emailVerified: { type: 'boolean' },
            twoFactorEnabled: { type: 'boolean' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Vehicle: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            registrationNumber: { type: 'string', example: '01A 123 AA' },
            model: { type: 'string' },
            brand: { type: 'string' },
            year: { type: 'integer' },
            fuelType: { type: 'string', enum: ['petrol', 'diesel', 'gas', 'electric'] },
            status: { type: 'string', enum: ['active', 'maintenance', 'inactive'] },
            mileage: { type: 'number' },
            branchId: { type: 'string' },
          },
        },
        FuelRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            vehicleId: { type: 'string' },
            fuelType: { type: 'string' },
            amountLiters: { type: 'number' },
            cost: { type: 'number' },
            odometerReading: { type: 'number' },
            refuelDate: { type: 'string', format: 'date-time' },
          },
        },
        Plan: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['free', 'starter', 'professional', 'enterprise'] },
            priceMonthly: { type: 'number' },
            priceYearly: { type: 'number' },
            maxVehicles: { type: 'integer' },
            maxBranches: { type: 'integer' },
            maxUsers: { type: 'integer' },
            features: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication, password reset, 2FA' },
      { name: 'Vehicles', description: 'Vehicle fleet management' },
      { name: 'Fuel', description: 'Fuel records and meter readings' },
      { name: 'Maintenance', description: 'Maintenance records and predictions' },
      { name: 'Inventory', description: 'Spare parts and inventory' },
      { name: 'Analytics', description: 'AI-powered analytics and insights' },
      { name: 'Billing', description: 'Subscription plans and invoices' },
      { name: 'Reports', description: 'Report generation and exports' },
      { name: 'Branches', description: 'Branch management' },
      { name: 'Notifications', description: 'User notifications' },
    ],
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'User login',
          description: 'Login with email and password. If 2FA is enabled, returns `requiresTwoFactor: true` and you must resend with `totpCode`.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email', example: 'admin@avtohisob.uz' },
                    password: { type: 'string', example: 'secret123' },
                    totpCode: { type: 'string', example: '123456', description: 'Required if 2FA is enabled' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/Success' },
                      {
                        properties: {
                          data: {
                            properties: {
                              user: { $ref: '#/components/schemas/User' },
                              accessToken: { type: 'string' },
                              refreshToken: { type: 'string' },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request password reset email',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } },
          },
          responses: { 200: { description: 'Reset email sent (always 200 to prevent enumeration)' } },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password with token from email',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'newPassword'],
                  properties: {
                    token: { type: 'string' },
                    newPassword: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Password reset successful' },
            400: { description: 'Invalid or expired token' },
          },
        },
      },
      '/auth/2fa/setup': {
        post: {
          tags: ['Auth'],
          summary: 'Generate 2FA secret and QR code',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'QR code and secret returned',
              content: {
                'application/json': {
                  schema: {
                    allOf: [{ $ref: '#/components/schemas/Success' }, {
                      properties: {
                        data: {
                          properties: {
                            secret: { type: 'string' },
                            qrCode: { type: 'string', description: 'Base64 data URL of QR code image' },
                          },
                        },
                      },
                    }],
                  },
                },
              },
            },
          },
        },
      },
      '/vehicles': {
        get: {
          tags: ['Vehicles'],
          summary: 'List all vehicles',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'maintenance', 'inactive'] } },
            { name: 'branchId', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'List of vehicles',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedSuccess' } } },
            },
          },
        },
      },
      '/billing/plans': {
        get: {
          tags: ['Billing'],
          summary: 'Get available subscription plans',
          responses: {
            200: {
              description: 'List of plans',
              content: {
                'application/json': {
                  schema: {
                    allOf: [{ $ref: '#/components/schemas/Success' }, {
                      properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Plan' } } },
                    }],
                  },
                },
              },
            },
          },
        },
      },
      '/billing/subscription': {
        get: {
          tags: ['Billing'],
          summary: 'Get current user subscription',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Subscription details' } },
        },
      },
      '/billing/upgrade': {
        post: {
          tags: ['Billing'],
          summary: 'Upgrade or change subscription plan',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['planId'],
                  properties: {
                    planId: { type: 'string', format: 'uuid' },
                    billingCycle: { type: 'string', enum: ['monthly', 'yearly'], default: 'monthly' },
                    provider: { type: 'string', enum: ['stripe', 'payme', 'click', 'manual'], default: 'manual' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Plan upgraded successfully' } },
        },
      },
      '/analytics/fuel': {
        get: {
          tags: ['Analytics'],
          summary: 'Fuel consumption trends',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'months', in: 'query', schema: { type: 'integer', default: 6 } },
            { name: 'branchId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Monthly fuel trend data' } },
        },
      },
      '/analytics/anomalies': {
        get: {
          tags: ['Analytics'],
          summary: 'Get detected anomalies',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high'] } },
            { name: 'isResolved', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { 200: { description: 'Anomaly list' } },
        },
      },
      '/fuel-meter/analyze': {
        post: {
          tags: ['Fuel'],
          summary: 'AI-powered fuel meter reading from image',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    image: { type: 'string', format: 'binary', description: 'Fuel meter image (JPG/PNG, max 10MB)' },
                    vehicleId: { type: 'string' },
                    fuelType: { type: 'string', enum: ['petrol', 'diesel', 'gas', 'electric'] },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Extracted meter reading',
              content: {
                'application/json': {
                  schema: {
                    allOf: [{ $ref: '#/components/schemas/Success' }, {
                      properties: {
                        data: {
                          properties: {
                            extractedValue: { type: 'number', example: 45.6 },
                            confidenceScore: { type: 'number', example: 0.95 },
                            rawOcrText: { type: 'string' },
                          },
                        },
                      },
                    }],
                  },
                },
              },
            },
          },
        },
      },
      '/exports/full-report': {
        get: {
          tags: ['Reports'],
          summary: 'Download full multi-sheet Excel report',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'branchId', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Excel file download (6 sheets)',
              content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } },
            },
          },
        },
      },
    },
  },
  apis: [],
}

export const swaggerSpec = swaggerJsdoc(options)
