const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const [users, vehicles, branches] = await Promise.all([
      p.user.count(),
      p.vehicle.count(),
      p.branch.count(),
    ]);
    console.log(
      'DB snapshot:',
      JSON.stringify({
        users,
        vehicles,
        branches,
        at: new Date().toISOString(),
      })
    );
  } catch (e) {
    console.error('snapshot failed:', e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();
