// Jest konfiguratsiyasi — TypeScript testlari uchun ts-jest.
// Testlar: src ichidagi *.test.ts fayllar. Hozircha sof (DB'siz) mantiq testlari —
// tez ishlaydi, deploy'gacha CI'da avtomatik tekshiriladi.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
}
